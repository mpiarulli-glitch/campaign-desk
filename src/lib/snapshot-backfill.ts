import type { CadenceUnit, DeliverableKind, SnapshotStatus } from "./db";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "./week";
import { periodEndExclusiveFor, periodStartFor, weekOfYmd } from "./snapshot-entry-date";

/** Default lookback: ~6 months of weekly snapshots. */
export const BACKFILL_WEEK_COUNT = 26;

/** Monday keys from oldest → newest, ending at the Monday of `endWeek`. */
export function backfillWeekRange(
  endWeek: string = currentWeek(),
  count: number = BACKFILL_WEEK_COUNT
): string[] {
  if (count < 1) return [];
  const end = weekOfYmd(endWeek);
  const start = addWeeks(end, -(count - 1));
  const weeks: string[] = [];
  for (let i = 0; i < count; i++) weeks.push(addWeeks(start, i));
  return weeks;
}

export interface BackfillColumn {
  week_start: string;
  label: string;
  short_label: string;
  is_current: boolean;
  /** YYYY-MM for optional month band headers. */
  month_key: string;
}

function shortWeekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  if (!y || !m || !d) return weekStart;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function backfillColumns(weeks: readonly string[]): BackfillColumn[] {
  return weeks.map((week_start) => ({
    week_start,
    label: weekLabel(week_start),
    short_label: shortWeekLabel(week_start),
    is_current: isCurrentWeek(week_start),
    month_key: week_start.slice(0, 7),
  }));
}

/** Whether this week column is the editable anchor for a deliverable's cadence. */
export function isPeriodAnchorWeek(
  kind: DeliverableKind,
  unit: CadenceUnit,
  weekStart: string,
  prevWeekStart: string | null,
  isLastWeek: boolean
): boolean {
  if (kind === "one_time") return isLastWeek;
  if (unit === "weekly") return true;
  if (!prevWeekStart) return true;
  return periodStartFor(unit, prevWeekStart) !== periodStartFor(unit, weekStart);
}

export interface BackfillCellFields {
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
}

export type BackfillEntryMap = Map<
  string,
  Array<BackfillCellFields & { week_start: string }>
>;

const EMPTY_CELL: BackfillCellFields = {
  status: "not_started",
  work_done: "",
  next_steps: "",
  notes: "",
  logged_by: "",
  updated_at: "",
};

/** Resolve the entry visible in one grid cell (pure — no DB). */
export interface BackfillCell extends BackfillCellFields {
  week_start: string;
  period_start: string;
  /** Monthly/quarterly non-anchor weeks mirror the period but cannot be edited. */
  editable: boolean;
}

export interface BackfillRow {
  deliverable_id: string;
  category: string;
  team: string;
  name: string;
  cadence: string;
  kind: DeliverableKind;
  cadence_unit: CadenceUnit;
  cells: BackfillCell[];
}

export function resolveBackfillCell(
  kind: DeliverableKind,
  unit: CadenceUnit,
  weekStart: string,
  entries: BackfillEntryMap,
  deliverableId: string,
  latestOneTime?: BackfillCellFields
): BackfillCellFields {
  const own = entries.get(deliverableId) || [];

  if (kind === "one_time") {
    return latestOneTime || EMPTY_CELL;
  }

  if (unit === "weekly") {
    const hit = own.find((e) => e.week_start === weekStart);
    return hit || EMPTY_CELL;
  }

  const start = periodStartFor(unit, weekStart);
  const end = periodEndExclusiveFor(unit, weekStart);
  const inPeriod = own.filter((e) => e.week_start >= start && e.week_start < end);
  if (!inPeriod.length) return EMPTY_CELL;
  return inPeriod[inPeriod.length - 1];
}
