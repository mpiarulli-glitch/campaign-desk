import { nanoid } from "nanoid";
import {
  getDb,
  type ColorWeek,
  type ProductionCadence,
  type RevClient,
  type ScheduledSend,
} from "./db";
export { BOOKING_SLOTS } from "./scheduling-rules";

export const COLORS: Exclude<ColorWeek, "">[] = ["purple", "red", "blue", "green"];

export const COLOR_LABEL: Record<Exclude<ColorWeek, "">, string> = {
  purple: "Purple",
  red: "Red",
  blue: "Blue",
  green: "Green",
};

export const CADENCE_LABEL: Record<Exclude<ProductionCadence, "">, string> = {
  monthly: "Monthly",
  bi_monthly: "Bi-Monthly",
  quarterly: "Quarterly",
};

export const APP_TIME_ZONE =
  process.env.APP_TIME_ZONE || "America/Los_Angeles";

export function slotLabel(hhmm: string): string {
  const [h] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

// Cadence period, in months.
const CADENCE_MONTHS: Record<Exclude<ProductionCadence, "">, number> = {
  monthly: 1,
  bi_monthly: 2,
  quarterly: 3,
};

// Which full week of the month each color PUBLISHES in (0-based):
// Purple = 1st full week, Red = 2nd, Blue = 3rd, Green = 4th. Production
// happens the week before the publish week.
const COLOR_WEEK_INDEX: Record<Exclude<ColorWeek, "">, number> = {
  purple: 0,
  red: 1,
  blue: 2,
  green: 3,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

export interface Window {
  start: string; // Monday, YYYY-MM-DD
  end: string; // Friday, YYYY-MM-DD
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

// The first Monday on or after the 1st of the month = the start of the "first
// full week." getUTCDay: 0 = Sun ... 6 = Sat.
function firstMondayOfMonth(year: number, monthIdx0: number): Date {
  const first = new Date(Date.UTC(year, monthIdx0, 1));
  const dow = first.getUTCDay();
  const add = (8 - dow) % 7; // Sun->1, Mon->0, Tue->6, Wed->5, ...
  return new Date(Date.UTC(year, monthIdx0, 1 + add));
}

// The production window (Mon-Fri) for a color in a given month: the week BEFORE
// that color's publish week. Publish week = the Nth full week of the month
// (Purple 1st ... Green 4th); the shoot happens the week before.
function productionWindowForMonth(
  year: number,
  monthIdx0: number,
  colorIdx: number
): Window {
  const publishMonday = addDays(firstMondayOfMonth(year, monthIdx0), colorIdx * 7);
  const prodMonday = addDays(publishMonday, -7);
  return {
    start: formatDate(prodMonday),
    end: formatDate(addDays(prodMonday, 4)),
  };
}

// The client's next production window: the next upcoming production week that
// falls on the cadence beat measured from their last production. Steps forward
// by the cadence interval until the window hasn't fully passed. Returns null if
// color/cadence aren't configured.
export function nextWindow(client: RevClient, today: string): Window | null {
  if (!client.color_week || !client.production_cadence) return null;
  const period = CADENCE_MONTHS[client.production_cadence];
  const colorIdx = COLOR_WEEK_INDEX[client.color_week];
  const anchored = Boolean(client.last_production_date);
  const base = client.last_production_date || today;
  const [by, bm] = base.split("-").map(Number); // bm is 1-12
  const baseMonthOffset = by * 12 + (bm - 1);
  // With a last production, the next window is at least one cadence step out.
  // Without one, the current month's window counts if it hasn't passed.
  const startK = anchored ? 1 : 0;
  for (let k = startK; k <= 240; k++) {
    const m = baseMonthOffset + k * period;
    const w = productionWindowForMonth(Math.floor(m / 12), m % 12, colorIdx);
    if (w.end >= today) return w; // YYYY-MM-DD compares lexically
  }
  return null;
}

// The production window a given date falls inside, for a given color week, or
// null if the date isn't in one. Used when logging a production that was booked
// outside the app, so it lands on the same cadence beat a client booking would.
//
// A window can start in the month before the one it belongs to (purple
// publishes in the first full week, so it shoots the week prior), which is why
// this checks the neighbouring months rather than just the date's own month.
export function productionWindowForDate(
  colorWeek: ColorWeek,
  date: string
): Window | null {
  if (!colorWeek) return null;
  const colorIdx = COLOR_WEEK_INDEX[colorWeek];
  const [y, m] = date.split("-").map(Number);
  const monthOffset = y * 12 + (m - 1);
  for (const delta of [-1, 0, 1]) {
    const target = monthOffset + delta;
    const w = productionWindowForMonth(
      Math.floor(target / 12),
      target % 12,
      colorIdx
    );
    if (date >= w.start && date <= w.end) return w;
  }
  return null;
}

export function isBlackout(date: string, client: RevClient): boolean {
  if (client.contract_start && date < client.contract_start) return true;
  if (client.contract_end && date > client.contract_end) return true;
  try {
    const blackouts: string[] = JSON.parse(client.blackout_dates || "[]");
    return blackouts.includes(date);
  } catch {
    return false;
  }
}

// The existing send (if any) that fulfills a given cadence window.
export function findSendForWindow(
  clientId: string,
  windowStart: string
): ScheduledSend | null {
  return (
    (getDb()
      .prepare(
        // Cancelled rows are excluded on purpose: cancelling a production has
        // to hand the window back, otherwise the client stays "booked" forever
        // and never shows as needing one again.
        `SELECT * FROM scheduled_sends
         WHERE client_id = ? AND cadence_window_start = ? AND cancelled_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(clientId, windowStart) as ScheduledSend | undefined) || null
  );
}

export function computeCycleStatus(
  client: RevClient,
  window: Window | null,
  today: string
): CycleStatus {
  if (!client.active) return "inactive";
  if (!window) return "not_configured";
  const existing = findSendForWindow(client.id, window.start);
  if (existing) {
    if (existing.status === "sent") return "sent";
    if (existing.status === "scheduled" || existing.status === "planned")
      return "scheduled";
    return "requested";
  }
  return today >= window.start ? "due" : "not_due";
}

export const CYCLE_STATUSES: CycleStatus[] = [
  "not_configured",
  "inactive",
  "not_due",
  "due",
  "requested",
  "scheduled",
  "sent",
];

export function isCycleStatus(value: string): value is CycleStatus {
  return (CYCLE_STATUSES as string[]).includes(value);
}

// Statuses that mean this client is handled for the window in front of them.
//
// These are the ones that describe an outcome rather than a waiting state: they
// asked, it is on the calendar, or it happened. Chasing someone who has already
// requested a production is the exact nag worth preventing, so a hand-set status
// from this list stops the sweep the same way a real booking does.
//
// "due" and "not_due" are deliberately absent. Both mean the client still has to
// book, so pinning either has to leave the outreach running.
export const HANDLED_STATUSES: CycleStatus[] = [
  "requested",
  "scheduled",
  "sent",
  "inactive",
];

export function statusMeansHandled(value: string): boolean {
  return isCycleStatus(value) && HANDLED_STATUSES.includes(value);
}

// The status to show for a client: their hand-set one if they have it,
// otherwise the real one off the cadence engine.
export function effectiveCycleStatus(
  client: RevClient,
  window: Window | null,
  today: string
): { status: CycleStatus; real: CycleStatus; overridden: boolean } {
  const real = computeCycleStatus(client, window, today);
  const pinned = (client.status_override || "").trim();
  if (pinned && isCycleStatus(pinned)) {
    return { status: pinned, real, overridden: true };
  }
  return { status: real, real, overridden: false };
}

// Advance a client's last_production_date once a cadence-linked send is
// marked sent, so the next window is computed from what actually happened.
export function advanceLastProduction(clientId: string, sendDate: string): void {
  const db = getDb();
  const client = db
    .prepare(`SELECT last_production_date FROM rev_clients WHERE id = ?`)
    .get(clientId) as { last_production_date: string | null } | undefined;
  if (!client) return;
  if (client.last_production_date && client.last_production_date >= sendDate) return;
  db.prepare(
    `UPDATE rev_clients SET last_production_date = ?, updated_at = ? WHERE id = ?`
  ).run(sendDate, new Date().toISOString(), clientId);
}

export function getOrCreateScheduleToken(clientId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT schedule_token FROM rev_clients WHERE id = ?`)
    .get(clientId) as { schedule_token: string | null } | undefined;
  if (!row) return null;
  if (row.schedule_token) return row.schedule_token;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET schedule_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function rotateScheduleToken(clientId: string): string | null {
  const db = getDb();
  const exists = db.prepare(`SELECT id FROM rev_clients WHERE id = ?`).get(clientId);
  if (!exists) return null;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET schedule_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function getClientByScheduleToken(token: string): RevClient | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM rev_clients
         WHERE schedule_token = ? AND production_enrolled = 1`
      )
      .get(token) as RevClient | undefined) || null
  );
}

export function todayYmd(): string {
  return appDateTime().date;
}

// Calendar date and 24-hour time in the business timezone. Using format parts
// avoids UTC rolling the scheduler into tomorrow during the Pacific evening.
export function appDateTime(now = new Date()): {
  date: string;
  time: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}
