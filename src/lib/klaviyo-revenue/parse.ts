import type { CatalogMetric, DailyPoint, ReportRow } from "./types";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function dateKeyFromKlaviyo(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const key = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

export function channelName(raw: string): "email" | "sms" | "other" {
  const n = raw.trim().toLowerCase().replace(/^\$/, "");
  if (n === "email" || n.includes("email")) return "email";
  if (n === "sms" || n.includes("sms") || n.includes("text")) return "sms";
  return "other";
}

/**
 * Metric aggregates return one row per dimension, with measurement arrays
 * aligned to `dates`. No `by` means a single undimensioned row.
 */
export function parseMetricAggregate(body: unknown): {
  rows: Array<{ channel: "email" | "sms" | "other" | "all"; points: DailyPoint[] }>;
} {
  const data = asRecord(asRecord(body)?.data);
  const attributes = asRecord(data?.attributes);
  const dates = Array.isArray(attributes?.dates) ? attributes.dates : [];
  const rowsIn = Array.isArray(attributes?.data) ? attributes.data : [];
  const rows: Array<{ channel: "email" | "sms" | "other" | "all"; points: DailyPoint[] }> = [];

  for (const row of rowsIn) {
    const rec = asRecord(row);
    if (!rec) continue;
    const dimensions = Array.isArray(rec.dimensions) ? rec.dimensions : [];
    const channel: "email" | "sms" | "other" | "all" =
      dimensions.length === 0
        ? "all"
        : channelName(dimensions.map((d) => String(d ?? "")).join(" "));
    const measurements = asRecord(rec.measurements) ?? {};
    const counts = Array.isArray(measurements.count) ? measurements.count : [];
    const sums = Array.isArray(measurements.sum_value) ? measurements.sum_value : [];
    const points: DailyPoint[] = [];
    for (let i = 0; i < dates.length; i++) {
      const date = dateKeyFromKlaviyo(dates[i]);
      if (!date) continue;
      points.push({ date, count: num(counts[i]), sumValue: num(sums[i]) });
    }
    rows.push({ channel, points });
  }
  return { rows };
}

export function undimensionedSeries(body: unknown): DailyPoint[] {
  const { rows } = parseMetricAggregate(body);
  const all = rows.find((row) => row.channel === "all") ?? rows[0];
  return all?.points ?? [];
}

export function emailSeries(body: unknown): DailyPoint[] {
  const { rows } = parseMetricAggregate(body);
  return rows.filter((row) => row.channel === "email").flatMap((row) => row.points);
}

export function parseValuesReport(body: unknown): ReportRow[] {
  const data = asRecord(asRecord(body)?.data);
  const attributes = asRecord(data?.attributes);
  const results = Array.isArray(attributes?.results) ? attributes.results : [];
  const rows: ReportRow[] = [];
  for (const result of results) {
    const rec = asRecord(result);
    if (!rec) continue;
    const groupings = asRecord(rec.groupings) ?? {};
    const statistics = asRecord(rec.statistics) ?? {};
    const channel = channelName(String(groupings.send_channel ?? groupings.channel ?? ""));
    const id = String(
      groupings.campaign_id ?? groupings.flow_id ?? groupings.campaign_message_id ?? groupings.flow_message_id ?? ""
    );
    const name = String(
      groupings.campaign_name ??
        groupings.flow_name ??
        groupings.message_name ??
        groupings.name ??
        (id ? id : "Untitled")
    );
    rows.push({
      id: id || name,
      name,
      channel,
      conversions: num(statistics.conversions ?? statistics.conversion_uniques),
      revenue: num(statistics.conversion_value),
    });
  }
  return rows;
}

export function sumReport(rows: ReportRow[], channel?: "email" | "sms"): { conversions: number; revenue: number } {
  let conversions = 0;
  let revenue = 0;
  for (const row of rows) {
    if (channel && row.channel !== channel && row.channel !== "other") continue;
    if (channel && row.channel === "other") continue;
    conversions += row.conversions;
    revenue += row.revenue;
  }
  return { conversions, revenue };
}

export function parseMetricCatalog(body: unknown): CatalogMetric[] {
  const data = asRecord(body)?.data;
  const rows = Array.isArray(data) ? data : [];
  const out: CatalogMetric[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const id = String(rec.id ?? "");
    const attributes = asRecord(rec.attributes);
    const name = String(attributes?.name ?? "");
    if (id && name) out.push({ id, name });
  }
  return out;
}

export function nextPage(body: unknown): string | null {
  const links = asRecord(asRecord(body)?.links);
  const next = links?.next;
  return typeof next === "string" && next ? next : null;
}

export function parseAccountProfile(body: unknown): {
  id: string;
  name: string;
  timezone: string;
  currency: string;
} | null {
  const data = asRecord(body)?.data;
  const row = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  if (!row) return null;
  const attributes = asRecord(row.attributes) ?? {};
  const contact = asRecord(attributes.contact_information) ?? {};
  const name = String(contact.organization_name ?? contact.default_sender_name ?? "").trim();
  return {
    id: String(row.id ?? ""),
    name,
    timezone: String(attributes.timezone ?? ""),
    currency: String(attributes.preferred_currency ?? "USD").toUpperCase() || "USD",
  };
}

export function parseEvents(body: unknown, kind: "form" | "book" | "sms"): Array<{
  profileId: string;
  at: number;
  kind: "form" | "book" | "sms";
  value?: number;
}> {
  const data = asRecord(body)?.data;
  const rows = Array.isArray(data) ? data : [];
  const out: Array<{ profileId: string; at: number; kind: "form" | "book" | "sms"; value?: number }> = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const attributes = asRecord(rec.attributes) ?? {};
    const at = Date.parse(String(attributes.datetime ?? ""));
    if (!Number.isFinite(at)) continue;
    const relationships = asRecord(rec.relationships) ?? {};
    const profile = asRecord(asRecord(relationships.profile)?.data);
    const profileId = String(profile?.id ?? "");
    if (!profileId) continue;
    const props = asRecord(attributes.event_properties) ?? {};
    const value = num(props.$value ?? props.value);
    out.push({ profileId, at, kind, value: kind === "book" ? value : undefined });
  }
  return out;
}
