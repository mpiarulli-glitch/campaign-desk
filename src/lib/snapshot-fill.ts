import {
  isSnapshotAccountManager,
  isTeam,
  OWNER_SLUG,
  personTeam,
  type Team,
} from "./people";

// How the team-side weekly snapshot decides what to put in front of someone.
//
// The stored `team` column is the source of truth when it is set. A lot of
// existing rows are still blank, so category + name are read as a fallback:
// "Blog posts" is SEO work even if nobody tagged it, and "LinkedIn outreach"
// is email work even though a bare "LinkedIn" would look like social.
//
// Specialists only see their own work. Strategy / account rows, and anything
// we cannot place, go to account managers — they are the people who would
// otherwise fill a hole nobody else can see. That is the only remaining
// fail-open: an untagged mystery is visible on the unscoped (AM / See all)
// list, not on every specialist's list.

export type FillStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "shared"
  | "approved";

export type FillOwnership = Team | "strategy" | "unknown";

export type FillLane = "overdue" | "todo" | "done";

export type FillFilter = "todo" | "overdue" | "done" | "all";

export type FillViewer = {
  role: "admin" | "forecast" | null;
  person: string | null;
  owner: boolean;
};

export type FillNamed = {
  team?: string;
  category: string;
  name: string;
};

const FILL_OPEN: FillStatus[] = ["not_started", "in_progress"];

export function rowIsOpen(status: FillStatus): boolean {
  return FILL_OPEN.includes(status);
}

export function fillLane(
  row: { status: FillStatus; deliverable_id: string },
  overdueIds: ReadonlySet<string>
): FillLane {
  if (overdueIds.has(row.deliverable_id)) return "overdue";
  if (rowIsOpen(row.status)) return "todo";
  return "done";
}

export function fillCounts(
  rows: Array<{ status: FillStatus; deliverable_id: string }>,
  overdueIds: ReadonlySet<string>
): {
  total: number;
  overdue: number;
  todo: number;
  done: number;
  attention: number;
} {
  let overdue = 0;
  let todo = 0;
  let done = 0;
  for (const row of rows) {
    const lane = fillLane(row, overdueIds);
    if (lane === "overdue") overdue += 1;
    else if (lane === "todo") todo += 1;
    else done += 1;
  }
  return {
    total: rows.length,
    overdue,
    todo,
    done,
    attention: overdue + todo,
  };
}

export function fillPassSummary(
  counts: ReturnType<typeof fillCounts>,
  isThisWeek: boolean
): string {
  if (counts.total === 0) return "No deliverables on this account yet.";
  if (counts.attention === 0) {
    return isThisWeek
      ? `Clear — all ${counts.total} deliverables are logged for this period.`
      : `All ${counts.total} deliverables are logged for this week.`;
  }
  const bits: string[] = [];
  if (counts.overdue) {
    bits.push(`${counts.overdue} overdue`);
  }
  if (counts.todo) {
    bits.push(
      `${counts.todo} still need${counts.todo === 1 ? "s" : ""} an update`
    );
  }
  return bits.join(" · ");
}

export function filterFillRows<T extends { status: FillStatus; deliverable_id: string }>(
  rows: T[],
  filter: FillFilter,
  overdueIds: ReadonlySet<string>
): T[] {
  if (filter === "all") return rows;
  if (filter === "todo") {
    return rows.filter((row) => fillLane(row, overdueIds) !== "done");
  }
  return rows.filter((row) => fillLane(row, overdueIds) === filter);
}

export function groupByCategory<T extends { category: string }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.category.trim() || "Other";
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return Array.from(map.entries());
}

export function groupFillLanes<T extends { status: FillStatus; deliverable_id: string }>(
  rows: T[],
  overdueIds: ReadonlySet<string>
): Array<{ lane: FillLane; rows: T[] }> {
  const buckets: Record<FillLane, T[]> = { overdue: [], todo: [], done: [] };
  for (const row of rows) buckets[fillLane(row, overdueIds)].push(row);
  return (["overdue", "todo", "done"] as FillLane[])
    .map((lane) => ({ lane, rows: buckets[lane] }))
    .filter((group) => group.rows.length > 0);
}

function haystack(row: FillNamed): string {
  return `${row.category} ${row.name}`.trim().toLowerCase();
}

/**
 * Who owns this row for the fill list.
 *
 * A stored team always wins. Untagged rows are classified from the words in
 * the category and name, matching how contract import already files work.
 * LinkedIn outreach is email (CRM / sequences); LinkedIn posts stay social.
 */
