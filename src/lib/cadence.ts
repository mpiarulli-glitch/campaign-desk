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

// How many calendar months out the target date sits from the last production
// date for each cadence tier.
const CADENCE_MONTHS: Record<Exclude<ProductionCadence, "">, number> = {
  monthly: 1,
  bi_monthly: 2,
  quarterly: 3,
};

// Reference Monday the color rotation is anchored to. Arbitrary but fixed —
// every color-week calculation is relative to this date, so changing it would
// shift every client's assigned week.
const ANCHOR_MONDAY = "2026-01-05";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

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

function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d: Date): Date {
  // getUTCDay: 0 = Sun ... 6 = Sat. Distance back to Monday.
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return new Date(d.getTime() - back * MS_PER_DAY);
}

function addMonths(ymd: string, months: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d));
}

// Deterministic color for the week containing `date`, from the fixed
// 4-week rotation anchored at ANCHOR_MONDAY.
export function colorForWeek(date: Date): Exclude<ColorWeek, ""> {
  const monday = mondayOf(date);
  const anchor = parseDate(ANCHOR_MONDAY);
  const weeksSinceAnchor = Math.round(
    (monday.getTime() - anchor.getTime()) / MS_PER_WEEK
  );
  const idx = ((weeksSinceAnchor % 4) + 4) % 4;
  return COLORS[idx];
}

// The next occurrence (Mon-Fri) of `color`'s week on/after `fromDate`.
function nextColorWeek(color: Exclude<ColorWeek, "">, fromDate: Date): Window {
  let monday = mondayOf(fromDate);
  for (let i = 0; i < 8; i++) {
    if (colorForWeek(monday) === color) {
      const friday = new Date(monday.getTime() + 4 * MS_PER_DAY);
      return { start: formatDate(monday), end: formatDate(friday) };
    }
    monday = new Date(monday.getTime() + MS_PER_WEEK);
  }
  // Unreachable: a 4-color rotation always resolves within 4 weeks.
  const friday = new Date(monday.getTime() + 4 * MS_PER_DAY);
  return { start: formatDate(monday), end: formatDate(friday) };
}

// The client's next production window, or null if color/cadence aren't
// configured yet.
export function nextWindow(client: RevClient, today: string): Window | null {
  if (!client.color_week || !client.production_cadence) return null;
  const months = CADENCE_MONTHS[client.production_cadence];
  const base = client.last_production_date || today;
  const target = addMonths(base, months);
  // Never offer a window that's already fully in the past relative to today.
  const todayDate = parseDate(today);
  const from = target.getTime() > todayDate.getTime() ? target : todayDate;
  return nextColorWeek(client.color_week, from);
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
