/**
 * The Status tab's daily briefing: this month's Deliverables board, ranked
 * into what Michael should do next, who is waiting on a client, and who is
 * still short of contracted emails.
 *
 * Pure ranking. The dashboard loads the cards; this file does not touch SQLite,
 * so the order can be tested without standing up a board.
 */

export type BriefingColumn =
  | "triage"
  | "next_up"
  | "qa"
  | "internal_revisions"
  | "sent_for_approval"
  | "follow_up_sent"
  | "needs_revisions"
  | "scheduling"
  | "completed"
  | "deliverables_met";

export interface BriefingCard {
  clientId: string;
  clientName: string;
  columnKey: BriefingColumn | string;
  quota: number;
  delivered: number;
  campaigns: Array<{ id: string; title: string; hasCard?: boolean; status?: string }>;
}

export interface BriefingItem {
  clientId: string;
  clientName: string;
  columnKey: string;
  columnLabel: string;
  why: string;
  quota: number;
  delivered: number;
  remaining: number;
  campaigns: Array<{ id: string; title: string; hasCard: boolean }>;
}

export interface MonthBriefing {
  myQueue: BriefingItem[];
  waitingOnClient: BriefingItem[];
  behindQuota: BriefingItem[];
  notStarted: number;
  met: number;
  inPipeline: number;
}

const COLUMN_LABEL: Record<string, string> = {
  triage: "Triage",
  next_up: "Next Up",
  qa: "Sent for QA Check",
  internal_revisions: "Internal Revisions",
  sent_for_approval: "Sent for Approval",
  follow_up_sent: "Follow-Up Sent",
  needs_revisions: "Needs Revisions",
  scheduling: "Needs Scheduling",
  completed: "Completed",
  deliverables_met: "Deliverables Met",
};

const WHY: Record<string, string> = {
  next_up: "Picked up — not in QA yet",
  qa: "Waiting on QA",
  internal_revisions: "Internal revisions",
  needs_revisions: "Client sent notes",
  scheduling: "Approved — needs scheduling",
  sent_for_approval: "Sitting with the client",
  follow_up_sent: "Followed up, still waiting",
};

// Worst first: client notes, then approved-but-unscheduled, then QA, then
// internal polish, then work that has only been picked up.
const QUEUE_ORDER = [
  "needs_revisions",
  "scheduling",
  "qa",
  "internal_revisions",
  "next_up",
] as const;

const QUEUE = new Set<string>(QUEUE_ORDER);
const WAITING = new Set(["sent_for_approval", "follow_up_sent"]);

function remaining(card: BriefingCard): number {
  return Math.max(0, card.quota - card.delivered);
}

function toItem(card: BriefingCard): BriefingItem {
  return {
    clientId: card.clientId,
    clientName: card.clientName,
    columnKey: card.columnKey,
    columnLabel: COLUMN_LABEL[card.columnKey] || card.columnKey,
    why: WHY[card.columnKey] || COLUMN_LABEL[card.columnKey] || card.columnKey,
    quota: card.quota,
    delivered: card.delivered,
    remaining: remaining(card),
    campaigns: card.campaigns
      .filter((c) => c.id && c.title)
      .map((c) => ({
        id: c.id,
        title: c.title,
        hasCard: Boolean(c.hasCard),
      })),
  };
}

export function buildMonthBriefing(cards: BriefingCard[]): MonthBriefing {
  const myQueue = cards
    .filter((c) => QUEUE.has(c.columnKey))
    .sort((a, b) => {
      const ai = QUEUE_ORDER.indexOf(a.columnKey as (typeof QUEUE_ORDER)[number]);
      const bi = QUEUE_ORDER.indexOf(b.columnKey as (typeof QUEUE_ORDER)[number]);
      return ai - bi || a.clientName.localeCompare(b.clientName);
    })
    .map(toItem);

  const waitingOnClient = cards
    .filter((c) => WAITING.has(c.columnKey))
    .sort((a, b) => a.clientName.localeCompare(b.clientName))
    .map(toItem);

  const behindQuota = cards
    .filter(
      (c) =>
        c.quota > 0 &&
        c.delivered < c.quota &&
        c.columnKey !== "deliverables_met"
    )
    .sort(
      (a, b) => remaining(b) - remaining(a) || a.clientName.localeCompare(b.clientName)
    )
    .map(toItem);

  const notStarted = cards.filter((c) => c.columnKey === "triage" && c.quota > 0).length;
  // `delivered` is emails already sent to the client for approval.
  const met = cards.filter(
    (c) =>
      c.columnKey === "deliverables_met" || (c.quota > 0 && c.delivered >= c.quota)
  ).length;
  const inPipeline = cards.filter((c) => c.columnKey !== "triage").length;

  return { myQueue, waitingOnClient, behindQuota, notStarted, met, inPipeline };
}
