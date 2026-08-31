/**
 * Per-client LinkedIn / Skylead analytics for the Lifecycle hub detail page.
 *
 * Skylead only returns lifetime counters. Daily snapshots in
 * lifecycle_campaign_stats let us subtract "then" from "now" for 30/60/90-day
 * windows. When history is too thin, we fall back to lifetime and say so.
 */

import { getDb } from "./db";
import {
  evaluateRefresh,
  getRefreshSettings,
  listCampaignMeta,
  recordSweepStats,
  type RefreshVerdict,
} from "./lifecycle";
import { getRevClient } from "./revenue";
import {
  isSkyleadConfigured,
  SkyleadError,
  sweep,
  type SkyleadCampaign,
} from "./skylead";

export type LinkedInPreset = "30d" | "60d" | "90d" | "all";

const PRESET_DAYS: Record<Exclude<LinkedInPreset, "all">, number> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

export function isLinkedInPreset(value: unknown): value is LinkedInPreset {
  return value === "30d" || value === "60d" || value === "90d" || value === "all";
}

export function resolveLinkedInRange(
  preset: LinkedInPreset,
  now = new Date()
): { days: number | null; start: string | null; end: string } {
  const end = now.toISOString().slice(0, 10);
  if (preset === "all") return { days: null, start: null, end };
  const days = PRESET_DAYS[preset];
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  return { days, start: startDate.toISOString().slice(0, 10), end };
}

type StatsRow = {
  captured_on: string;
  connections_requested: number;
  accepted: number;
  messages_sent: number;
  replies: number;
  acceptance_rate: number;
  response_rate: number;
};

function latestSnapshot(campaignId: number): StatsRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT captured_on, connections_requested, accepted, messages_sent, replies,
                acceptance_rate, response_rate
           FROM lifecycle_campaign_stats
          WHERE skylead_campaign_id = ?
          ORDER BY captured_on DESC
          LIMIT 1`
      )
      .get(campaignId) as StatsRow | undefined) ?? null
  );
}

function snapshotOnOrBefore(campaignId: number, day: string): StatsRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT captured_on, connections_requested, accepted, messages_sent, replies,
                acceptance_rate, response_rate
           FROM lifecycle_campaign_stats
          WHERE skylead_campaign_id = ? AND captured_on <= ?
          ORDER BY captured_on DESC
          LIMIT 1`
      )
      .get(campaignId, day) as StatsRow | undefined) ?? null
  );
}

