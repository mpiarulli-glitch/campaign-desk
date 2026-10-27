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
import { clientLogoPublicUrl } from "./client-logos";

type ClientRow = {
  id: string;
  name: string;
  active: number;
  monthly_email_quota: number | null;
  website: string | null;
  logo_path: string | null;
  updated_at: string;
};

export function loadCampaignMonthDesk(
  session: CampaignListViewer,
  kindScope: CampaignKindScope | null,
  now = new Date()
) {
  const source = kindScope ? listCampaignsForKindScope(kindScope) : listCampaigns();
  const managers = listClientAccountManagers();
  const visible = campaignsVisibleToViewer(
    attachClientAccountManager(source, managers),
    session,
    "main"
  );
  const sends = listEmailScheduledInstants();
  const clientRows = getDb()
    .prepare(
      `SELECT id, name, active, monthly_email_quota, website, logo_path, updated_at
         FROM rev_clients`
    )
    .all() as ClientRow[];

  const clients: MonthDeskClientInput[] = clientRows.map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active !== 0,
    monthly_email_quota: row.monthly_email_quota || 0,
    website: row.website || "",
    // Stored file only. A website with no saved logo stays on the initials
    // circle so this page does not hotlink a favicon service.
    logoUrl: row.logo_path
      ? clientLogoPublicUrl(row.id, row.updated_at)
      : null,
  }));

  const campaigns: MonthDeskCampaignInput[] = visible.map((campaign) => ({
    id: campaign.id,
    title: campaign.title,
    client_id: campaign.client_id,
    client_name: campaign.client_name,
    status: campaign.status,
    approved_channel: campaign.approved_channel,
    board_period: campaign.board_period,
    scheduled_send_at: campaign.scheduled_send_at,
    created_at: campaign.created_at,
    email_sends: sends.get(campaign.id) || [],
  }));

  // Account managers, and anyone whose list is limited to one asset kind,
  // only see clients that have a campaign in that filtered set. Admins see
  // every active client, including ones with nothing filed yet.
  const includeEmptyClients = !accountManagerViewerSlug(session) && !kindScope;
  return buildMonthDesk({ campaigns, clients, includeEmptyClients, now });
}
