// Counts for the Campaigns "Clients" view only.
//
// Nothing in here is used by the campaigns list, the lifecycle deliverables
// board, or Forecast. Status meanings elsewhere stay as they are.

import { operatorStatusLabel, operatorStatusValue } from "./campaign-status";
import { APP_TIME_ZONE, currentPeriod, isValidPeriod, periodLabel, shiftPeriod } from "./period";
import { pickDisplayedSendAt } from "./send-display";

/** Shown on the card and the next-month folder. */
export const MONTH_DESK_NEXT_MONTH_RULE =
  "Next month counts once sent for internal approval";

/** Shown on the card and the current-month folder. */
export const MONTH_DESK_THIS_MONTH_RULE =
  "This month counts once the client approves";

/**
 * Stored statuses that mean the campaign has been sent for internal approval
 * or has moved further along. `draft` is the only earlier status Campaign Desk
 * stores. `approved` is included for both client approval and internal
 * approval (`approved_channel` `internal`); the this-month rule splits those.
 *
 * Order is the operator workflow, not a sort key.
 */
export const MONTH_DESK_SENT_FOR_INTERNAL_APPROVAL = [
  "internal_review",
  "needs_revisions_internal",
  "revisions_made",
  "in_review",
  "needs_changes",
  "approved",
  "scheduled",
  "sent",
  "live",
] as const;

/**
 * Stored statuses that mean this month's deliverable is met: the campaign is
 * scheduled, sent, or live. Client approval is `approved` with any channel
 * other than `internal` (including a blank channel, which the status filter
 * already treats as client Approved).
 */
export const MONTH_DESK_CLIENT_DONE_STATUSES = ["scheduled", "sent", "live"] as const;

const SENT_FOR_INTERNAL = new Set<string>(MONTH_DESK_SENT_FOR_INTERNAL_APPROVAL);
const CLIENT_DONE = new Set<string>(MONTH_DESK_CLIENT_DONE_STATUSES);

const MONTH_KEY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

export type MonthDeskTone = "complete" | "partial" | "behind" | "unset";

export type CountsForMonthInput = {
  board_period?: string | null;
  scheduled_send_at?: string | null;
  created_at?: string | null;
  email_sends?: Array<string | null | undefined>;
};

export type MonthDeskCampaignInput = CountsForMonthInput & {
  id: string;
  title: string;
  client_id?: string | null;
  client_name?: string | null;
  status: string;
  approved_channel?: string | null;
};

export type MonthDeskClientInput = {
  id: string;
  name: string;
  active: boolean;
  /** Contracted monthly deliverable count. 0 means unset. */
  monthly_email_quota: number;
  website?: string | null;
  logoUrl?: string | null;
};

export type MonthDeskStatusCount = {
  value: string;
  label: string;
  count: number;
};

export type MonthDeskProgress = {
  period: string;
  label: string;
  done: number;
  target: number;
  tone: MonthDeskTone;
};

export type MonthDeskCampaign = {
  id: string;
  title: string;
  status: string;
  approved_channel: string | null;
  sendAt: string | null;
  period: string;
};

export type MonthDeskFolderRole = "next" | "later" | "current" | "past";

export type MonthDeskFolder = {
  period: string;
  label: string;
  role: MonthDeskFolderRole;
  campaignCount: number;
  done: number;
  needsApproval: number;
  campaigns: MonthDeskCampaign[];
};

export type MonthDeskCard = {
  key: string;
  id: string | null;
  name: string;
  logoUrl: string | null;
  website: string;
  target: number;
  thisMonth: MonthDeskProgress;
  nextMonth: MonthDeskProgress & {
    needsApproval: number;
    statuses: MonthDeskStatusCount[];
  };
  months: MonthDeskFolder[];
};

