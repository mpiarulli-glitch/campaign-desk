// Report builders.
//
// Every report resolves to the same shape (a header, some summary figures, and
// a list of sections that are each either stat tiles or a table). That is what
// lets one screen renderer and one print stylesheet serve all six, and makes a
// seventh report a single builder rather than a new page.
//
// Reports are read-only aggregations over existing tables. Nothing here writes.

import { getDb } from "./db";
import { PEOPLE, personLabel, teamLabelFor } from "./people";
import { teamLabel } from "./team";

export type ReportType =
  | "time_tracking"
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
    type: "time_tracking",
    label: "Time tracking",
    blurb: "Forecast hours against hours actually logged, by person and client.",
    ranged: true,
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
    case "time_tracking":
      sections = timeTracking(start, end);
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
      lines.push(s.columns.map(esc).join(","));
      for (const row of s.rows || []) lines.push(row.map(esc).join(","));
    }
    lines.push("");
  }
  return lines.join("\n");
}
