import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type BusinessModel,
  type RevClient,
  type RevMetric,
} from "./db";

export type { BusinessModel, RevClient, RevMetric };

export const BUSINESS_MODELS: { value: BusinessModel; label: string }[] = [
  { value: "ecomm", label: "Ecommerce" },
  { value: "b2b", label: "B2B" },
  { value: "home_service", label: "Home service" },
];

export function businessModelLabel(model: BusinessModel): string {
  return BUSINESS_MODELS.find((m) => m.value === model)?.label ?? model;
}

/* ------------------------------------------------------------------ clients */

export function listRevClients(includeInactive = false): RevClient[] {
  const where = includeInactive ? "" : "WHERE active = 1";
  return getDb()
    .prepare(`SELECT * FROM rev_clients ${where} ORDER BY name COLLATE NOCASE`)
    .all() as RevClient[];
}

export function getRevClient(id: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(id) as RevClient | undefined) || null
  );
}

export function createRevClient(input: {
  name: string;
  businessModel: BusinessModel;
  ghlLocationId?: string;
  klaviyoAccount?: string;
  retainer?: number;
  monthlyCost?: number;
  ltv?: number | null;
}): RevClient {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO rev_clients
      (id, name, business_model, ghl_location_id, klaviyo_account, retainer, monthly_cost, ltv, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    input.name.trim(),
    input.businessModel,
    (input.ghlLocationId || "").trim(),
    (input.klaviyoAccount || "").trim(),
    input.retainer ?? 0,
    input.monthlyCost ?? 0,
    input.ltv ?? null,
    ts,
    ts
  );
  return getRevClient(id)!;
}

