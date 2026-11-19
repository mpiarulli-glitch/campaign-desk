// One read of the campaigns the viewer may see, plus the client rows those
// campaigns hang off. The grid and a client's month folders both use this.
// It does not write, and it does not touch Forecast.

import type { CampaignListViewer } from "./campaign-review-queue";
import {
  accountManagerViewerSlug,
  attachClientAccountManager,
  campaignsVisibleToViewer,
} from "./campaign-review-queue";
import {
  listCampaignDeskEmails,
  listCampaigns,
  listCampaignsForKindScope,
  listClientAccountManagers,
  listEmailScheduledInstants,
} from "./campaigns";
import {
  buildMonthDesk,
  type MonthDeskCampaignInput,
  type MonthDeskClientInput,
} from "./campaign-month-desk";
import { getDb } from "./db";
import type { CampaignKindScope } from "./people";
import { loadLifecycleLogoDomains } from "./client-logo-domain";
import { clientLogoPublicUrl, faviconPublicUrl, readCachedFavicon } from "./client-logos";

function logoUrlForRow(row: ClientRow, host: string): string | null {
  if ((row.logo_path || "").trim()) return clientLogoPublicUrl(row.id, row.updated_at);
  if (!host || !readCachedFavicon(host)) return null;
  return faviconPublicUrl(host);
}

type ClientRow = {
  id: string;
  name: string;
  active: number;
  monthly_email_quota: number | null;
  website: string | null;
  logo_path: string | null;
  updated_at: string;
  archived_at?: string | null;
};

const CLIENT_COLUMNS = `id, name, active, monthly_email_quota, website, logo_path, updated_at, archived_at`;

function rowToDeskClient(row: ClientRow, domains: Map<string, { host: string }>): MonthDeskClientInput {
  return {
    id: row.id,
    name: row.name,
    active: row.active !== 0,
    monthly_email_quota: row.monthly_email_quota || 0,
    website: row.website || "",
    logoUrl: logoUrlForRow(row, domains.get(row.id)?.host || ""),
  };
}

function loadClientRows(where: string): ClientRow[] {
  return getDb()
    .prepare(`SELECT ${CLIENT_COLUMNS} FROM rev_clients ${where}`)
    .all() as ClientRow[];
}

export function loadCampaignMonthDesk(
  session: CampaignListViewer,
  kindScope: CampaignKindScope | null,
  now = new Date(),
  opts?: { archivedOnly?: boolean; includeClientId?: string }
) {
  const archivedOnly = opts?.archivedOnly === true;
  const source = archivedOnly
    ? listCampaigns(false, { includeArchivedClients: true })
    : kindScope
      ? listCampaignsForKindScope(kindScope)
      : listCampaigns();
  const managers = listClientAccountManagers();
  const visible = campaignsVisibleToViewer(
    attachClientAccountManager(source, managers),
    session,
    "main"
  );
  const sends = listEmailScheduledInstants();
  const deskEmails = listCampaignDeskEmails();
  const clientRows = loadClientRows(
    archivedOnly ? "WHERE archived_at IS NOT NULL" : "WHERE archived_at IS NULL"
  );

  const domains = loadLifecycleLogoDomains(clientRows);
  const clients: MonthDeskClientInput[] = clientRows.map((row) =>
    rowToDeskClient(row, domains)
  );

  const archivedIds = new Set(
    archivedOnly ? clientRows.map((row) => row.id) : []
  );
  const archivedNames = new Set(
    archivedOnly
      ? clientRows.map((row) => row.name.trim().toLowerCase()).filter(Boolean)
      : []
  );
  const campaigns: MonthDeskCampaignInput[] = visible
    .filter((campaign) => {
      if (!archivedOnly) return true;
      if (campaign.client_id && archivedIds.has(campaign.client_id)) return true;
      const name = (campaign.client_name || "").trim().toLowerCase();
      return Boolean(name) && !campaign.client_id && archivedNames.has(name);
    })
    .map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      client_id: campaign.client_id,
      client_name: campaign.client_name,
      status: campaign.status,
      approved_channel: campaign.approved_channel,
      board_period: campaign.board_period,
      scheduled_send_at: campaign.scheduled_send_at,
      created_at: campaign.created_at,
      due_on: campaign.basecamp_due_on,
      email_sends: sends.get(campaign.id) || [],
      emails: deskEmails.get(campaign.id) || [],
    }));

  // Account managers, and anyone whose list is limited to one asset kind,
  // only see clients that have a campaign in that filtered set. Admins see
  // every active client, including ones with nothing filed yet.
  const includeEmptyClients =
    archivedOnly || (!accountManagerViewerSlug(session) && !kindScope);
  return buildMonthDesk({ campaigns, clients, includeEmptyClients, now });
}

/** One archived client, for a direct link. Null when that id is not archived. */
export function loadArchivedClientDesk(
  session: CampaignListViewer,
  clientId: string,
  now = new Date()
) {
  const row = getDb()
    .prepare(`SELECT ${CLIENT_COLUMNS} FROM rev_clients WHERE id = ? AND archived_at IS NOT NULL`)
    .get(clientId) as ClientRow | undefined;
  if (!row) return null;
  const desk = loadCampaignMonthDesk(session, null, now, { archivedOnly: true });
  const client = desk.clients.find((card) => card.id === row.id || card.key === row.id);
  return client ? { ...desk, clients: [client] } : { ...desk, clients: [] };
}