function clampDelta(end: number, start: number): number {
  const n = end - start;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type WindowActivity = {
  connectionsRequested: number;
  accepted: number;
  messagesSent: number;
  replies: number;
  acceptanceRate: number;
  responseRate: number;
  /** False when we lacked a baseline snapshot and fell back to lifetime. */
  windowComplete: boolean;
  baselineOn: string | null;
};

/** Pure helper for tests: delta between two cumulative snapshots. */
export function activityBetween(
  end: StatsRow | null,
  start: StatsRow | null,
  live?: {
    connectionsRequested: number;
    accepted: number;
    messagesSent: number;
    replies: number;
    acceptanceRate: number;
    responseRate: number;
  }
): WindowActivity {
  const current = end ?? {
    captured_on: "",
    connections_requested: live?.connectionsRequested ?? 0,
    accepted: live?.accepted ?? 0,
    messages_sent: live?.messagesSent ?? 0,
    replies: live?.replies ?? 0,
    acceptance_rate: live?.acceptanceRate ?? 0,
    response_rate: live?.responseRate ?? 0,
  };

  if (!start) {
    return {
      connectionsRequested: current.connections_requested,
      accepted: current.accepted,
      messagesSent: current.messages_sent,
      replies: current.replies,
      acceptanceRate: current.acceptance_rate,
      responseRate: current.response_rate,
      windowComplete: false,
      baselineOn: null,
    };
  }

  const connectionsRequested = clampDelta(
    current.connections_requested,
    start.connections_requested
  );
  const accepted = clampDelta(current.accepted, start.accepted);
  const messagesSent = clampDelta(current.messages_sent, start.messages_sent);
  const replies = clampDelta(current.replies, start.replies);

  return {
    connectionsRequested,
    accepted,
    messagesSent,
    replies,
    acceptanceRate:
      connectionsRequested > 0
        ? (accepted / connectionsRequested) * 100
        : current.acceptance_rate,
    responseRate:
      messagesSent > 0 ? (replies / messagesSent) * 100 : current.response_rate,
    windowComplete: true,
    baselineOn: start.captured_on,
  };
}

export function windowActivityForCampaign(
  campaignId: number,
  start: string | null,
  live: SkyleadCampaign["stats"]
): WindowActivity {
  const latest = latestSnapshot(campaignId);
  const endRow: StatsRow = latest ?? {
    captured_on: "",
    connections_requested: live.connectionsRequested,
    accepted: live.connectionRequestsAccepted,
    messages_sent: live.messagesSent,
    replies: live.connectionReplies,
    acceptance_rate: live.acceptanceRate,
    response_rate: live.responseRate,
  };

  if (!start) {
    return {
      connectionsRequested: live.connectionsRequested,
      accepted: live.connectionRequestsAccepted,
      messagesSent: live.messagesSent,
      replies: live.connectionReplies,
      acceptanceRate: live.acceptanceRate,
      responseRate: live.responseRate,
      windowComplete: true,
      baselineOn: null,
    };
  }

  const baseline = snapshotOnOrBefore(campaignId, start);
  return activityBetween(endRow, baseline, {
    connectionsRequested: live.connectionsRequested,
    accepted: live.connectionRequestsAccepted,
    messagesSent: live.messagesSent,
    replies: live.connectionReplies,
    acceptanceRate: live.acceptanceRate,
    responseRate: live.responseRate,
  });
}

export interface ClientLinkedInCampaign {
  id: number;
  name: string;
  seatId: number;
  seatName: string;
  seatHealthy: boolean;
  isActive: boolean;
  statusLabel: string;
  remainingLeads: number;
  totalLeads: number;
  connectionsRequested: number;
  accepted: number;
  messagesSent: number;
  replies: number;
  acceptanceRate: number;
  responseRate: number;
  windowComplete: boolean;
  verdict: RefreshVerdict;
}

export interface ClientLinkedInAnalytics {
  clientId: string;
  clientName: string;
  preset: LinkedInPreset;
  days: number | null;
  start: string | null;
  end: string;
  fetchedAt: string;
  configured: boolean;
  assigned: number;
  live: number;
  needsRefresh: number;
  totals: {
    connectionsRequested: number;
    accepted: number;
    messagesSent: number;
    replies: number;
    acceptanceRate: number;
    responseRate: number;
  };
  /** True when every campaign had a usable baseline for the window. */
  windowComplete: boolean;
  campaigns: ClientLinkedInCampaign[];
}

function statusLabel(isActive: boolean, seatHealthy: boolean, verdict: RefreshVerdict): string {
  if (!isActive || verdict.severity === "off") return "Off";
  if (!seatHealthy || verdict.severity === "blocked") return "Seat down";
  if (verdict.severity === "refresh") return "Needs work";
  if (verdict.severity === "watch") return "Watch";
  return "Running";
}

export async function pullClientLinkedInAnalytics(
  clientId: string,
  memberIds: string[] = [],
  preset: LinkedInPreset = "30d",
  force = false
): Promise<ClientLinkedInAnalytics> {
  const client = getRevClient(clientId);
  if (!client) throw new Error("Unknown account");

  const { days, start, end } = resolveLinkedInRange(preset);
  const ids = new Set([clientId, ...memberIds.filter(Boolean)]);

  if (!isSkyleadConfigured()) {
    return {
      clientId,
      clientName: client.name,
      preset,
      days,
      start,
      end,
      fetchedAt: new Date().toISOString(),
      configured: false,
      assigned: 0,
      live: 0,
      needsRefresh: 0,
      totals: {
        connectionsRequested: 0,
        accepted: 0,
        messagesSent: 0,
        replies: 0,
        acceptanceRate: 0,
        responseRate: 0,
      },
      windowComplete: true,
      campaigns: [],
    };
  }

  let data;
  try {
    data = await sweep(force);
  } catch (err) {
    throw new Error(
      err instanceof SkyleadError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not reach Skylead"
    );
  }

  try {
    recordSweepStats(data);
  } catch {
    // Snapshot write failure must not blank the panel.
  }

  const settings = getRefreshSettings();
  const meta = listCampaignMeta();
  const campaigns: ClientLinkedInCampaign[] = [];

  for (const { seat, campaigns: seatCampaigns } of data.seats) {
    for (const c of seatCampaigns) {
      const m = meta.get(c.id) ?? null;
      const ownerId = m?.client_id ?? null;
      if (!ownerId || !ids.has(ownerId)) continue;

      const verdict = evaluateRefresh(c, settings, m, { seatHealthy: seat.healthy });
      const activity = windowActivityForCampaign(c.id, start, c.stats);
      campaigns.push({
        id: c.id,
        name: c.name,
        seatId: seat.id,
        seatName: seat.fullName,
        seatHealthy: seat.healthy,
        isActive: c.stats.isActive,
        statusLabel: statusLabel(c.stats.isActive, seat.healthy, verdict),
        remainingLeads: c.stats.remainingLeads,
        totalLeads: c.stats.totalLeads,
        connectionsRequested: activity.connectionsRequested,
        accepted: activity.accepted,
        messagesSent: activity.messagesSent,
        replies: activity.replies,
        acceptanceRate: activity.acceptanceRate,
        responseRate: activity.responseRate,
        windowComplete: activity.windowComplete,
        verdict,
      });
    }
  }

  campaigns.sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)
  );

  const requested = campaigns.reduce((n, c) => n + c.connectionsRequested, 0);
  const accepted = campaigns.reduce((n, c) => n + c.accepted, 0);
  const messagesSent = campaigns.reduce((n, c) => n + c.messagesSent, 0);
  const replies = campaigns.reduce((n, c) => n + c.replies, 0);

  return {
    clientId,
    clientName: client.name,
    preset,
    days,
    start,
    end,
    fetchedAt: data.fetchedAt,
    configured: true,
    assigned: campaigns.length,
    live: campaigns.filter((c) => c.isActive).length,
    needsRefresh: campaigns.filter((c) => c.verdict.severity === "refresh").length,
    totals: {
      connectionsRequested: requested,
      accepted,
      messagesSent,
      replies,
      acceptanceRate: requested > 0 ? (accepted / requested) * 100 : 0,
      responseRate: messagesSent > 0 ? (replies / messagesSent) * 100 : 0,
    },
    windowComplete: campaigns.length === 0 || campaigns.every((c) => c.windowComplete),
    campaigns,
  };
}