export function inferDeliverableOwnership(row: FillNamed): FillOwnership {
  if (isTeam(row.team) && row.team) return row.team;

  const text = haystack(row);

  // Outreach / CRM use of LinkedIn, before the generic social "linkedin" match.
  if (
    /\blinkedin\b/.test(text) &&
    /\b(outreach|connect(?:ion)?s?|inmail|crm|nurture|drip|sequence|lead gen|prospect)\b/.test(
      text
    )
  ) {
    return "email";
  }

  if (
    /\b(sms|text messages?|email|newsletter|broadcast|klaviyo|mailchimp|e-?blast|automation|workflow|crm|ghl|go ?high ?level|lifecycle|drip|nurture|cold emails?|cold outreach)\b/.test(
      text
    )
  ) {
    return "email";
  }

  if (
    /\b(seo|blog|article|keyword|backlink|on-?page|search engine|gbp|google business)\b/.test(
      text
    )
  ) {
    return "seo";
  }

  if (/\b(onboard(?:ing)?|kick-?off)\b/.test(text)) {
    return "onboarding";
  }

  if (
    /\b(video|reel|tiktok|instagram|facebook|social|carousel|production|videograph|photo shoot|content capture)\b/.test(
      text
    ) ||
    /\blinkedin\b/.test(text)
  ) {
    return "social";
  }

  if (
    /\b(website|web ?site|landing page|wordpress|shopify|web design|web dev|hosting)\b/.test(
      text
    )
  ) {
    return "web";
  }

  if (
    /\b(strateg|account|qbr|quarterly review|planning|consult|am call|client call|reporting|performance review)\b/.test(
      text
    )
  ) {
    return "strategy";
  }

  return "unknown";
}

/**
 * Whether a specialist should see this row on their fill list.
 *
 * `viewerTeam` null means unscoped: account managers, See all, and the owner
 * looking at the whole account. Specialists only get rows whose stored or
 * inferred owner is their team — not strategy, not another team's untagged
 * work, not a mystery row. Those stay on the AM list so they are still filled.
 */
export function deliverableVisibleTo(row: FillNamed, viewerTeam: Team | null): boolean {
  if (!viewerTeam) return true;
  return inferDeliverableOwnership(row) === viewerTeam;
}

/**
 * Account-manager ordering: strategy / account work they fill themselves
 * first, then untagged mysteries, then everyone else's specialist rows.
 * Stable for equal keys so an existing sort_order is preserved.
 */
export function amSortKey(row: FillNamed): number {
  const ownership = inferDeliverableOwnership(row);
  if (ownership === "strategy") return 0;
  if (ownership === "unknown") return 1;
  return 2;
}

export function sortFillRows<T extends FillNamed>(
  rows: T[],
  accountManager: boolean
): T[] {
  if (!accountManager) return rows;
  return [...rows].sort((a, b) => amSortKey(a) - amSortKey(b));
}

export function visibleFillRows<T extends FillNamed>(
  rows: T[],
  viewerTeam: Team | null,
  opts?: { accountManager?: boolean }
): T[] {
  const visible = viewerTeam
    ? rows.filter((row) => deliverableVisibleTo(row, viewerTeam))
    : rows;
  return sortFillRows(visible, Boolean(opts?.accountManager));
}

/**
 * Whose slice of the fill list this session starts on.
 *
 * The owner login carries a null person (every owner check depends on that),
 * but Michael is the email team — so the owner session focuses on email, with
 * See all as the escape hatch that does not strip admin access. Account
 * managers (Cassidy, Kyle Morris) have no specialist team and start unscoped.
 */
export function fillFocusTeam(viewer: FillViewer): Team | null {
  if (viewer.owner || (viewer.role === "admin" && !viewer.person)) {
    return personTeam(OWNER_SLUG);
  }
  return personTeam(viewer.person);
}

export function fillIsAccountManager(viewer: FillViewer): boolean {
  if (viewer.owner || (viewer.role === "admin" && !viewer.person)) return false;
  return isSnapshotAccountManager(viewer.person);
}

export function fillCanSeeAll(viewer: FillViewer): boolean {
  return viewer.role === "admin" && fillFocusTeam(viewer) !== null;
}

export function fillPeriodHint(row: {
  kind: "recurring" | "one_time";
  cadence_unit: "weekly" | "monthly" | "quarterly";
  cadence: string;
  period_start: string;
  due_date?: string | null;
}): string {
  const bits: string[] = [];
  if (row.kind === "one_time") {
    bits.push("One-time");
    if (row.due_date) bits.push(`due ${shortDate(row.due_date)}`);
  } else if (row.cadence_unit === "monthly" && row.period_start) {
    bits.push(monthLabel(row.period_start));
  } else if (row.cadence_unit === "quarterly" && row.period_start) {
    bits.push(quarterLabel(row.period_start));
  } else {
    bits.push("Weekly");
  }
  if (row.cadence.trim()) bits.push(row.cadence.trim());
  return bits.join(" · ");
}

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (!y || !m) return ymd;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function quarterLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (!y || !m) return ymd;
  return `Q${Math.ceil(m / 3)} ${y}`;
}
