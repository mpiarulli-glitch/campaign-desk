// Report builders.
//
// Every report resolves to the same shape (a header, some summary figures, and
// a list of sections that are each either stat tiles or a table). That is what
// lets one screen renderer and one print stylesheet serve all six, and makes a
// seventh report a single builder rather than a new page.
//
// Reports are read-only aggregations over existing tables. Nothing here writes.

import { getDb } from "./db";
import {
  clientsMissingProjectId,
  lastMessageSyncAt,
  listCachedClientMessages,
  threadUrl,
} from "./basecamp-messages";
import { WEEKLY_CAPACITY_HOURS } from "./forecast";
import { PEOPLE, personLabel, teamLabelFor } from "./people";
import { teamLabel } from "./team";

export type ReportType =
  | "account_health"
  | "delivery_vs_contract"
  | "contract_runway"
  | "time_tracking"
  | "capacity"
  | "approvals_ageing"
  | "client_messages"
  | "okrs"
  | "weekly_snapshots"
  | "deliverables"
  | "team_sentiment"
  | "client_sentiment";

export interface ReportMeta {
  type: ReportType;
  label: string;
  // One line, shown under the picker, explaining what the report answers.
  blurb: string;
  // Whether the date range is meaningful for this report. OKRs and deliverables
  // describe a current state rather than a period, so a range would imply a
  // filter that does not exist.
  ranged: boolean;
}

export const REPORTS: ReportMeta[] = [
  {
    type: "account_health",
    label: "Account health",
    blurb: "Every warning sign against every client, worst first.",
    ranged: false,
  },
  {
    type: "delivery_vs_contract",
    label: "Delivery vs contract",
    blurb: "What each client is owed against what has actually been reported.",
    ranged: true,
  },
  {
    type: "contract_runway",
    label: "Contract runway",
    blurb: "Which contracts have expired or run out within 90 days.",
    ranged: false,
  },
  {
    type: "time_tracking",
    label: "Time tracking",
    blurb: "Forecast hours against hours actually logged, by person and client.",
    ranged: true,
  },
  {
    type: "capacity",
    label: "Capacity",
    blurb: "How much work is urgent, important or flexible, and whose hours could move.",
    ranged: true,
  },
  {
    type: "approvals_ageing",
    label: "Approvals ageing",
    blurb: "How long review packages have been waiting, on the client and on us.",
    ranged: true,
  },
  {
    type: "client_messages",
    label: "Unanswered client messages",
    blurb: "Basecamp threads where a client spoke last and nobody has replied.",
    ranged: false,
  },
  {
    type: "okrs",
    label: "OKRs",
    blurb: "Every client objective, its key results, and where it stands.",
    ranged: false,
  },
  {
    type: "weekly_snapshots",
    label: "Weekly snapshots",
    blurb: "What was reported done, per client, week by week.",
    ranged: true,
  },
  {
    type: "deliverables",
    label: "Deliverables",
    blurb: "What each client is owed, and how much of it has been reported on.",
    ranged: false,
  },
  {
    type: "team_sentiment",
    label: "Team sentiment",
    blurb: "Monthly check-in scores, the trend, and who has not checked in.",
    ranged: true,
  },
  {
    type: "client_sentiment",
    label: "Client sentiment",
    blurb: "Health flags raised against clients, open and resolved.",
    ranged: true,
  },
];

export function isReportType(v: unknown): v is ReportType {
  return REPORTS.some((r) => r.type === v);
}

export function reportMeta(type: ReportType): ReportMeta {
  return REPORTS.find((r) => r.type === type)!;
}

export interface ReportStat {
  label: string;
  value: string;
  hint?: string;
}

export interface ReportSection {
  title: string;
  // A section is stat tiles or a table, not both.
  stats?: ReportStat[];
  columns?: string[];
  rows?: string[][];
  // Column indexes to right-align, for figures.
  numeric?: number[];
  // Shown instead of the table when there is nothing to show.
  empty?: string;
  // One destination per row, aligned to `rows` by index. A null or empty entry
  // renders as plain text, so a row whose source has no URL degrades quietly
  // rather than becoming a dead link.
  rowLinks?: Array<string | null>;
  // Which cell carries the link. Defaults to the first column, which is the
  // naming column in every table here.
  linkColumn?: number;
}

export interface Report {
  type: ReportType;
  title: string;
  subtitle: string;
  range: { start: string; end: string } | null;
  generatedAt: string;
  sections: ReportSection[];
}

/* ------------------------------------------------------------------ helpers */

