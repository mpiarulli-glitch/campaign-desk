/**
 * Assembles the Lifecycle Marketing department view.
 *
 * Nothing here owns data. Approvals come from `campaigns`, SOPs from `sops`,
 * LinkedIn from the Skylead API, and the rest from the lifecycle_* tables.
 * Keeping this a pure aggregator is deliberate: no duplicated records to drift.
 */

import { getDb } from "./db";
import { listRevClients } from "./revenue";
import { listSops } from "./hub";
import {
  evaluateRefresh,
  getRefreshSettings,
  listAutomations,
  listCampaignMeta,
  listLinks,
  listNotes,
  recordSweepStats,
  type RefreshVerdict,
} from "./lifecycle";
import {
  isSkyleadConfigured,
  sweep,
  SkyleadError,
  type SkyleadCampaign,
  type SkyleadSeat,
} from "./skylead";
import type { LifecycleAutomation, LifecycleLink, LifecycleNote } from "./db";

/* ------------------------------------------------------------- approvals */

export interface ApprovalRow {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  status: string;
  externalToken: string;
  updatedAt: string;
  /** Days the client has been sitting on it. */
  waitingDays: number;
  openComments: number;
}

/**
 * Everything awaiting a decision, across every client. `in_review` is on the
 * client, `needs_changes` is on us. Both are shown because both are blocked.
 */