/** Pacific YYYY-MM for an instant, or null when it is not a real time. */
export function instantPeriod(iso: string | null | undefined): string | null {
  const raw = (iso || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = MONTH_KEY.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  const period = `${part("year")}-${part("month")}`;
  return isValidPeriod(period) ? period : null;
}

function firstScheduledInstant(input: CountsForMonthInput): string | null {
  const own = (input.scheduled_send_at || "").trim();
  if (own) return own;
  const sends = (input.email_sends || [])
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .sort();
  return sends[0] || null;
}

/**
 * Month a campaign is filed under on this view.
 * 1. `board_period` when it is a YYYY-MM (the stored Counts for month).
 * 2. Otherwise the business-timezone month of the campaign send time.
 * 3. Otherwise the earliest item send time (packages schedule each item).
 * 4. Otherwise the business-timezone month of `created_at`.
 *
 * Null `board_period` is not rewritten. The lifecycle board still treats a
 * null as the UTC month of `created_at`.
 */
export function countsForMonth(
  input: CountsForMonthInput,
  now = new Date()
): string {
  const pinned = (input.board_period || "").trim();
  if (isValidPeriod(pinned)) return pinned;
  const fromSend = instantPeriod(firstScheduledInstant(input));
  if (fromSend) return fromSend;
  const fromCreated = instantPeriod(input.created_at);
  if (fromCreated) return fromCreated;
  return currentPeriod(now);
}

/**
 * Next-month numerator, and the inverse of the "by the 1st" flag.
 * Channel is unused: internal approval is stored as status `approved`, which
 * is already in the list. It is accepted so callers can pass the row as-is.
 */
export function countsTowardNextMonthDesk(
  status: string | null | undefined,
  approvedChannel?: string | null
): boolean {
  void approvedChannel;
  return SENT_FOR_INTERNAL.has((status || "").trim());
}

/**
 * This-month numerator. Client approval, or scheduled / sent / live.
 * Internal approval alone does not count. Sent to the client (`in_review`)
 * and client change requests (`needs_changes`) do not count.
 */
export function countsTowardThisMonthDesk(
  status: string | null | undefined,
  approvedChannel?: string | null
): boolean {
  const stored = (status || "").trim();
  if (CLIENT_DONE.has(stored)) return true;
  if (stored === "approved" && approvedChannel !== "internal") return true;
  return false;
}

/** Next month only: still draft (or any status before internal review). */
export function needsApprovalByTheFirst(
  status: string | null | undefined,
  approvedChannel?: string | null
): boolean {
  return !countsTowardNextMonthDesk(status, approvedChannel);
}

export function deliverableTone(
  which: "this" | "next",
  done: number,
  target: number
): MonthDeskTone {
  if (target <= 0) return "unset";
  if (done >= target) return "complete";
  if (which === "this" && done <= 0) return "behind";
  return "partial";
}

export function deliverableText(done: number, target: number): string {
  if (target > 0) return `${done}/${target}`;
  return String(done);
}

export function deskClientKey(
  clientId: string | null | undefined,
  clientName: string | null | undefined
): string {
  const id = (clientId || "").trim();
  if (id) return id;
  const name = (clientName || "").trim().toLowerCase();
  return name ? `name:${name}` : "name:";
}

function attentionRank(card: {
  nextMonth: { needsApproval: number; done: number; target: number };
  thisMonth: { tone: MonthDeskTone };
}): number {
  if (card.nextMonth.needsApproval > 0) return 0;
  if (card.nextMonth.target > 0 && card.nextMonth.done < card.nextMonth.target) return 1;
  if (card.thisMonth.tone === "behind") return 2;
  return 3;
}

export function sortDeskCards<T extends {
  key: string;
  name: string;
  thisMonth: { tone: MonthDeskTone };
  nextMonth: { needsApproval: number; done: number; target: number };
}>(cards: T[], sort: "name" | "attention"): T[] {
  const copy = [...cards];
  copy.sort((a, b) => {
    if (sort === "attention") {
      const rank = attentionRank(a) - attentionRank(b);
      if (rank !== 0) return rank;
    }
    return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
  return copy;
}

function statusCounts(campaigns: MonthDeskCampaignInput[]): MonthDeskStatusCount[] {
  const counts = new Map<string, number>();
  for (const campaign of campaigns) {
    const value = operatorStatusValue(campaign.status, campaign.approved_channel);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const known = new Set<string>();
  const ordered: MonthDeskStatusCount[] = [];
  for (const value of [
    "draft",
    "internal_review",
    "needs_revisions_internal",
    "revisions_made",
    "approved_internally",
    "in_review",
    "needs_changes",
    "approved",
    "scheduled",
    "sent",
    "live",
  ]) {
    const count = counts.get(value);
    if (!count) continue;
    known.add(value);
    ordered.push({
      value,
      label: operatorStatusLabel(
        value === "approved_internally" ? "approved" : value,
        value === "approved_internally" ? "internal" : null
      ),
      count,
    });
  }
  for (const [value, count] of counts) {
    if (known.has(value)) continue;
    ordered.push({ value, label: operatorStatusLabel(value), count });
  }
  return ordered;
}

function folderRole(
  period: string,
  current: string,
  next: string
): MonthDeskFolderRole {
  if (period === next) return "next";
  if (period === current) return "current";
  if (period > next) return "later";
  return "past";
}

function progressFor(
  which: "this" | "next",
  period: string,
  campaigns: MonthDeskCampaignInput[],
  target: number
): MonthDeskProgress {
  const done = campaigns.filter((campaign) =>
    which === "next"
      ? countsTowardNextMonthDesk(campaign.status, campaign.approved_channel)
      : countsTowardThisMonthDesk(campaign.status, campaign.approved_channel)
  ).length;
  return {
    period,
    label: periodLabel(period),
    done,
    target,
    tone: deliverableTone(which, done, target),
  };
}

/**
 * One pass over the campaigns the viewer is allowed to see.
 * `includeEmptyClients` is for admins looking at every active client. Account
 * managers pass false so a client with no visible campaign stays off the grid.
 */
export function buildMonthDesk(input: {
  campaigns: MonthDeskCampaignInput[];
  clients: MonthDeskClientInput[];
  includeEmptyClients: boolean;
  now?: Date;
}): { period: string; nextPeriod: string; clients: MonthDeskCard[] } {
  const now = input.now ?? new Date();
  const period = currentPeriod(now);
  const nextPeriod = shiftPeriod(period, 1);
  const nowIso = now.toISOString();

  const byId = new Map(input.clients.map((client) => [client.id, client]));
  const byName = new Map<string, MonthDeskClientInput>();
  for (const client of input.clients) {
    const name = client.name.trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, client);
  }

  type Bucket = {
    key: string;
    id: string | null;
    name: string;
    logoUrl: string | null;
    website: string;
    target: number;
    active: boolean;
    campaigns: MonthDeskCampaignInput[];
  };
  const buckets = new Map<string, Bucket>();

  const ensure = (bucket: Bucket) => {
    const existing = buckets.get(bucket.key);
    if (existing) return existing;
    buckets.set(bucket.key, bucket);
    return bucket;
  };

  if (input.includeEmptyClients) {
    for (const client of input.clients) {
      if (!client.active) continue;
      ensure({
        key: client.id,
        id: client.id,
        name: client.name,
        logoUrl: client.logoUrl || null,
        website: (client.website || "").trim(),
        target: Math.max(0, client.monthly_email_quota || 0),
        active: true,
        campaigns: [],
      });
    }
  }

  for (const campaign of input.campaigns) {
    const linked =
      (campaign.client_id && byId.get(campaign.client_id)) ||
      byName.get((campaign.client_name || "").trim().toLowerCase()) ||
      null;
    const key = linked
      ? linked.id
      : deskClientKey(campaign.client_id, campaign.client_name);
    const bucket = ensure({
      key,
      id: linked?.id || null,
      name: linked?.name || (campaign.client_name || "").trim() || "No client",
      logoUrl: linked?.logoUrl || null,
      website: (linked?.website || "").trim(),
      target: Math.max(0, linked?.monthly_email_quota || 0),
      active: linked ? linked.active : true,
      campaigns: [],
    });
    bucket.campaigns.push(campaign);
  }

  const cards: MonthDeskCard[] = [];
  for (const bucket of buckets.values()) {
    const byPeriod = new Map<string, MonthDeskCampaignInput[]>();
    for (const campaign of bucket.campaigns) {
      const month = countsForMonth(campaign, now);
      const list = byPeriod.get(month) || [];
      list.push(campaign);
      byPeriod.set(month, list);
    }

    const periods = new Set<string>([period, nextPeriod, ...byPeriod.keys()]);
    const ordered = [...periods].sort((a, b) => {
      const rank = (value: string) => {
        if (value === nextPeriod) return 0;
        if (value > nextPeriod) return 1;
        if (value === period) return 2;
        return 3;
      };
      const left = rank(a);
      const right = rank(b);
      if (left !== right) return left - right;
      if (left === 3) return a < b ? 1 : -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const months: MonthDeskFolder[] = ordered.map((month) => {
      const rows = byPeriod.get(month) || [];
      const role = folderRole(month, period, nextPeriod);
      const which = role === "next" ? "next" : "this";
      const campaigns = rows
        .map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          approved_channel: row.approved_channel || null,
          sendAt: pickDisplayedSendAt(
            [row.scheduled_send_at, ...(row.email_sends || [])],
            nowIso
          ).at,
          period: month,
        }))
        .sort((a, b) => {
          if (a.sendAt === b.sendAt) return a.title.localeCompare(b.title);
          if (!a.sendAt) return 1;
          if (!b.sendAt) return -1;
          return a.sendAt < b.sendAt ? -1 : 1;
        });
      const needsApproval =
        role === "next"
          ? rows.filter((row) =>
              needsApprovalByTheFirst(row.status, row.approved_channel)
            ).length
          : 0;
      return {
        period: month,
        label: periodLabel(month),
        role,
        campaignCount: rows.length,
        done: progressFor(which, month, rows, bucket.target).done,
        needsApproval,
        campaigns,
      };
    });

    const thisRows = byPeriod.get(period) || [];
    const nextRows = byPeriod.get(nextPeriod) || [];
    const thisMonth = progressFor("this", period, thisRows, bucket.target);
    const nextBase = progressFor("next", nextPeriod, nextRows, bucket.target);
    cards.push({
      key: bucket.key,
      id: bucket.id,
      name: bucket.name,
      logoUrl: bucket.logoUrl,
      website: bucket.website,
      target: bucket.target,
      thisMonth,
      nextMonth: {
        ...nextBase,
        needsApproval: nextRows.filter((row) =>
          needsApprovalByTheFirst(row.status, row.approved_channel)
        ).length,
        statuses: statusCounts(nextRows),
      },
      months,
    });
  }

  return { period, nextPeriod, clients: sortDeskCards(cards, "name") };
}