function clientNames(): Map<string, string> {
  const rows = getDb()
    .prepare(`SELECT id, name FROM rev_clients`)
    .all() as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

function hrs(n: number): string {
  // Trailing .0 on whole hours reads as noise in a column of figures.
  return Number.isInteger(n) ? `${n}h` : `${n.toFixed(2).replace(/0$/, "")}h`;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function prettyDate(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function titleCaseStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------- 1. time tracking */

/* ---------------------------------------------------- account health */

// Thresholds at which a signal counts against an account. Named rather than
// inlined so the report can state its own rules on screen — a risk count nobody
// can interrogate is a risk count nobody trusts.
const HEALTH = {
  approvalDays: 14,
  messageDays: 7,
  quietWeeks: 3,
};

/**
 * One row per client, pulling every warning sign into the same place.
 *
 * Deliberately NOT a 0-100 score. Any weighting across "an open red flag" and
 * "a deliverable nobody reported on" would be invented, and an opaque number
 * invites arguing with the scale instead of acting on the account. Instead each
 * account carries a count of triggered signals, and every signal is shown
 * alongside it so the count can be checked.
 *
 * Not ranged: this is the state of the book right now.
 */
function accountHealth(): ReportSection[] {
  const db = getDb();
  const now = Date.now();

  const clients = db
    .prepare(`SELECT id, name FROM rev_clients WHERE active = 1 ORDER BY name`)
    .all() as Array<{ id: string; name: string }>;

  const openFlags = new Map<string, { n: number; worst: string }>();
  for (const f of db
    .prepare(`SELECT client_id, level FROM client_flags WHERE resolved = 0`)
    .all() as Array<{ client_id: string; level: string }>) {
    const e = openFlags.get(f.client_id) || { n: 0, worst: "" };
    e.n += 1;
    if (f.level === "red" || (f.level === "yellow" && e.worst !== "red")) e.worst = f.level;
    openFlags.set(f.client_id, e);
  }

  const oldestApproval = new Map<string, number>();
  for (const c of db
    .prepare(
      `SELECT client_id, COALESCE(NULLIF(basecamp_approval_sent_at, ''), updated_at) AS since
         FROM campaigns
        WHERE archived_at IS NULL AND status IN ('in_review', 'needs_changes')
          AND client_id IS NOT NULL`
    )
    .all() as Array<{ client_id: string; since: string }>) {
    const age = daysSince(c.since, now);
    oldestApproval.set(c.client_id, Math.max(oldestApproval.get(c.client_id) || 0, age));
  }

  const oldestMessage = new Map<string, number>();
  for (const m of db
    .prepare(
      `SELECT client_id, last_client_at FROM basecamp_client_messages
        WHERE awaiting_reply = 1 AND client_id IS NOT NULL`
    )
    .all() as Array<{ client_id: string; last_client_at: string }>) {
    const age = daysSince(m.last_client_at, now);
    oldestMessage.set(m.client_id, Math.max(oldestMessage.get(m.client_id) || 0, age));
  }

  const delivery = db
    .prepare(
      `SELECT d.client_id,
              COUNT(*) AS owed,
              SUM(CASE WHEN (SELECT COUNT(*) FROM snapshot_entries e
                              WHERE e.deliverable_id = d.id) = 0 THEN 1 ELSE 0 END) AS never
         FROM snapshot_deliverables d
        WHERE d.active = 1
        GROUP BY d.client_id`
    )
    .all() as Array<{ client_id: string; owed: number; never: number }>;
  const owedBy = new Map(delivery.map((d) => [d.client_id, d]));

  const lastEntry = new Map<string, string>();
  for (const e of db
    .prepare(`SELECT client_id, MAX(week_start) AS w FROM snapshot_entries GROUP BY client_id`)
    .all() as Array<{ client_id: string; w: string }>) {
    lastEntry.set(e.client_id, e.w);
  }

  const scored = clients.map((c) => {
    const flags = openFlags.get(c.id);
    const approval = oldestApproval.get(c.id) || 0;
    const message = oldestMessage.get(c.id) || 0;
    const owed = owedBy.get(c.id);
    const last = lastEntry.get(c.id);
    const quietWeeks = last ? Math.floor(daysSince(last, now) / 7) : null;

    const signals: string[] = [];
    if (flags?.n) signals.push(`${flags.n} open flag${flags.n === 1 ? "" : "s"}`);
    if (approval >= HEALTH.approvalDays) signals.push(`approval ${approval}d`);
    if (message >= HEALTH.messageDays) signals.push(`message ${message}d`);
    if (owed?.never) signals.push(`${owed.never} unreported`);
    if (quietWeeks === null) signals.push("never reported");
    else if (quietWeeks >= HEALTH.quietWeeks) signals.push(`quiet ${quietWeeks}w`);

    return {
      name: c.name,
      risk: signals.length,
      flags: flags?.n || 0,
      worst: flags?.worst || "",
      approval,
      message,
      owed: owed?.owed || 0,
      never: owed?.never || 0,
      quietWeeks,
      signals,
    };
  });

  const atRisk = scored.filter((s) => s.risk > 0).sort((a, b) => b.risk - a.risk);
  const clean = scored.length - atRisk.length;

  return [
    {
      title: "The book at a glance",
      stats: [
        { label: "Active clients", value: String(scored.length) },
        {
          label: "Showing no warnings",
          value: String(clean),
          hint: pct(clean, scored.length) + " of the book",
        },
        {
          label: "Two or more warnings",
          value: String(atRisk.filter((s) => s.risk >= 2).length),
          hint: "worth a conversation this week",
        },
        {
          label: "With an open flag",
          value: String(scored.filter((s) => s.flags).length),
          hint: "raised and unresolved",
        },
      ],
    },
    {
      title: "Accounts with warnings, worst first",
      columns: [
        "Client", "Warnings", "Open flags", "Oldest approval",
        "Oldest message", "Unreported", "Quiet for", "What is wrong",
      ],
      numeric: [1, 2, 3, 4, 5, 6],
      empty: "No account is showing a warning.",
      rows: atRisk.map((s) => [
        s.name,
        String(s.risk),
        s.flags ? `${s.flags}${s.worst ? ` (${s.worst})` : ""}` : "—",
        s.approval ? `${s.approval}d` : "—",
        s.message ? `${s.message}d` : "—",
        s.never ? `${s.never} of ${s.owed}` : "—",
        s.quietWeeks === null ? "never" : s.quietWeeks ? `${s.quietWeeks}w` : "—",
        s.signals.join(", "),
      ]),
    },
    {
      title: "What counts as a warning",
      stats: [
        { label: "Open flag", value: "any", hint: "raised against the client, unresolved" },
        { label: "Approval waiting", value: `${HEALTH.approvalDays}d+`, hint: "oldest package in review" },
        { label: "Message unanswered", value: `${HEALTH.messageDays}d+`, hint: "client spoke last in Basecamp" },
        { label: "Snapshot quiet", value: `${HEALTH.quietWeeks}w+`, hint: "no entry reported for the client" },
      ],
    },
  ];
}

/* ------------------------------------------------ delivery against contract */

// Statuses that mean a deliverable actually landed, as opposed to being talked
// about. Anything else is work in flight. Interpolated into the query below so
// the list lives in one place rather than being restated in SQL.
const FINISHED_STATUSES = ["completed", "approved", "shared"] as const;
const FINISHED_SQL = FINISHED_STATUSES.map((s) => `'${s}'`).join(", ");

// A deliverable with no entry for this long has gone quiet. Snapshot entries are
// weekly, so three weeks is three missed reports rather than a late one.
const STALE_WEEKS = 3;

interface DeliverableRow {
  id: string;
  client_id: string;
  name: string;
  category: string;
  cadence: string;
  entries: number;
  finished: number;
  last_week: string | null;
}

/**
 * Are we delivering what we sold?
 *
 * This is coverage, not unit counting, and the difference is deliberate. The
 * data cannot support "you were owed two blogs and got two":
 *
 *   - cadence is free text, and half the active deliverables have none at all.
 *     What is there ranges from "2x / month" through "Bi-monthly" (which reads
 *     both as twice a month and every second month) to "$1K/mo managed", which
 *     is a budget rather than a count.
 *   - snapshot_entries are weekly status rows, one per deliverable per week.
 *     They record that something was reported, not how many things shipped.
 *
 * Counting either as deliveries would invent a number. So this reports what the
 * data does support: which owed deliverables have never been reported on, which
 * have gone quiet, and which never reach a finished status. The cadence gap is
 * surfaced as its own finding, because a contract nobody wrote a cadence for is
 * a contract nobody can be held to.
 */
function deliveryVsContract(start: string, end: string): ReportSection[] {
  const names = clientNames();
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.client_id, d.name, d.category, d.cadence,
              (SELECT COUNT(*) FROM snapshot_entries e
                WHERE e.deliverable_id = d.id
                  AND e.week_start >= ? AND e.week_start <= ?) AS entries,
              (SELECT COUNT(*) FROM snapshot_entries e
                WHERE e.deliverable_id = d.id
                  AND e.week_start >= ? AND e.week_start <= ?
                  AND e.status IN (${FINISHED_SQL})) AS finished,
              (SELECT MAX(e.week_start) FROM snapshot_entries e
                WHERE e.deliverable_id = d.id) AS last_week
         FROM snapshot_deliverables d
        WHERE d.active = 1
        ORDER BY d.client_id, d.sort_order`
    )
    .all(start, end, start, end) as DeliverableRow[];

  const now = Date.now();
  const weeksSince = (week: string | null) =>
    week ? Math.floor(daysSince(week, now) / 7) : null;

  const never = rows.filter((r) => !r.entries);
  const talkedAbout = rows.filter((r) => r.entries && !r.finished);
  const stalled = rows.filter((r) => {
    const w = weeksSince(r.last_week);
    return w === null || w >= STALE_WEEKS;
  });
  const noCadence = rows.filter((r) => !r.cadence.trim());

  const byClient = new Map<
    string,
    { owed: number; reported: number; finished: number; never: number }
  >();
  for (const r of rows) {
    const key = names.get(r.client_id) || "Unknown client";
    const e = byClient.get(key) || { owed: 0, reported: 0, finished: 0, never: 0 };
    e.owed += 1;
    if (r.entries) e.reported += 1;
    else e.never += 1;
    if (r.finished) e.finished += 1;
    byClient.set(key, e);
  }

  return [
    {
      title: "Coverage in this range",
      stats: [
        { label: "Active deliverables", value: String(rows.length), hint: "what we owe" },
        {
          label: "Reported on",
          value: pct(rows.length - never.length, rows.length),
          hint: `${rows.length - never.length} of ${rows.length}`,
        },
        {
          label: "Nothing reported",
          value: String(never.length),
          hint: never.length ? "no entry in this range" : "all covered",
        },
        {
          label: "Reported, never finished",
          value: String(talkedAbout.length),
          hint: "no completed, approved or shared entry",
        },
      ],
    },
    {
      title: "By client",
      columns: ["Client", "Owed", "Reported", "Finished", "Nothing reported", "Coverage"],
      numeric: [1, 2, 3, 4, 5],
      empty: "No active deliverables.",
      rows: [...byClient.entries()]
        .sort((a, b) => b[1].never - a[1].never || a[0].localeCompare(b[0]))
        .map(([client, e]) => [
          client,
          String(e.owed),
          String(e.reported),
          String(e.finished),
          String(e.never),
          pct(e.reported, e.owed),
        ]),
    },
    {
      title: `Gone quiet: no entry for ${STALE_WEEKS}+ weeks`,
      columns: ["Client", "Deliverable", "Category", "Last reported", "Weeks quiet"],
      numeric: [4],
      empty: "Everything owed has been reported on recently.",
      rows: stalled
        .map((r) => ({ r, w: weeksSince(r.last_week) }))
        .sort((a, b) => (b.w ?? 9999) - (a.w ?? 9999))
        .map(({ r, w }) => [
          names.get(r.client_id) || "Unknown client",
          r.name,
          r.category || "—",
          r.last_week ? prettyDate(r.last_week) : "Never",
          w === null ? "Never reported" : String(w),
        ]),
    },
    {
      title: "Deliverables with no cadence written down",
      columns: ["Client", "Deliverable", "Category"],
      empty: "Every active deliverable has a cadence.",
      rows: noCadence.map((r) => [
        names.get(r.client_id) || "Unknown client",
        r.name,
        r.category || "—",
      ]),
    },
  ];
}

/* --------------------------------------------------------- contract runway */

const RUNWAY_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "Already expired", min: -100000, max: -1 },
  { label: "Within 30 days", min: 0, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "Over 90 days", min: 91, max: 100000 },
];

/**
 * Which contracts are running out.
 *
 * Not ranged: a contract that expired last month is the most urgent row on the
 * page, and a date window would hide it.
 *
 * Clients with no contract_end are listed separately rather than treated as
 * open-ended. On the local snapshot that was every one of them, so an empty
 * report here means the dates are not filled in, not that nothing is expiring —
 * which is why the count is shown rather than left implicit.
 */
function contractRunway(): ReportSection[] {
  const rows = getDb()
    .prepare(
      `SELECT name, contract_start, contract_end, retainer, tier, account_manager
         FROM rev_clients
        WHERE active = 1`
    )
    .all() as Array<{
    name: string;
    contract_start: string | null;
    contract_end: string | null;
    retainer: number | null;
    tier: string | null;
    account_manager: string | null;
  }>;

  const today = new Date();
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysUntil = (ymd: string): number | null => {
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return null;
    return Math.round((Date.UTC(y, m - 1, d) - todayMs) / 86_400_000);
  };

  const dated: Array<{ name: string; end: string; days: number; tier: string; am: string }> = [];
  const undated: string[] = [];
  for (const r of rows) {
    const end = (r.contract_end || "").trim();
    const days = end ? daysUntil(end) : null;
    if (days === null) {
      undated.push(r.name);
      continue;
    }
    dated.push({
      name: r.name,
      end,
      days,
      tier: (r.tier || "").trim() || "—",
      am: (r.account_manager || "").trim() || "Unassigned",
    });
  }
  dated.sort((a, b) => a.days - b.days);

  const expired = dated.filter((d) => d.days < 0);
  const soon = dated.filter((d) => d.days >= 0 && d.days <= 90);

  return [
    {
      title: "Renewal pressure",
      stats: [
        { label: "Active clients", value: String(rows.length) },
        {
          label: "Expired",
          value: String(expired.length),
          hint: expired.length ? "past their end date" : "none past due",
        },
        {
          label: "Due within 90 days",
          value: String(soon.length),
          hint: soon.length ? `soonest ${soon[0].days}d` : "nothing due",
        },
        {
          label: "No end date",
          value: String(undated.length),
          hint: undated.length ? "not tracked, so not counted above" : "every contract dated",
        },
      ],
    },
    {
      title: "Runway",
      columns: ["When", "Clients"],
      numeric: [1],
      empty: "No contract end dates are recorded.",
      rows: dated.length
        ? RUNWAY_BUCKETS.map((b) => [
            b.label,
            String(dated.filter((d) => d.days >= b.min && d.days <= b.max).length),
          ])
        : [],
    },
    {
      title: "Expiring soonest",
      columns: ["Client", "Ends", "Days", "Tier", "Account manager"],
      numeric: [2],
      empty: "No contract end dates are recorded.",
      rows: dated
        .slice(0, 40)
        .map((d) => [
          d.name,
          prettyDate(d.end),
          d.days < 0 ? `${Math.abs(d.days)} ago` : String(d.days),
          d.tier,
          d.am,
        ]),
    },
    {
      title: "Clients with no contract end date",
      columns: ["Client"],
      empty: "Every active client has an end date.",
      rows: undated.map((n) => [n]),
    },
  ];
}

/* ------------------------------------------------------- unanswered clients */

/**
 * Basecamp threads where a client spoke last.
 *
 * Reads the basecamp_client_messages cache, never the API — see
 * basecamp-messages.ts for the sweep and for how "unanswered" is decided.
 *
 * Not ranged: this is a state of play, and an old unanswered message is the
 * one that matters most. A date filter would hide it.
 *
 * Two coverage caveats are reported on screen rather than left implicit, since
 * both make an empty result look like good news when it isn't: clients with no
 * Basecamp project id are invisible to the sweep, and a cache that has never
 * been synced is empty rather than clear.
 */
function clientMessages(): ReportSection[] {
  const all = listCachedClientMessages();
  const waiting = all
    .filter((m) => m.awaiting_reply)
    .map((m) => ({ ...m, age: daysSince(m.last_client_at, Date.now()) }))
    .sort((a, b) => b.age - a.age);

  const syncedAt = lastMessageSyncAt();
  const missing = clientsMissingProjectId();

  const byClient = new Map<string, { open: number; oldest: number }>();
  for (const m of waiting) {
    const key = m.client_name.trim() || "No client";
    const e = byClient.get(key) || { open: 0, oldest: 0 };
    e.open += 1;
    e.oldest = Math.max(e.oldest, m.age);
    byClient.set(key, e);
  }

  const coverage: ReportSection = {
    title: "Coverage",
    stats: [
      {
        label: "Last synced",
        value: syncedAt ? prettyDate(syncedAt.slice(0, 10)) : "Never",
        hint: syncedAt ? "from the Basecamp sweep" : "nothing has been pulled yet",
      },
      {
        label: "Threads tracked",
        value: String(all.length),
        hint: "client threads in the cache",
      },
      {
        label: "Clients not covered",
        value: String(missing.length),
        hint: missing.length ? "no Basecamp project id set" : "every client is mapped",
      },
    ],
  };

  return [
    {
      title: "Waiting on a reply",
      stats: [
        { label: "Unanswered", value: String(waiting.length), hint: "client spoke last" },
        {
          label: "Oldest",
          value: waiting.length ? `${waiting[0].age}d` : "—",
          hint: waiting.length ? waiting[0].client_name : "nothing waiting",
        },
        {
          label: "Median age",
          value: waiting.length ? `${median(waiting.map((m) => m.age))}d` : "—",
          hint: "since the client last posted",
        },
        {
          label: "Clients affected",
          value: String(byClient.size),
          hint: "with at least one unanswered",
        },
      ],
    },
    {
      title: "Age of unanswered messages",
      columns: ["Age", "Threads"],
      numeric: [1],
      empty: syncedAt
        ? "Nothing is waiting on a reply."
        : "Nothing has been synced from Basecamp yet.",
      rows: waiting.length
        ? AGE_BUCKETS.map((b) => [
            b.label,
            String(waiting.filter((m) => m.age >= b.min && m.age <= b.max).length),
          ])
        : [],
    },
    {
      title: "By client",
      columns: ["Client", "Unanswered", "Oldest"],
      numeric: [1, 2],
      empty: "Nothing is waiting on a reply.",
      rows: [...byClient.entries()]
        .sort((a, b) => b[1].oldest - a[1].oldest)
        .map(([client, e]) => [client, String(e.open), `${e.oldest}d`]),
    },
    {
      title: "Every unanswered thread, oldest first",
      columns: ["Thread", "Client", "Last posted by", "Waiting", "Replies"],
      numeric: [3, 4],
      empty: "Nothing is waiting on a reply.",
      // Straight through to the thread in Basecamp, so the list is something
      // you work from rather than something you then go hunting through.
      rowLinks: waiting.map((m) => threadUrl(m) || null),
      rows: waiting.map((m) => [
        m.title,
        m.client_name.trim() || "No client",
        m.author_name || "Unknown",
        `${m.age}d`,
        String(m.reply_count),
      ]),
    },
    coverage,
    {
      title: "Clients with no Basecamp project",
      columns: ["Client"],
      empty: "Every client is mapped to a Basecamp project.",
      rows: missing.map((n) => [n]),
    },
  ];
}

/* --------------------------------------------------------- approvals ageing */

// Age buckets. The top bucket is deliberately open-ended: an approval sitting
// past a month is the finding, and capping it would hide how far past.
const AGE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "0–3 days", min: 0, max: 3 },
  { label: "4–7 days", min: 4, max: 7 },
  { label: "8–14 days", min: 8, max: 14 },
  { label: "15–30 days", min: 15, max: 30 },
  { label: "Over 30 days", min: 31, max: Infinity },
];

function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * How long review packages have been waiting, and how long settled ones took.
 *
 * Two clocks, kept apart on purpose:
 *
 *   in_review     the ball is with the client
 *   needs_changes they have come back to us, so it is ours
 *
 * The open sections are always current, never filtered by the range. Filtering
 * them by a date window would drop the oldest items, which are the whole point
 * of an ageing report. The range applies only to the settled-approvals section
 * at the end.
 *
 * Age is measured from basecamp_approval_sent_at when it exists, and from
 * updated_at otherwise. Only packages sent through the Basecamp flow carry the
 * former, and updated_at moves on any edit, so a package edited while waiting
 * reads younger than it is. That understates age rather than overstating it,
 * which is the safer direction for a queue you are trying to clear.
 */
function approvalsAgeing(start: string, end: string): ReportSection[] {
  const db = getDb();
  const now = Date.now();

  const open = db
    .prepare(
      `SELECT c.id, c.title, c.client_name, c.status,
              COALESCE(NULLIF(c.basecamp_approval_sent_at, ''), c.updated_at) AS waiting_since,
              (SELECT COUNT(*) FROM comments cm
                WHERE cm.campaign_id = c.id AND cm.resolved = 0) AS open_comments
         FROM campaigns c
        WHERE c.archived_at IS NULL
          AND c.status IN ('in_review', 'needs_changes')`
    )
    .all() as Array<{
    id: string;
    title: string;
    client_name: string;
    status: string;
    waiting_since: string;
    open_comments: number;
  }>;

  const aged = open
    .map((r) => ({ ...r, age: daysSince(r.waiting_since, now) }))
    .sort((a, b) => b.age - a.age);

  const withClient = aged.filter((r) => r.status === "in_review");
  const withUs = aged.filter((r) => r.status === "needs_changes");

  // Settled approvals inside the range, for turnaround. approved_at is set when
  // a package is marked approved; created_at is the only reliable start, so
  // this is total time from upload to approval, not time on the client.
  const settled = db
    .prepare(
      `SELECT client_name, created_at, approved_at
         FROM campaigns
        WHERE approved_at IS NOT NULL
          AND date(approved_at) >= date(?)
          AND date(approved_at) <= date(?)`
    )
    .all(start, end) as Array<{
    client_name: string;
    created_at: string;
    approved_at: string;
  }>;

  const turnarounds = settled.map((r) =>
    Math.max(0, Math.floor((Date.parse(r.approved_at) - Date.parse(r.created_at)) / 86_400_000))
  );

  const byClient = new Map<string, { open: number; client: number; us: number; oldest: number }>();
  for (const r of aged) {
    const key = r.client_name.trim() || "No client";
    const e = byClient.get(key) || { open: 0, client: 0, us: 0, oldest: 0 };
    e.open += 1;
    if (r.status === "in_review") e.client += 1;
    else e.us += 1;
    e.oldest = Math.max(e.oldest, r.age);
    byClient.set(key, e);
  }

  const medianOpen = median(aged.map((r) => r.age));
  const medianTurnaround = median(turnarounds);

  return [
    {
      title: "Where things stand",
      stats: [
        { label: "Open approvals", value: String(aged.length), hint: "current, not range-filtered" },
        {
          label: "With the client",
          value: String(withClient.length),
          hint: withClient.length ? `oldest ${withClient[0].age}d` : "nothing waiting",
        },
        {
          label: "With us",
          value: String(withUs.length),
          hint: withUs.length ? `oldest ${withUs[0].age}d` : "nothing waiting",
        },
        {
          label: "Median age",
          value: medianOpen === null ? "—" : `${medianOpen}d`,
          hint: aged.length ? `oldest ${aged[0].age}d` : "nothing open",
        },
      ],
    },
    {
      title: "Age of open approvals",
      columns: ["Age", "Total", "With the client", "With us"],
      numeric: [1, 2, 3],
      empty: "Nothing is waiting on a decision.",
      rows: aged.length
        ? AGE_BUCKETS.map((b) => {
            const inBucket = aged.filter((r) => r.age >= b.min && r.age <= b.max);
            return [
              b.label,
              String(inBucket.length),
              String(inBucket.filter((r) => r.status === "in_review").length),
              String(inBucket.filter((r) => r.status === "needs_changes").length),
            ];
          })
        : [],
    },
    {
      title: "By client",
      columns: ["Client", "Open", "With the client", "With us", "Oldest"],
      numeric: [1, 2, 3, 4],
      empty: "Nothing is waiting on a decision.",
      rows: [...byClient.entries()]
        .sort((a, b) => b[1].oldest - a[1].oldest)
        .map(([client, e]) => [
          client,
          String(e.open),
          String(e.client),
          String(e.us),
          `${e.oldest}d`,
        ]),
    },
    {
      title: "Every open approval, oldest first",
      columns: ["Package", "Client", "Waiting on", "Age", "Open comments"],
      numeric: [3, 4],
      empty: "Nothing is waiting on a decision.",
      rows: aged.map((r) => [
        r.title,
        r.client_name.trim() || "No client",
        r.status === "in_review" ? "Client" : "Us",
        `${r.age}d`,
        String(r.open_comments),
      ]),
    },
    {
      title: "Approved in this range",
      stats: [
        { label: "Approved", value: String(settled.length), hint: `${prettyDate(start)} to ${prettyDate(end)}` },
        {
          label: "Median turnaround",
          value: medianTurnaround === null ? "—" : `${medianTurnaround}d`,
          hint: "upload to approval",
        },
        {
          label: "Slowest",
          value: turnarounds.length ? `${Math.max(...turnarounds)}d` : "—",
          hint: "upload to approval",
        },
      ],
    },
  ];
}

/* ----------------------------------------------------------------- capacity */

// Priority doubles as a traffic light everywhere in the UI: urgent is red,
// important is amber, flexible is green (see .pri-* in globals.css).
const LIGHTS = [
  { priority: "urgent", light: "Red", meaning: "urgent" },
  { priority: "important", light: "Yellow", meaning: "important" },
  { priority: "flexible", light: "Green", meaning: "flexible" },
] as const;

// A person owes WEEKLY_CAPACITY_HOURS over five weekdays, so a range's capacity
// is its workday count times the daily share. Counting calendar days instead
// would credit people with weekend hours they never had.
// Monday key for a YYYY-MM-DD date, so a person's forecast rows collapse into
// the set of weeks they actually planned.
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 Sun .. 6 Sat
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

function workdaysBetween(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cursor = new Date(ys, ms - 1, ds);
  const last = new Date(ye, me - 1, de);
  let n = 0;
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) n++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return n;
}

/**
 * Team capacity over a range: how much of the load is red, yellow or green, and
 * how many hours could be moved onto a project.
 *
 * Reallocatable is unbooked capacity plus hours already marked flexible —
 * flexible is the priority that says this can wait, so it is the honest pool to
 * pull from. Two things are deliberately never counted as available:
 *
 *   - urgent and important hours, which are committed work
 *   - meetings (rows carrying a basecamp_event_id), because createTask defaults
 *     an unset priority to flexible, and a booked meeting is not free time
 *
 * People with nothing forecast are listed apart rather than folded into the
 * totals: a blank range is not the same as a free one, and counting it as
 * capacity would overstate what the team can take on.
 */
function capacity(start: string, end: string): ReportSection[] {
  const rows = getDb()
    .prepare(
      `SELECT person, task_date, priority, hours, basecamp_event_id
         FROM forecast_tasks
        WHERE task_date >= ? AND task_date <= ?`
    )
    .all(start, end) as Array<{
    person: string;
    task_date: string;
    priority: string;
    hours: number;
    basecamp_event_id: string;
  }>;

  // Capacity is counted only for the weeks a person actually planned, never for
  // the whole range. People forecast week by week and only near-term, so
  // crediting someone with every week between two dates invents availability
  // that was never theirs: one hour logged in a quarter would otherwise read as
  // ~527 hours free. The range still decides which weeks are in scope; it just
  // no longer manufactures them.
  const rangeCeiling = workdaysBetween(start, end) * (WEEKLY_CAPACITY_HOURS / 5);

  type Entry = {
    tasks: Record<string, number>;
    hours: Record<string, number>;
    booked: number;
    movable: number;
    meetingHours: number;
    weeks: Set<string>;
  };
  const byPerson = new Map<string, Entry>();
  for (const r of rows) {
    const e =
      byPerson.get(r.person) || {
        tasks: { urgent: 0, important: 0, flexible: 0 },
        hours: { urgent: 0, important: 0, flexible: 0 },
        booked: 0,
        movable: 0,
        meetingHours: 0,
        weeks: new Set<string>(),
      };
    e.weeks.add(mondayOf(r.task_date));
    // A meeting consumes capacity but is not a task, so it counts towards what
    // is booked and nothing else. Leaving it out of the traffic light matters:
    // createTask defaults an unset priority to flexible, which would otherwise
    // file every booked meeting under "green, and therefore movable".
    e.booked += r.hours;
    if (r.basecamp_event_id) {
      e.meetingHours += r.hours;
    } else {
      e.tasks[r.priority] = (e.tasks[r.priority] || 0) + 1;
      e.hours[r.priority] = (e.hours[r.priority] || 0) + r.hours;
      if (r.priority === "flexible") e.movable += r.hours;
    }
    byPerson.set(r.person, e);
  }

  const people = PEOPLE.filter((p) => byPerson.has(p.slug)).map((p) => {
    const e = byPerson.get(p.slug)!;
    // Their weeks, not the range's. Capped by the range so a week hanging over
    // either edge can't credit days that were never in scope.
    const personCapacity = Math.min(e.weeks.size * WEEKLY_CAPACITY_HOURS, rangeCeiling);
    const free = Math.max(0, personCapacity - e.booked);
    return {
      label: personLabel(p.slug) || p.slug,
      ...e,
      capacity: personCapacity,
      free,
      reallocatable: free + e.movable,
      overbooked: e.booked > personCapacity,
    };
  });
  const noForecast = PEOPLE.filter((p) => !byPerson.has(p.slug));

  const sum = (pick: (p: (typeof people)[number]) => number) =>
    people.reduce((n, p) => n + pick(p), 0);
  const totalCapacity = sum((p) => p.capacity);
  const booked = sum((p) => p.booked);
  const free = sum((p) => p.free);
  const movable = sum((p) => p.movable);

  return [
    {
      title: "Traffic light",
      stats: [
        ...LIGHTS.map((l) => ({
          label: `${l.light} · ${l.meaning}`,
          value: String(sum((p) => p.tasks[l.priority] || 0)),
          hint: `${hrs(sum((p) => p.hours[l.priority] || 0))} forecast`,
        })),
        {
          label: "In meetings",
          value: hrs(sum((p) => p.meetingHours)),
          hint: "booked from the schedule, not a task",
        },
      ],
    },
    {
      title: "Hours you could move onto a project",
      stats: [
        {
          label: "Reallocatable",
          value: hrs(free + movable),
          hint: "unbooked plus flexible",
        },
        {
          label: "Unbooked",
          value: hrs(free),
          hint: `of ${hrs(totalCapacity)} in the weeks ${people.length} of ${PEOPLE.length} people planned`,
        },
        { label: "On flexible work", value: hrs(movable), hint: "meetings excluded" },
        {
          label: "Booked",
          value: hrs(booked),
          hint: pct(booked, totalCapacity) + " of capacity",
        },
      ],
    },
    {
      title: "By person",
      columns: ["Person", "Red", "Yellow", "Green", "Booked", "Free", "Reallocatable"],
      numeric: [1, 2, 3, 4, 5, 6],
      empty: "Nobody forecast anything in this range.",
      rows: people
        .sort((a, b) => b.reallocatable - a.reallocatable)
        .map((p) => [
          p.label,
          String(p.tasks.urgent || 0),
          String(p.tasks.important || 0),
          String(p.tasks.flexible || 0),
          p.overbooked ? `${hrs(p.booked)} (over)` : hrs(p.booked),
          hrs(p.free),
          hrs(p.reallocatable),
        ]),
    },
    {
      title: "No forecast entered",
      columns: ["Person"],
      empty: "Everyone forecast something in this range.",
      rows: noForecast.map((p) => [personLabel(p.slug) || p.slug]),
    },
  ];
}

function timeTracking(start: string, end: string): ReportSection[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT person, client, hours, actual_hours, completed,
              basecamp_event_id, basecamp_time_entry_id
       FROM forecast_tasks
       WHERE task_date >= ? AND task_date <= ?`
    )
    .all(start, end) as Array<{
    person: string;
    client: string;
    hours: number;
    actual_hours: number;
    completed: number;
    basecamp_event_id: string;
    basecamp_time_entry_id: string;
  }>;

  const forecast = rows.reduce((s, r) => s + r.hours, 0);
  const actual = rows.reduce((s, r) => s + r.actual_hours, 0);
  const logged = rows.filter((r) => r.basecamp_time_entry_id).length;
  const meetingHours = rows
    .filter((r) => r.basecamp_event_id)
    .reduce((s, r) => s + r.hours, 0);

  const byPerson = new Map<string, { f: number; a: number; n: number; done: number }>();
  for (const r of rows) {
    const e = byPerson.get(r.person) || { f: 0, a: 0, n: 0, done: 0 };
    e.f += r.hours;
    e.a += r.actual_hours;
    e.n += 1;
    if (r.completed) e.done += 1;
    byPerson.set(r.person, e);
  }

  const byClient = new Map<string, { f: number; a: number; n: number }>();
  for (const r of rows) {
    const key = r.client.trim() || "No client (internal)";
    const e = byClient.get(key) || { f: 0, a: 0, n: 0 };
    e.f += r.hours;
    e.a += r.actual_hours;
    e.n += 1;
    byClient.set(key, e);
  }

  return [
    {
      title: "Totals",
      stats: [
        { label: "Forecast hours", value: hrs(forecast), hint: `${rows.length} rows` },
        { label: "Hours logged", value: hrs(actual), hint: `${logged} sent to Basecamp` },
        {
          label: "Logged vs forecast",
          value: pct(actual, forecast),
          hint: actual > forecast ? "over the estimate" : "of what was planned",
        },
        { label: "In meetings", value: hrs(meetingHours), hint: "booked from the schedule" },
      ],
    },
    {
      title: "By person",
      columns: ["Person", "Rows", "Done", "Forecast", "Logged", "Logged vs forecast"],
      numeric: [1, 2, 3, 4, 5],
      empty: "No forecast rows in this range.",
      rows: [...byPerson.entries()]
        .sort((a, b) => b[1].f - a[1].f)
        .map(([person, e]) => [
          personLabel(person) || person,
          String(e.n),
          String(e.done),
          hrs(e.f),
          hrs(e.a),
          pct(e.a, e.f),
        ]),
    },
    {
      title: "By client",
      columns: ["Client", "Rows", "Forecast", "Logged"],
      numeric: [1, 2, 3],
      empty: "No forecast rows in this range.",
      rows: [...byClient.entries()]
        .sort((a, b) => b[1].f - a[1].f)
        .map(([client, e]) => [client, String(e.n), hrs(e.f), hrs(e.a)]),
    },
  ];
}

/* ----------------------------------------------------------------- 2. OKRs */

function okrs(): ReportSection[] {
  const names = clientNames();
  const rows = getDb()
    .prepare(
      `SELECT client_id, objective, key_results, target_date, status
       FROM client_okrs WHERE active = 1
       ORDER BY client_id, sort_order`
    )
    .all() as Array<{
    client_id: string;
    objective: string;
    key_results: string;
    target_date: string | null;
    status: string;
  }>;

  const byStatus = new Map<string, number>();
  let krTotal = 0;
  let krDone = 0;
  for (const r of rows) {
    byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
    try {
      const krs = JSON.parse(r.key_results) as Array<{ done?: boolean }>;
      krTotal += krs.length;
      krDone += krs.filter((k) => k.done).length;
    } catch {
      // A malformed key_results blob should not take the whole report down.
    }
  }

  return [
    {
      title: "Where things stand",
      stats: [
        { label: "Active objectives", value: String(rows.length) },
        { label: "On track", value: String(byStatus.get("on_track") || 0) },
        {
          label: "At risk or off track",
          value: String((byStatus.get("at_risk") || 0) + (byStatus.get("off_track") || 0)),
        },
        { label: "Key results met", value: pct(krDone, krTotal), hint: `${krDone} of ${krTotal}` },
      ],
    },
    {
      title: "Objectives",
      columns: ["Client", "Objective", "Status", "Key results", "Target"],
      numeric: [3],
      empty: "No active objectives.",
      rows: rows.map((r) => {
        let done = 0;
        let total = 0;
        try {
          const krs = JSON.parse(r.key_results) as Array<{ done?: boolean }>;
          total = krs.length;
          done = krs.filter((k) => k.done).length;
        } catch {
          /* counted as zero */
        }
        return [
          names.get(r.client_id) || "Unknown client",
          r.objective,
          titleCaseStatus(r.status),
          total ? `${done}/${total}` : "—",
          r.target_date ? prettyDate(r.target_date) : "—",
        ];
      }),
    },
  ];
}

/* ----------------------------------------------------- 3. weekly snapshots */

function weeklySnapshots(start: string, end: string): ReportSection[] {
  const names = clientNames();
  const rows = getDb()
    .prepare(
      `SELECT e.client_id, e.week_start, e.status, e.work_done, e.next_steps,
              d.name AS deliverable
       FROM snapshot_entries e
       LEFT JOIN snapshot_deliverables d ON d.id = e.deliverable_id
       WHERE e.week_start >= ? AND e.week_start <= ?
       ORDER BY e.week_start DESC, e.client_id`
    )
    .all(start, end) as Array<{
    client_id: string;
    week_start: string;
    status: string;
    work_done: string;
    next_steps: string;
    deliverable: string | null;
  }>;

  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
  const weeks = new Set(rows.map((r) => r.week_start));
  const clients = new Set(rows.map((r) => r.client_id));
  const done = byStatus.get("done") || 0;

  return [
    {
      title: "Coverage",
      stats: [
        { label: "Entries reported", value: String(rows.length) },
        { label: "Weeks covered", value: String(weeks.size) },
        { label: "Clients reported on", value: String(clients.size) },
        { label: "Marked done", value: pct(done, rows.length), hint: `${done} of ${rows.length}` },
      ],
    },
    {
      title: "By client",
      columns: ["Client", "Entries", "Done", "Weeks"],
      numeric: [1, 2, 3],
      empty: "No snapshot entries in this range.",
      rows: [...clients]
        .map((id) => {
          const mine = rows.filter((r) => r.client_id === id);
          return {
            name: names.get(id) || "Unknown client",
            n: mine.length,
            done: mine.filter((r) => r.status === "done").length,
            weeks: new Set(mine.map((r) => r.week_start)).size,
          };
        })
        .sort((a, b) => b.n - a.n)
        .map((c) => [c.name, String(c.n), String(c.done), String(c.weeks)]),
    },
    {
      title: "Entries",
      columns: ["Week", "Client", "Deliverable", "Status", "Work done"],
      empty: "No snapshot entries in this range.",
      rows: rows.map((r) => [
        prettyDate(r.week_start),
        names.get(r.client_id) || "Unknown client",
        r.deliverable || "—",
        titleCaseStatus(r.status),
        // Long prose would blow the column out on both screen and paper.
        r.work_done.length > 160 ? r.work_done.slice(0, 157) + "…" : r.work_done || "—",
      ]),
    },
  ];
}

/* -------------------------------------------------------- 4. deliverables */

function deliverables(): ReportSection[] {
  const names = clientNames();
  const rows = getDb()
    .prepare(
      `SELECT d.client_id, d.name, d.category, d.team, d.kind, d.cadence, d.cadence_unit,
              d.due_date, d.active,
              (SELECT COUNT(*) FROM snapshot_entries e WHERE e.deliverable_id = d.id) AS entries,
              (SELECT MAX(e.week_start) FROM snapshot_entries e WHERE e.deliverable_id = d.id) AS last_week
       FROM snapshot_deliverables d
       ORDER BY d.client_id, d.sort_order`
    )
    .all() as Array<{
    client_id: string;
    name: string;
    category: string;
    team: string;
    kind: string;
    cadence: string;
    cadence_unit: string;
    due_date: string | null;
    active: number;
    entries: number;
    last_week: string | null;
  }>;

  const active = rows.filter((r) => r.active);
  const neverReported = active.filter((r) => !r.entries);
  // Untagged deliverables are visible to every team, so a high count here means
  // the snapshot is not actually scoped yet.
  const untagged = active.filter((r) => !r.team);

  return [
    {
      title: "What is owed",
      stats: [
        { label: "Active deliverables", value: String(active.length) },
        { label: "Clients with deliverables", value: String(new Set(active.map((r) => r.client_id)).size) },
        { label: "Recurring", value: String(active.filter((r) => r.kind === "recurring").length) },
        {
          label: "Never reported on",
          value: String(neverReported.length),
          hint: neverReported.length ? "no snapshot entry yet" : "all covered",
        },
        {
          label: "No owning team",
          value: String(untagged.length),
          hint: untagged.length ? "shown to every team" : "all tagged",
        },
      ],
    },
    {
      title: "Deliverables",
      columns: ["Client", "Deliverable", "Category", "Team", "Kind", "Cadence", "Entries", "Last reported"],
      numeric: [6],
      empty: "No deliverables set up.",
      rows: active.map((r) => [
        names.get(r.client_id) || "Unknown client",
        r.name,
        r.category || "—",
        r.team ? teamLabelFor(r.team) : "Any",
        titleCaseStatus(r.kind),
        r.cadence || r.cadence_unit || "—",
        String(r.entries),
        r.last_week ? prettyDate(r.last_week) : "Never",
      ]),
    },
  ];
}

/* ------------------------------------------------------ 5. team sentiment */

function teamSentiment(start: string, end: string): ReportSection[] {
  // month is stored as YYYY-MM, so compare against the month part of the range.
  const from = start.slice(0, 7);
  const to = end.slice(0, 7);
  const rows = getDb()
    .prepare(
      `SELECT person, month, score, note FROM sentiment_checkins
       WHERE month >= ? AND month <= ?
       ORDER BY month DESC, person`
    )
    .all(from, to) as Array<{ person: string; month: string; score: number; note: string }>;

  const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
  const low = rows.filter((r) => r.score <= 2);

  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const list = byMonth.get(r.month) || [];
    list.push(r.score);
    byMonth.set(r.month, list);
  }

  // Who never checked in during the range, which is the number worth acting on.
  const checkedIn = new Set(rows.map((r) => r.person));
  const missing = PEOPLE.filter((p) => !checkedIn.has(p.slug)).map((p) => p.label);

  return [
    {
      title: "How the team is doing",
      stats: [
        { label: "Average score", value: rows.length ? avg.toFixed(1) : "—", hint: "out of 5" },
        { label: "Check-ins", value: String(rows.length), hint: `${checkedIn.size} people` },
        {
          label: "Scores of 2 or below",
          value: String(low.length),
          hint: low.length ? "worth a conversation" : "none",
        },
        {
          label: "Never checked in",
          value: String(missing.length),
          hint: missing.length ? missing.join(", ") : "everyone reported",
        },
      ],
    },
    {
      title: "By month",
      columns: ["Month", "Check-ins", "Average"],
      numeric: [1, 2],
      empty: "No check-ins in this range.",
      rows: [...byMonth.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, scores]) => [
          month,
          String(scores.length),
          (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1),
        ]),
    },
    {
      title: "Check-ins",
      columns: ["Month", "Person", "Score", "Note"],
      numeric: [2],
      empty: "No check-ins in this range.",
      rows: rows.map((r) => [
        r.month,
        teamLabel(r.person) || r.person,
        String(r.score),
        r.note.length > 160 ? r.note.slice(0, 157) + "…" : r.note || "—",
      ]),
    },
  ];
}