export function listAllPendingApprovals(): ApprovalRow[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.title, c.client_id, c.client_name, c.status,
              c.external_token, c.updated_at,
              (SELECT COUNT(*) FROM comments cm
                WHERE cm.campaign_id = c.id AND cm.resolved = 0) AS open_comments
         FROM campaigns c
        WHERE c.archived_at IS NULL
          AND c.status IN ('in_review', 'needs_changes')
        ORDER BY c.updated_at ASC`
    )
    .all() as Array<{
    id: string;
    title: string;
    client_id: string | null;
    client_name: string;
    status: string;
    external_token: string;
    updated_at: string;
    open_comments: number;
  }>;

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientId: r.client_id,
    clientName: r.client_name,
    status: r.status,
    externalToken: r.external_token,
    updatedAt: r.updated_at,
    waitingDays: Math.max(0, Math.floor((now - Date.parse(r.updated_at)) / 86_400_000)),
    openComments: r.open_comments,
  }));
}

/* -------------------------------------------------------------- LinkedIn */

export interface LinkedInCampaignRow {
  id: number;
  name: string;
  seatId: number;
  seatName: string;
  clientId: string | null;
  clientName: string | null;
  isActive: boolean;
  totalLeads: number;
  remainingLeads: number;
  connectionsRequested: number;
  connectionRequestsAccepted: number;
  messagesSent: number;
  replies: number;
  acceptanceRate: number;
  responseRate: number;
  verdict: RefreshVerdict;
  note: string;
}

export interface LinkedInSection {
  configured: boolean;
  error: string | null;
  fetchedAt: string | null;
  seats: Array<{
    seat: SkyleadSeat;
    connected: boolean;
    error?: string;
    liveCampaigns: number;
    campaigns: LinkedInCampaignRow[];
  }>;
  campaigns: LinkedInCampaignRow[];
  /** Seats that cannot send right now (auth, 2FA, jail, subscription). */
  brokenSeats: number;
  needsRefresh: LinkedInCampaignRow[];
  watch: LinkedInCampaignRow[];
}

const EMPTY_LINKEDIN: LinkedInSection = {
  configured: false,
  error: null,
  fetchedAt: null,
  seats: [],
  campaigns: [],
  brokenSeats: 0,
  needsRefresh: [],
  watch: [],
};

function toRow(
  campaign: SkyleadCampaign,
  seat: SkyleadSeat,
  verdict: RefreshVerdict,
  clientId: string | null,
  clientName: string | null,
  note: string
): LinkedInCampaignRow {
  const s = campaign.stats;
  return {
    id: campaign.id,
    name: campaign.name,
    seatId: seat.id,
    seatName: seat.fullName,
    clientId,
    clientName,
    isActive: s.isActive,
    totalLeads: s.totalLeads,
    remainingLeads: s.remainingLeads,
    connectionsRequested: s.connectionsRequested,
    connectionRequestsAccepted: s.connectionRequestsAccepted,
    messagesSent: s.messagesSent,
    replies: s.connectionReplies,
    acceptanceRate: s.acceptanceRate,
    responseRate: s.responseRate,
    verdict,
    note,
  };
}

/**
 * Pull LinkedIn state from Skylead and score every campaign.
 *
 * A Skylead outage degrades to an error banner rather than a broken page, so
 * approvals, SOPs and notes still render when the API is down.
 */
export async function buildLinkedInSection(force = false): Promise<LinkedInSection> {
  if (!isSkyleadConfigured()) return { ...EMPTY_LINKEDIN };

  let data;
  try {
    data = await sweep(force);
  } catch (err) {
    return {
      ...EMPTY_LINKEDIN,
      configured: true,
      error:
        err instanceof SkyleadError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not reach Skylead",
    };
  }

  // Persist today's numbers so decay detection has something to compare to.
  try {
    recordSweepStats(data);
  } catch {
    // A snapshot failure must not take the dashboard down.
  }

  const settings = getRefreshSettings();
  const meta = listCampaignMeta();
  const clients = new Map(listRevClients(true).map((c) => [c.id, c.name]));

  const seats = data.seats.map(({ seat, campaigns, error }) => {
    const rows = campaigns.map((c) => {
      const m = meta.get(c.id) ?? null;
      const clientId = m?.client_id ?? null;
      return toRow(
        c,
        seat,
        evaluateRefresh(c, settings, m, { seatHealthy: seat.healthy }),
        clientId,
        clientId ? (clients.get(clientId) ?? null) : null,
        m?.note ?? ""
      );
    });
    return {
      seat,
      connected: seat.healthy,
      error,
      liveCampaigns: rows.filter((r) => r.isActive).length,
      campaigns: rows,
    };
  });

  const campaigns = seats.flatMap((s) => s.campaigns);

  return {
    configured: true,
    error: null,
    fetchedAt: data.fetchedAt,
    seats,
    campaigns,
    // A broken seat is its own alert: campaigns on it look fine but send
    // nothing, so surface the seats separately from the campaign rules.
    brokenSeats: seats.filter((s) => !s.connected).length,
    needsRefresh: campaigns.filter((c) => c.verdict.severity === "refresh"),
    watch: campaigns.filter((c) => c.verdict.severity === "watch"),
  };
}

/* ------------------------------------------------------------- dashboard */

export interface LifecycleDashboard {
  approvals: ApprovalRow[];
  linkedIn: LinkedInSection;
  automations: LifecycleAutomation[];
  liveAutomationsByPlatform: Array<{ platform: string; live: number; total: number }>;
  sops: ReturnType<typeof listSops>;
  notes: LifecycleNote[];
  links: LifecycleLink[];
  clients: Array<{ id: string; name: string }>;
  counts: {
    pendingApprovals: number;
    waitingOnClient: number;
    waitingOnUs: number;
    liveAutomations: number;
    linkedInLive: number;
    campaignsNeedingRefresh: number;
    brokenSeats: number;
  };
}

export async function buildLifecycleDashboard(force = false): Promise<LifecycleDashboard> {
  const approvals = listAllPendingApprovals();
  const linkedIn = await buildLinkedInSection(force);
  const automations = listAutomations();

  const byPlatform = new Map<string, { live: number; total: number }>();
  for (const a of automations) {
    const entry = byPlatform.get(a.platform) ?? { live: 0, total: 0 };
    entry.total++;
    if (a.status === "live") entry.live++;
    byPlatform.set(a.platform, entry);
  }

  return {
    approvals,
    linkedIn,
    automations,
    liveAutomationsByPlatform: [...byPlatform.entries()]
      .map(([platform, v]) => ({ platform, ...v }))
      .sort((a, b) => b.live - a.live),
    sops: listSops(),
    notes: listNotes(),
    links: listLinks(),
    clients: listRevClients(true).map((c) => ({ id: c.id, name: c.name })),
    counts: {
      pendingApprovals: approvals.length,
      waitingOnClient: approvals.filter((a) => a.status === "in_review").length,
      waitingOnUs: approvals.filter((a) => a.status === "needs_changes").length,
      liveAutomations: automations.filter((a) => a.status === "live").length,
      linkedInLive: linkedIn.campaigns.filter((c) => c.isActive).length,
      campaignsNeedingRefresh: linkedIn.needsRefresh.length,
      brokenSeats: linkedIn.brokenSeats,
    },
  };
}

/* -------------------------------------------------------- account report */

export interface AccountReport {
  clientId: string;
  clientName: string;
  generatedAt: string;
  email: {
    months: number;
    campaignsSent: number;
    recipients: number;
    opens: number;
    clicks: number;
    openRate: number;
    clickRate: number;
    revenue: number;
    leads: number;
  };
  approvals: ApprovalRow[];
  automations: LifecycleAutomation[];
  linkedIn: {
    campaigns: LinkedInCampaignRow[];
    live: number;
    needsRefresh: number;
    connectionsRequested: number;
    accepted: number;
    replies: number;
    acceptanceRate: number;
    responseRate: number;
  };
  notes: LifecycleNote[];
  links: LifecycleLink[];
}

/**
 * One account, everything we do for it. `months` bounds the email window;
 * LinkedIn numbers are Skylead lifetime totals and are labelled as such in
 * the UI so the two aren't read as the same period.
 */
export async function buildAccountReport(
  clientId: string,
  months = 6
): Promise<AccountReport | null> {
  const client = listRevClients(true).find((c) => c.id === clientId);
  if (!client) return null;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffMonth = cutoff.toISOString().slice(0, 7);

  const email = getDb()
    .prepare(
      `SELECT COUNT(*) AS months,
              COALESCE(SUM(campaigns_sent), 0) AS campaigns_sent,
              COALESCE(SUM(recipients), 0)     AS recipients,
              COALESCE(SUM(opens), 0)          AS opens,
              COALESCE(SUM(clicks), 0)         AS clicks,
              COALESCE(SUM(revenue), 0)        AS revenue,
              COALESCE(SUM(leads), 0)          AS leads
         FROM rev_metrics
        WHERE client_id = ? AND month >= ?`
    )
    .get(clientId, cutoffMonth) as {
    months: number;
    campaigns_sent: number;
    recipients: number;
    opens: number;
    clicks: number;
    revenue: number;
    leads: number;
  };

  const linkedInAll = await buildLinkedInSection();
  const mine = linkedInAll.campaigns.filter((c) => c.clientId === clientId);
  const requested = mine.reduce((n, c) => n + c.connectionsRequested, 0);
  const accepted = mine.reduce((n, c) => n + c.connectionRequestsAccepted, 0);
  const sent = mine.reduce((n, c) => n + c.messagesSent, 0);
  const replies = mine.reduce((n, c) => n + c.replies, 0);

  return {
    clientId,
    clientName: client.name,
    generatedAt: new Date().toISOString(),
    email: {
      months: email.months,
      campaignsSent: email.campaigns_sent,
      recipients: email.recipients,
      opens: email.opens,
      clicks: email.clicks,
      openRate: email.recipients > 0 ? (email.opens / email.recipients) * 100 : 0,
      clickRate: email.recipients > 0 ? (email.clicks / email.recipients) * 100 : 0,
      revenue: email.revenue,
      leads: email.leads,
    },
    approvals: listAllPendingApprovals().filter((a) => a.clientId === clientId),
    automations: listAutomations(clientId),
    linkedIn: {
      campaigns: mine,
      live: mine.filter((c) => c.isActive).length,
      needsRefresh: mine.filter((c) => c.verdict.severity === "refresh").length,
      connectionsRequested: requested,
      accepted,
      replies,
      acceptanceRate: requested > 0 ? (accepted / requested) * 100 : 0,
      responseRate: sent > 0 ? (replies / sent) * 100 : 0,
    },
    notes: listNotes(clientId),
    links: listLinks({ clientId }),
  };
}
