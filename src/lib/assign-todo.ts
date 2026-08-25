import {
  OPS_TODOLIST_NAME,
  asPerson,
  basecampConnected,
  createAssignedTodo,
  getProjectPeopleForMention,
  hasConnection,
  SERVICE,
  type BcIdentity,
  type BcPerson,
} from "./basecamp";
import { listInternalProjects } from "./basecamp-clients";
import { todayYmd } from "./cadence";
import { getDb } from "./db";
import { DAILY_CAPACITY_HOURS, WEEKLY_CAPACITY_HOURS } from "./forecast";
import { blockHours } from "./forecast-timer";
import {
  pickDefaultInternalReviewer,
  teamPeopleForInternalReview,
} from "./internal-review";
import { PEOPLE, basecampNameForManager, isValidPerson, personLabel } from "./people";
import { listRevClients } from "./revenue";
import { addWeeks, mondayOf } from "./week";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAssignDueOn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return DATE_RE.test(value) ? value : null;
}

export function parseNeededHours(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.round(n * 10) / 10;
}

export function formatHours(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}h`;
}

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function workdaysOnOrBefore(start: string, end: string): string[] {
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) return [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cursor = new Date(ys, ms - 1, ds);
  const last = new Date(ye, me - 1, de);
  const out: string[] = [];
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      out.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
      );
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function tenths(n: number): number {
  return Math.round(n * 10) / 10;
}

function mondayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return mondayOf(new Date(y, m - 1, d));
}

type OccupancyRow = {
  task_date: string;
  client: string;
  hours: number;
  tracked_seconds: number;
  timer_started_at: string;
};

function occupancyHours(row: OccupancyRow, nowMs: number): number {
  return blockHours(
    {
      hours: Number(row.hours) || 0,
      tracked_seconds: Number(row.tracked_seconds) || 0,
      timer_started_at: row.timer_started_at || "",
    },
    nowMs
  );
}

export type AssignLoad = {
  person: string;
  dueOn: string;
  asOf: string;
  count: number;
  plannedHours: number;
  clients: string[];
  dates: string[];
  workdays: number;
  capacity: number;
  freeHours: number;
  neededHours: number;
  weekHours: number;
  weekCapacity: number;
  weekRemaining: number;
  hasRoom: boolean;
};

export function assignLoadForPerson(input: {
  person: string;
  dueOn: string;
  neededHours?: number;
  asOf?: string;
}): AssignLoad {
  const dueOn = parseAssignDueOn(input.dueOn) || "";
  const asOf = parseAssignDueOn(input.asOf) || todayYmd();
  const neededHours = parseNeededHours(input.neededHours);
  const empty: AssignLoad = {
    person: input.person,
    dueOn,
    asOf,
    count: 0,
    plannedHours: 0,
    clients: [],
    dates: [],
    workdays: 0,
    capacity: 0,
    freeHours: 0,
    neededHours,
    weekHours: 0,
    weekCapacity: WEEKLY_CAPACITY_HOURS,
    weekRemaining: 0,
    hasRoom: neededHours <= 0,
  };
  if (!dueOn || !isValidPerson(input.person)) return empty;

  const workdays = workdaysOnOrBefore(asOf, dueOn);
  const capacity = tenths(workdays.length * DAILY_CAPACITY_HOURS);
  if (workdays.length === 0) {
    return { ...empty, workdays: 0, capacity: 0, hasRoom: neededHours <= 0 };
  }

  const weekStarts = [...new Set(workdays.map(mondayFromYmd))].sort();
  const rangeStart = weekStarts[0];
  const rangeEnd = addWeeks(weekStarts[weekStarts.length - 1], 1);
  const nowMs = Date.now();
  const workdaySet = new Set(workdays);

  const rows = getDb()
    .prepare(
      `SELECT task_date, client, hours, tracked_seconds, timer_started_at
         FROM forecast_tasks
        WHERE person = ? AND task_date >= ? AND task_date < ?
        ORDER BY task_date ASC`
    )
    .all(input.person, rangeStart, rangeEnd) as OccupancyRow[];

  const occupiedByDay = new Map<string, number>();
  const weekOccupied = new Map<string, number>();
  const windowRows: OccupancyRow[] = [];
  for (const day of workdays) occupiedByDay.set(day, 0);
  for (const week of weekStarts) weekOccupied.set(week, 0);

  for (const row of rows) {
    const occ = occupancyHours(row, nowMs);
    const week = mondayFromYmd(row.task_date);
    if (weekOccupied.has(week)) {
      weekOccupied.set(week, (weekOccupied.get(week) || 0) + occ);
    }
    if (!workdaySet.has(row.task_date)) continue;
    windowRows.push(row);
    occupiedByDay.set(row.task_date, (occupiedByDay.get(row.task_date) || 0) + occ);
  }

  let plannedHours = 0;
  let freeHours = 0;
  for (const day of workdays) {
    const occupied = tenths(occupiedByDay.get(day) || 0);
    plannedHours += occupied;
    // A day at/over the daily cap has no leftover, even if another day in
    // the window is under. Crumbs on a packed day are not "room."
    freeHours += occupied >= DAILY_CAPACITY_HOURS ? 0 : DAILY_CAPACITY_HOURS - occupied;
  }
  plannedHours = tenths(plannedHours);
  freeHours = tenths(freeHours);

  let weekHours = 0;
  let weekRemaining = 0;
  for (const week of weekStarts) {
    const occupied = tenths(weekOccupied.get(week) || 0);
    weekHours += occupied;
    weekRemaining += Math.max(0, WEEKLY_CAPACITY_HOURS - occupied);
  }
  weekHours = tenths(weekHours);
  weekRemaining = tenths(weekRemaining);

  const dates = [...new Set(windowRows.map((row) => row.task_date))];
  const clients = [
    ...new Set(windowRows.map((row) => row.client.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    person: input.person,
    dueOn,
    asOf,
    count: windowRows.length,
    plannedHours,
    clients,
    dates,
    workdays: workdays.length,
    capacity,
    freeHours,
    neededHours,
    weekHours,
    weekCapacity: tenths(weekStarts.length * WEEKLY_CAPACITY_HOURS),
    weekRemaining,
    hasRoom: neededHours <= freeHours && neededHours <= weekRemaining,
  };
}

export type AssignWarning = {
  hasRoom: boolean;
  headline: string;
  detail: string;
};

export function assignWarningCopy(load: AssignLoad): AssignWarning {
  const due = formatShortDate(load.dueOn);
  const needed = formatHours(load.neededHours);
  const planned = formatHours(load.plannedHours);
  const free = formatHours(load.freeHours);

  let headline: string;
  if (load.hasRoom && load.count === 0) {
    headline = `There's nothing on their forecast on or before ${due}. They have about ${free} free. Proceed?`;
  } else if (load.hasRoom) {
    headline = `They have about ${free} free before ${due} (${planned} already planned). Proceed?`;
  } else if (load.neededHours <= load.freeHours) {
    headline = `Their week is at capacity — ${formatHours(load.weekHours)} planned this week against ${formatHours(load.weekCapacity)}. You'll need to notify the team to reprioritize if you assign this. Still proceed?`;
  } else {
    headline = `They don't have enough open time before ${due} — ${planned} planned, this needs ${needed}. You'll need to notify the team to reprioritize if you assign this. Still proceed?`;
  }

  const detailParts: string[] = [];
  if (load.dates.length) {
    const when = joinList(load.dates.map(formatShortDate));
    detailParts.push(
      load.count === 1
        ? `They plan to work on it on ${when}.`
        : `They plan to work on them on ${when}.`
    );
  }
  if (load.clients.length) {
    detailParts.push(
      `${joinList(load.clients)} ${load.clients.length === 1 ? "occupies" : "occupy"} that calendar.`
    );
  }

  return { hasRoom: load.hasRoom, headline, detail: detailParts.join(" ") };
}