/* ---------------------------------------------------- 6. client sentiment */

function clientSentiment(start: string, end: string): ReportSection[] {
  const names = clientNames();
  // created_at is a full ISO timestamp, so compare against the day boundaries.
  const rows = getDb()
    .prepare(
      `SELECT client_id, level, note, created_by, resolved, resolved_by,
              resolved_at, created_at
       FROM client_flags
       WHERE date(created_at) >= ? AND date(created_at) <= ?
       ORDER BY created_at DESC`
    )
    .all(start, end) as Array<{
    client_id: string;
    level: string;
    note: string;
    created_by: string;
    resolved: number;
    resolved_by: string;
    resolved_at: string | null;
    created_at: string;
  }>;

  const open = rows.filter((r) => !r.resolved);
  const red = rows.filter((r) => r.level === "red");

  const byClient = new Map<string, { n: number; open: number; worst: string }>();
  const rank: Record<string, number> = { green: 0, yellow: 1, red: 2 };
  for (const r of rows) {
    const e = byClient.get(r.client_id) || { n: 0, open: 0, worst: "green" };
    e.n += 1;
    if (!r.resolved) e.open += 1;
    if ((rank[r.level] ?? 0) > (rank[e.worst] ?? 0)) e.worst = r.level;
    byClient.set(r.client_id, e);
  }

  return [
    {
      title: "Client health",
      stats: [
        { label: "Flags raised", value: String(rows.length) },
        { label: "Still open", value: String(open.length) },
        { label: "Red flags", value: String(red.length), hint: red.length ? "needs attention" : "none" },
        { label: "Clients flagged", value: String(byClient.size) },
      ],
    },
    {
      title: "By client",
      columns: ["Client", "Flags", "Open", "Worst level"],
      numeric: [1, 2],
      empty: "No flags raised in this range.",
      rows: [...byClient.entries()]
        .sort((a, b) => b[1].open - a[1].open || b[1].n - a[1].n)
        .map(([id, e]) => [
          names.get(id) || "Unknown client",
          String(e.n),
          String(e.open),
          titleCaseStatus(e.worst),
        ]),
    },
    {
      title: "Flags",
      columns: ["Raised", "Client", "Level", "Status", "Note", "By"],
      empty: "No flags raised in this range.",
      rows: rows.map((r) => [
        prettyDate(r.created_at.slice(0, 10)),
        names.get(r.client_id) || "Unknown client",
        titleCaseStatus(r.level),
        r.resolved ? `Resolved${r.resolved_by ? ` by ${teamLabel(r.resolved_by)}` : ""}` : "Open",
        r.note.length > 160 ? r.note.slice(0, 157) + "…" : r.note || "—",
        r.created_by ? teamLabel(r.created_by) : "—",
      ]),
    },
  ];
}

