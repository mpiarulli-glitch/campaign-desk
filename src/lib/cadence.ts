import { nanoid } from "nanoid";
import {
  getDb,
  type ColorWeek,
  type ProductionCadence,
  type RevClient,
  type ScheduledSend,
} from "./db";

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

// Bookable start times, on the hour, 9 AM through 5 PM (stored as 24h HH:MM).
export const BOOKING_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

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
        `SELECT * FROM scheduled_sends WHERE client_id = ? AND cadence_window_start = ? ORDER BY created_at DESC LIMIT 1`
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
      .prepare(`SELECT * FROM rev_clients WHERE schedule_token = ?`)
      .get(token) as RevClient | undefined) || null
  );
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