export function updateRevClient(
  id: string,
  updates: Partial<{
    name: string;
    businessModel: BusinessModel;
    ghlLocationId: string;
    klaviyoAccount: string;
    retainer: number;
    monthlyCost: number;
    ltv: number | null;
    active: boolean;
  }>
): RevClient | null {
  const existing = getRevClient(id);
  if (!existing) return null;
  const db = getDb();
  db.prepare(
    `UPDATE rev_clients SET
       name = ?, business_model = ?, ghl_location_id = ?, klaviyo_account = ?,
       retainer = ?, monthly_cost = ?, ltv = ?, active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    updates.name?.trim() ?? existing.name,
    updates.businessModel ?? existing.business_model,
    updates.ghlLocationId?.trim() ?? existing.ghl_location_id,
    updates.klaviyoAccount?.trim() ?? existing.klaviyo_account,
    updates.retainer ?? existing.retainer,
    updates.monthlyCost ?? existing.monthly_cost,
    updates.ltv === undefined ? existing.ltv : updates.ltv,
    updates.active === undefined ? existing.active : updates.active ? 1 : 0,
    nowIso(),
    id
  );
  return getRevClient(id);
}

export function deleteRevClient(id: string): boolean {
  return getDb().prepare(`DELETE FROM rev_clients WHERE id = ?`).run(id).changes > 0;
}

/* ------------------------------------------------------------------ metrics */

export function listMetrics(clientId: string): RevMetric[] {
  return getDb()
    .prepare(`SELECT * FROM rev_metrics WHERE client_id = ? ORDER BY month ASC`)
    .all(clientId) as RevMetric[];
}

export function allMetrics(): RevMetric[] {
  return getDb()
    .prepare(`SELECT * FROM rev_metrics ORDER BY month ASC`)
    .all() as RevMetric[];
}

// Upsert a month. Only provided fields overwrite; omitted fields keep prior
// values so a GHL activity sync doesn't wipe a manually-entered revenue figure.
export function upsertMetric(input: {
  clientId: string;
  month: string;
  revenue?: number;
  orders?: number;
  appointments?: number;
  leads?: number;
  recipients?: number;
  campaignsSent?: number;
  opens?: number;
  clicks?: number;
  revenueSource?: RevMetric["revenue_source"];
  activitySource?: RevMetric["activity_source"];
  note?: string;
}): RevMetric {
  const db = getDb();
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT * FROM rev_metrics WHERE client_id = ? AND month = ?`)
    .get(input.clientId, input.month) as RevMetric | undefined;

  const merged = {
    revenue: input.revenue ?? existing?.revenue ?? 0,
    orders: input.orders ?? existing?.orders ?? 0,
    appointments: input.appointments ?? existing?.appointments ?? 0,
    leads: input.leads ?? existing?.leads ?? 0,
    recipients: input.recipients ?? existing?.recipients ?? 0,
    campaigns_sent: input.campaignsSent ?? existing?.campaigns_sent ?? 0,
    opens: input.opens ?? existing?.opens ?? 0,
    clicks: input.clicks ?? existing?.clicks ?? 0,
    revenue_source:
      input.revenueSource ?? existing?.revenue_source ?? "manual",
    activity_source:
      input.activitySource ?? existing?.activity_source ?? "manual",
    note: input.note ?? existing?.note ?? "",
  };

  if (existing) {
    db.prepare(
      `UPDATE rev_metrics SET
         revenue = ?, orders = ?, appointments = ?, leads = ?, recipients = ?,
         campaigns_sent = ?, opens = ?, clicks = ?, revenue_source = ?,
         activity_source = ?, note = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      merged.revenue,
      merged.orders,
      merged.appointments,
      merged.leads,
      merged.recipients,
      merged.campaigns_sent,
      merged.opens,
      merged.clicks,
      merged.revenue_source,
      merged.activity_source,
      merged.note,
      ts,
      existing.id
    );
    return db
      .prepare(`SELECT * FROM rev_metrics WHERE id = ?`)
      .get(existing.id) as RevMetric;
  }

  const id = nanoid(12);
  db.prepare(
    `INSERT INTO rev_metrics
      (id, client_id, month, revenue, orders, appointments, leads, recipients,
       campaigns_sent, opens, clicks, revenue_source, activity_source, note,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.month,
    merged.revenue,
    merged.orders,
    merged.appointments,
    merged.leads,
    merged.recipients,
    merged.campaigns_sent,
    merged.opens,
    merged.clicks,
    merged.revenue_source,
    merged.activity_source,
    merged.note,
    ts,
    ts
  );
  return db.prepare(`SELECT * FROM rev_metrics WHERE id = ?`).get(id) as RevMetric;
}

export function deleteMetric(clientId: string, month: string): boolean {
  return (
    getDb()
      .prepare(`DELETE FROM rev_metrics WHERE client_id = ? AND month = ?`)
      .run(clientId, month).changes > 0
  );
}

/* -------------------------------------------------------------- aggregation */

// Summed raw metrics over a set of months, plus the month count for
// retainer/cost math (those are monthly figures).
export interface Aggregate {
  months: number;
  revenue: number;
  orders: number;
  appointments: number;
  leads: number;
  recipients: number;
  campaigns_sent: number;
  opens: number;
  clicks: number;
}

export function aggregate(metrics: RevMetric[]): Aggregate {
  const a: Aggregate = {
    months: metrics.length,
    revenue: 0,
    orders: 0,
    appointments: 0,
    leads: 0,
    recipients: 0,
    campaigns_sent: 0,
    opens: 0,
    clicks: 0,
  };
  for (const m of metrics) {
    a.revenue += m.revenue;
    a.orders += m.orders;
    a.appointments += m.appointments;
    a.leads += m.leads;
    a.recipients += m.recipients;
    a.campaigns_sent += m.campaigns_sent;
    a.opens += m.opens;
    a.clicks += m.clicks;
  }
  return a;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

// Profitability is period-aware: retainer/cost are monthly, so multiply by the
// number of months in the aggregate.
export function profitability(agg: Aggregate, client: RevClient) {
  const retainerTotal = client.retainer * Math.max(1, agg.months);
  const costTotal = client.monthly_cost * Math.max(1, agg.months);
  return {
    retainerTotal,
    costTotal,
    // Client ROI: attributed revenue as a multiple of what they pay you.
    clientRoi: retainerTotal > 0 ? agg.revenue / retainerTotal : null,
    // Agency margin: your retainer minus your cost to deliver.
    agencyMargin: retainerTotal - costTotal,
    agencyMarginPct: retainerTotal > 0 ? (retainerTotal - costTotal) / retainerTotal : null,
  };
}

/* ------------------------------------------------------- model KPI configs */

export type Fmt = "currency" | "number" | "percent" | "multiple";

export interface Kpi {
  key: string;
  label: string;
  fmt: Fmt;
  value: (agg: Aggregate, client: RevClient) => number | null;
  hint?: string;
}

// Profitability KPIs shown for every model.
const PROFIT_KPIS: Kpi[] = [
  {
    key: "revenue",
    label: "Attributed revenue",
    fmt: "currency",
    value: (a) => a.revenue,
    hint: "Revenue attributed to email over the period.",
  },
  {
    key: "roi",
    label: "Client ROI",
    fmt: "multiple",
    value: (a, c) => profitability(a, c).clientRoi,
    hint: "Attributed revenue ÷ retainer.",
  },
  {
    key: "agency_margin",
    label: "Agency margin",
    fmt: "currency",
    value: (a, c) => profitability(a, c).agencyMargin,
    hint: "Retainer minus cost to deliver, over the period.",
  },
  {
    key: "margin_pct",
    label: "Margin %",
    fmt: "percent",
    value: (a, c) => profitability(a, c).agencyMarginPct,
    hint: "Agency margin as a share of retainer.",
  },
  {
    key: "rev_per_email",
    label: "Revenue / email",
    fmt: "currency",
    value: (a) => div(a.revenue, a.campaigns_sent),
    hint: "Attributed revenue per email campaign sent.",
  },
];

const ECOMM_KPIS: Kpi[] = [
  { key: "orders", label: "Orders", fmt: "number", value: (a) => a.orders },
  { key: "aov", label: "AOV", fmt: "currency", value: (a) => div(a.revenue, a.orders) },
  {
    key: "rev_per_recipient",
    label: "Revenue / recipient",
    fmt: "currency",
    value: (a) => div(a.revenue, a.recipients),
  },
  {
    key: "ltv",
    label: "Customer LTV",
    fmt: "currency",
    value: (_a, c) => c.ltv,
    hint: "Configured average customer lifetime value.",
  },
];

const B2B_KPIS: Kpi[] = [
  { key: "leads", label: "Leads", fmt: "number", value: (a) => a.leads },
  { key: "appointments", label: "Appointments", fmt: "number", value: (a) => a.appointments },
  { key: "deals", label: "Deals closed", fmt: "number", value: (a) => a.orders },
  { key: "avg_deal", label: "Avg deal size", fmt: "currency", value: (a) => div(a.revenue, a.orders) },
  {
    key: "close_rate",
    label: "Appt → close",
    fmt: "percent",
    value: (a) => div(a.orders, a.appointments),
  },
  {
    key: "ltv",
    label: "Contract LTV",
    fmt: "currency",
    value: (_a, c) => c.ltv,
    hint: "Configured average contract / lifetime value.",
  },
];

const HOME_SERVICE_KPIS: Kpi[] = [
  { key: "leads", label: "Leads", fmt: "number", value: (a) => a.leads },
  { key: "appointments", label: "Jobs booked", fmt: "number", value: (a) => a.appointments },
  { key: "jobs", label: "Jobs completed", fmt: "number", value: (a) => a.orders },
  { key: "avg_ticket", label: "Avg ticket", fmt: "currency", value: (a) => div(a.revenue, a.orders) },
  {
    key: "booking_rate",
    label: "Lead → booked",
    fmt: "percent",
    value: (a) => div(a.appointments, a.leads),
  },
  {
    key: "ltv",
    label: "Customer LTV",
    fmt: "currency",
    value: (_a, c) => c.ltv,
    hint: "Configured average customer lifetime value.",
  },
];

const MODEL_KPIS: Record<BusinessModel, Kpi[]> = {
  ecomm: ECOMM_KPIS,
  b2b: B2B_KPIS,
  home_service: HOME_SERVICE_KPIS,
};

// The ordered KPI tiles for a client: profitability first, then model-specific.
export function kpisForModel(model: BusinessModel): Kpi[] {
  return [...PROFIT_KPIS, ...MODEL_KPIS[model]];
}

// Funnel stages per model, using shared metric keys.
export function funnelForModel(
  model: BusinessModel
): { key: keyof Aggregate; label: string }[] {
  switch (model) {
    case "ecomm":
      return [
        { key: "recipients", label: "Recipients" },
        { key: "clicks", label: "Clicks" },
        { key: "orders", label: "Orders" },
      ];
    case "b2b":
      return [
        { key: "leads", label: "Leads" },
        { key: "appointments", label: "Appointments" },
        { key: "orders", label: "Deals" },
      ];
    case "home_service":
      return [
        { key: "leads", label: "Leads" },
        { key: "appointments", label: "Jobs booked" },
        { key: "orders", label: "Completed" },
      ];
  }
}

/* --------------------------------------------------------- portfolio rollup */

export interface ClientRollup {
  client: RevClient;
  agg: Aggregate;
  clientRoi: number | null;
  agencyMargin: number;
  latestMonth: string | null;
}

export interface PortfolioSummary {
  clients: ClientRollup[];
  totalRevenue: number;
  totalRetainer: number;
  totalCost: number;
  totalAgencyMargin: number;
  blendedRoi: number | null;
  totalAppointments: number;
  totalOrders: number;
  months: string[]; // distinct months present, ascending
}

export function portfolioSummary(): PortfolioSummary {
  const clients = listRevClients();
  const metrics = allMetrics();
  const byClient = new Map<string, RevMetric[]>();
  for (const m of metrics) {
    const arr = byClient.get(m.client_id) || [];
    arr.push(m);
    byClient.set(m.client_id, arr);
  }

  const rollups: ClientRollup[] = clients.map((client) => {
    const ms = byClient.get(client.id) || [];
    const agg = aggregate(ms);
    const p = profitability(agg, client);
    return {
      client,
      agg,
      clientRoi: p.clientRoi,
      agencyMargin: p.agencyMargin,
      latestMonth: ms.length ? ms[ms.length - 1].month : null,
    };
  });

  let totalRevenue = 0;
  let totalRetainer = 0;
  let totalCost = 0;
  let totalAppointments = 0;
  let totalOrders = 0;
  for (const r of rollups) {
    totalRevenue += r.agg.revenue;
    totalRetainer += r.client.retainer * Math.max(1, r.agg.months);
    totalCost += r.client.monthly_cost * Math.max(1, r.agg.months);
    totalAppointments += r.agg.appointments;
    totalOrders += r.agg.orders;
  }

  const months = Array.from(new Set(metrics.map((m) => m.month))).sort();

  return {
    clients: rollups,
    totalRevenue,
    totalRetainer,
    totalCost,
    totalAgencyMargin: totalRetainer - totalCost,
    blendedRoi: totalRetainer > 0 ? totalRevenue / totalRetainer : null,
    totalAppointments,
    totalOrders,
    months,
  };
}

/* -------------------------------------------------------------- formatting */

export function formatKpi(value: number | null, fmt: Fmt): string {
  if (value === null || Number.isNaN(value)) return "—";
  switch (fmt) {
    case "currency":
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value >= 1000 ? 0 : 2,
      });
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(1)}x`;
    case "number":
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}