/* --------------------------------------------------------------- assembly */

export function buildReport(
  type: ReportType,
  start: string,
  end: string
): Report {
  const meta = reportMeta(type);
  let sections: ReportSection[];
  switch (type) {
    case "account_health":
      sections = accountHealth();
      break;
    case "delivery_vs_contract":
      sections = deliveryVsContract(start, end);
      break;
    case "contract_runway":
      sections = contractRunway();
      break;
    case "time_tracking":
      sections = timeTracking(start, end);
      break;
    case "capacity":
      sections = capacity(start, end);
      break;
    case "approvals_ageing":
      sections = approvalsAgeing(start, end);
      break;
    case "client_messages":
      sections = clientMessages();
      break;
    case "okrs":
      sections = okrs();
      break;
    case "weekly_snapshots":
      sections = weeklySnapshots(start, end);
      break;
    case "deliverables":
      sections = deliverables();
      break;
    case "team_sentiment":
      sections = teamSentiment(start, end);
      break;
    case "client_sentiment":
      sections = clientSentiment(start, end);
      break;
  }
  return {
    type,
    title: meta.label,
    subtitle: meta.blurb,
    range: meta.ranged ? { start, end } : null,
    generatedAt: new Date().toISOString(),
    sections,
  };
}

// CSV of every table in the report, sections separated by a blank line. Kept
// here rather than in the route so the escaping lives next to the data shape.
export function reportToCsv(report: Report): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines: string[] = [];
  lines.push(esc(report.title));
  if (report.range) lines.push(esc(`${report.range.start} to ${report.range.end}`));
  lines.push("");
  for (const s of report.sections) {
    lines.push(esc(s.title));
    if (s.stats) {
      lines.push(["Measure", "Value", "Detail"].join(","));
      for (const st of s.stats) {
        lines.push([esc(st.label), esc(st.value), esc(st.hint || "")].join(","));
      }
    } else if (s.columns) {
      // A CSV can't carry a hyperlink on a cell, so the destination becomes its
      // own column rather than being dropped on export.
      const linked = Boolean(s.rowLinks?.some(Boolean));
      lines.push([...s.columns, ...(linked ? ["Link"] : [])].map(esc).join(","));
      (s.rows || []).forEach((row, i) => {
        const cells = linked ? [...row, s.rowLinks?.[i] || ""] : row;
        lines.push(cells.map(esc).join(","));
      });
    }
    lines.push("");
  }
  return lines.join("\n");
}