export type AssignPersonOption = { slug: string; label: string };
export type AssignProjectOption = {
  id: string;
  name: string;
  basecampProjectId: string;
  internal: boolean;
};

export function listAssignPeople(): AssignPersonOption[] {
  return PEOPLE.map((p) => ({ slug: p.slug, label: p.label }));
}

export async function listAssignProjects(
  identity: BcIdentity = SERVICE
): Promise<AssignProjectOption[]> {
  const clients: AssignProjectOption[] = listRevClients(false)
    .filter((c) => (c.basecamp_project_id || "").trim())
    .map((c) => ({
      id: `client:${c.id}`,
      name: c.name,
      basecampProjectId: c.basecamp_project_id.trim(),
      internal: false,
    }));

  let internals: AssignProjectOption[] = [];
  if (basecampConnected()) {
    try {
      const projects = await listInternalProjects(identity);
      internals = projects.map((p) => ({
        id: `internal:${p.id}`,
        name: p.name,
        basecampProjectId: p.id,
        internal: true,
      }));
    } catch {
      internals = [];
    }
  }

  return [...clients, ...internals].sort((a, b) => a.name.localeCompare(b.name));
}

export function pickAssigneeOnRoster(
  people: Array<Pick<BcPerson, "id" | "name" | "email_address" | "client" | "employee" | "attachable_sgid">>,
  slug: string
): { id: number; name: string } | null {
  const team = teamPeopleForInternalReview(people);
  if (!team.length) return null;
  const label = personLabel(slug);
  const first = label.split(/\s+/)[0] || slug;
  const mapped = basecampNameForManager(slug) || basecampNameForManager(first);
  return (
    pickDefaultInternalReviewer(team, slug) ||
    pickDefaultInternalReviewer(team, mapped) ||
    pickDefaultInternalReviewer(team, label)
  );
}

