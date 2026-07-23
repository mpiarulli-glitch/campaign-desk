import { nanoid } from "nanoid";
import { getDb, type RevClient, type ScheduledSend } from "./db";
import {
  computeCycleStatus,
  findSendForWindow,
  nextWindow,
  todayYmd,
  type CycleStatus,
  type Window,
} from "./cadence";
import { deliverableOverview, getOrCreateToken as getOrCreateSnapshotToken } from "./snapshot";
import { aggregate, getRevClient, kpisForModel, listMetrics } from "./revenue";
import { planSends } from "./plan";
import { listActivity, type ActivityItem } from "./campaigns";

/* ------------------------------------------------------- share token */

export function getOrCreateDashboardToken(clientId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT dashboard_token FROM rev_clients WHERE id = ?`)
    .get(clientId) as { dashboard_token: string | null } | undefined;
  if (!row) return null;
  if (row.dashboard_token) return row.dashboard_token;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET dashboard_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function rotateDashboardToken(clientId: string): string | null {
  const db = getDb();
  const exists = db.prepare(`SELECT id FROM rev_clients WHERE id = ?`).get(clientId);
  if (!exists) return null;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET dashboard_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function getClientByDashboardToken(token: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE dashboard_token = ?`)
      .get(token) as RevClient | undefined) || null
  );
}

/* --------------------------------------------------- production status */

export interface ProductionStatus {
  window: Window | null;
  status: CycleStatus;
  existingSend: { sendDate: string; status: string } | null;
}

export function productionStatus(client: RevClient): ProductionStatus {
  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  const existing = window ? findSendForWindow(client.id, window.start) : null;
  return {
    window,
    status,
    existingSend: existing ? { sendDate: existing.send_date, status: existing.status } : null,
  };
}

/* -------------------------------------------------------------- activity */

// One combined, time-sorted feed of everything that happened on an account:
// campaign feedback/approvals (via listActivity, now client_id-scoped),
// client notes left on the shared editorial calendar, and production booking
// events. Internal-only (OKRs) never flows through this function.
export interface AccountActivityItem {
  kind: "feedback" | "approved" | "calendar_note" | "production_booked" | "production_sent";
  at: string;
  summary: string;
  detail: string;
}

export function accountActivity(clientId: string, limit = 30): AccountActivityItem[] {
  const campaignItems: AccountActivityItem[] = listActivity(limit, clientId).map(
    (item: ActivityItem) => ({
      kind: item.kind,
      at: item.at,
      summary:
        item.kind === "approved"
          ? `${item.campaign_title} approved`
          : `${item.actor || "Someone"} commented on ${item.campaign_title}`,
      detail: item.kind === "approved" ? "" : item.body || "",
    })
  );

  const calendarNotes = getDb()
    .prepare(
      `SELECT cf.body, cf.updated_at, s.title
       FROM calendar_feedback cf
       JOIN scheduled_sends s ON s.id = cf.send_id
       WHERE cf.client_id = ?
       ORDER BY cf.updated_at DESC LIMIT ?`
    )
    .all(clientId, limit) as Array<{ body: string; updated_at: string; title: string }>;
  const calendarItems: AccountActivityItem[] = calendarNotes.map((n) => ({
    kind: "calendar_note",
    at: n.updated_at,
    summary: `Note left on "${n.title}"`,
    detail: n.body,
  }));

  const sends = getDb()
    .prepare(
      `SELECT title, send_date, status, updated_at FROM scheduled_sends
       WHERE client_id = ? AND status IN ('requested','sent')
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(clientId, limit) as Array<{
    title: string;
    send_date: string;
    status: string;
    updated_at: string;
  }>;
  const sendItems: AccountActivityItem[] = sends.map((s) => ({
    kind: s.status === "sent" ? "production_sent" : "production_booked",
    at: s.updated_at,
    summary:
      s.status === "sent"
        ? `"${s.title}" sent`
        : `Production requested for ${s.send_date}`,
    detail: s.title,
  }));

  return [...campaignItems, ...calendarItems, ...sendItems]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/* --------------------------------------------------- aggregated dashboard */

interface DashboardKpi {
  key: string;
  label: string;
  fmt: string;
  hint: string | null;
  value: number | null;
}

export interface ClientDashboardData {
  client: { id: string; name: string };
  production: ProductionStatus;
  snapshot: { token: string | null; overview: ReturnType<typeof deliverableOverview> };
  accountData: { kpis: DashboardKpi[] };
  calendar: ScheduledSend[];
  activity: AccountActivityItem[];
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// The single aggregating read used by both the public dashboard route and the
// internal admin hub route. Deliberately does NOT touch src/lib/okrs.ts —
// the admin route merges OKRs on top of this result itself, so this function
// can never leak internal-only data through the public token endpoint.
export function getClientDashboardData(clientId: string): ClientDashboardData | null {
  const client = getRevClient(clientId);
  if (!client) return null;

  const today = todayYmd();
  const metrics = listMetrics(clientId);
  const agg = aggregate(metrics);
  const kpis = kpisForModel(client.business_model).map((k) => ({
    key: k.key,
    label: k.label,
    fmt: k.fmt,
    hint: k.hint ?? null,
    value: k.value(agg, client),
  }));

  return {
    client: { id: client.id, name: client.name },
    production: productionStatus(client),
    snapshot: {
      token: getOrCreateSnapshotToken(client.id),
      overview: deliverableOverview(client.id),
    },
    accountData: { kpis },
    calendar: planSends(client.id, addDaysYmd(today, -14), addDaysYmd(today, 60)),
    activity: accountActivity(client.id),
  };
}
