import { KlaviyoError, klaviyoRequest } from "../klaviyo";
import { MAX_EVENTS_PER_METRIC } from "./types";
import {
  nextPage,
  parseAccountProfile,
  parseEvents,
  parseMetricCatalog,
} from "./parse";
import type { CatalogMetric, TimelineEvent } from "./types";

const GAP_MS = 800;

const nextAllowed = new Map<string, number>();

export async function pace(bucket: string, gapMs = GAP_MS): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextAllowed.get(bucket) ?? 0);
  nextAllowed.set(bucket, start + gapMs);
  const wait = start - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export type KlaviyoTransport = {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
};

export function liveTransport(apiKey: string, bucket: string): KlaviyoTransport {
  return {
    async get(path: string) {
      await pace(bucket);
      return klaviyoRequest(apiKey, "GET", path);
    },
    async post(path: string, body: unknown) {
      await pace(bucket);
      return klaviyoRequest(apiKey, "POST", path, body);
    },
  };
}

export function metricAggregateBody(input: {
  metricId: string;
  startIso: string;
  endIso: string;
  timezone: string;
  by?: string[];
}): unknown {
  const attributes: Record<string, unknown> = {
    metric_id: input.metricId,
    measurements: ["count", "sum_value"],
    interval: "day",
    page_size: 500,
    timezone: input.timezone,
    filter: [
      `greater-or-equal(datetime,${input.startIso})`,
      `less-than(datetime,${input.endIso})`,
    ],
  };
  if (input.by?.length) attributes.by = input.by;
  return { data: { type: "metric-aggregate", attributes } };
}

export function valuesReportBody(input: {
  type: "campaign-values-report" | "flow-values-report";
  conversionMetricId: string;
  startIso: string;
  endIso: string;
  channel: "email" | "sms";
}): unknown {
  return {
    data: {
      type: input.type,
      attributes: {
        statistics: ["conversions", "conversion_value", "conversion_uniques"],
        timeframe: { start: input.startIso, end: input.endIso },
        conversion_metric_id: input.conversionMetricId,
        filter: `equals(send_channel,"${input.channel}")`,
      },
    },
  };
}

export function eventPath(metricId: string, startIso: string, endIso: string): string {
  const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(datetime,${startIso}),less-than(datetime,${endIso}))`;
  return `/events?filter=${encodeURIComponent(filter)}&sort=datetime&page[size]=100&fields[event]=datetime,event_properties`;
}

async function follow(transport: KlaviyoTransport, firstPath: string, maxPages: number): Promise<{ pages: unknown[]; truncated: boolean }> {
  const pages: unknown[] = [];
  let path: string | null = firstPath;
  let truncated = false;
  while (path && pages.length < maxPages) {
    const body = await transport.get(path);
    pages.push(body);
    path = nextPage(body);
  }
  if (path) truncated = true;
  return { pages, truncated };
}

export async function fetchAccountProfile(transport: KlaviyoTransport): Promise<{
  id: string;
  name: string;
  timezone: string;
  currency: string;
} | null> {
  const body = await transport.get("/accounts/");
  return parseAccountProfile(body);
}

export async function fetchMetrics(transport: KlaviyoTransport): Promise<CatalogMetric[]> {
  const { pages } = await follow(transport, "/metrics?fields[metric]=name&page[size]=200", 10);
  const merged: CatalogMetric[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const metric of parseMetricCatalog(page)) {
      if (seen.has(metric.id)) continue;
      seen.add(metric.id);
      merged.push(metric);
    }
  }
  return merged;
}

export async function fetchEvents(
  transport: KlaviyoTransport,
  metricId: string,
  startIso: string,
  endIso: string,
  kind: TimelineEvent["kind"]
): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  const maxPages = Math.ceil(MAX_EVENTS_PER_METRIC / 100);
  const { pages, truncated: pageTruncated } = await follow(
    transport,
    eventPath(metricId, startIso, endIso),
    maxPages
  );
  const events: TimelineEvent[] = [];
  for (const page of pages) events.push(...parseEvents(page, kind));
  const truncated = pageTruncated || events.length >= MAX_EVENTS_PER_METRIC;
  return { events: events.slice(0, MAX_EVENTS_PER_METRIC), truncated };
}

export function isAuthFailure(err: unknown): boolean {
  return err instanceof KlaviyoError && (err.status === 401 || err.status === 403);
}

export function errorMessage(err: unknown): string {
  if (err instanceof KlaviyoError) return err.message;
  if (err instanceof Error) return err.message;
  return "Klaviyo request failed.";
}