export async function createOpsAssignedTodo(input: {
  title: string;
  dueOn: string;
  assignee: string;
  basecampProjectId: string;
  identity?: BcIdentity;
}): Promise<
  | { ok: true; todoId: string; todoUrl: string; listName: string; assigneeName: string }
  | { ok: false; error: string; status: number }
> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "A to-do needs a title.", status: 400 };
  const dueOn = parseAssignDueOn(input.dueOn);
  if (!dueOn) return { ok: false, error: "Pick a due date.", status: 400 };
  if (!isValidPerson(input.assignee)) {
    return { ok: false, error: "Pick someone on the forecast roster.", status: 400 };
  }
  const projectId = (input.basecampProjectId || "").trim();
  if (!projectId) {
    return { ok: false, error: "Pick a project with a Basecamp workspace.", status: 400 };
  }
  if (!basecampConnected()) {
    return {
      ok: false,
      error: "Basecamp isn't connected. Connect it before assigning a to-do.",
      status: 400,
    };
  }

  const identity = input.identity ?? SERVICE;
  let roster: BcPerson[] = [];
  try {
    roster = await getProjectPeopleForMention(projectId, identity);
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || "Could not load the Basecamp project roster.",
      status: 502,
    };
  }

  const assignee = pickAssigneeOnRoster(roster, input.assignee);
  if (!assignee) {
    return {
      ok: false,
      error: `${personLabel(input.assignee)} isn't on that Basecamp project, or their Basecamp name doesn't match.`,
      status: 400,
    };
  }

  const created = await createAssignedTodo({
    projectId,
    title,
    assigneeIds: [assignee.id],
    dueOn,
    identity,
    listName: OPS_TODOLIST_NAME,
  });
  if (!created.ok) {
    return { ok: false, error: created.error, status: 502 };
  }
  return {
    ok: true,
    todoId: created.todoId,
    todoUrl: created.todoUrl,
    listName: OPS_TODOLIST_NAME,
    assigneeName: assignee.name,
  };
}

export function identityForAssigner(slug: string | null): BcIdentity {
  return slug && hasConnection(slug) ? asPerson(slug) : SERVICE;
}
