/**
 * Cross-account rollup: which Lifecycle clients have form fills / bookings
 * credited to a campaign or flow send (last-touch attribution).
 */

import {
  type AnalyticsPreset,
  pullClientAttributionSummary,
  resolveAnalyticsRange,
} from "./ghl-email-analytics";
import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";
import { buildLifecycleHub } from "./lifecycle-hub";
import { getRevClient } from "./revenue";

const ROLLUP_CONCURRENCY = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type AttributionRollupRow = {
  clientId: string;
  clientName: string;
  locationId: string;
  attributedAppointments: number;
  attributedFormFills: number;
  totalAppointments: number | null;
  totalFormFills: number | null;
  campaignSends: number;
  flowSends: number;
  error: string | null;
};

export type AttributionRollup = {
  start: string;
  end: string;
  range: AnalyticsPreset;
  attributionDays: number;
  fetchedAt: string;
  scanned: number;
  withWins: number;
  totals: {
    attributedAppointments: number;
    attributedFormFills: number;
  };
  /** Accounts with at least one attributed booking or form fill, richest first. */
  wins: AttributionRollupRow[];
  /** GHL-linked accounts with zero attributed conversions (or pull errors). */
  others: AttributionRollupRow[];
  cached: boolean;
};

type CacheEntry = { at: number; payload: AttributionRollup };

const cache = new Map<string, CacheEntry>();

function resolveLocationId(clientId: string, memberIds: string[]): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    const loc = (getRevClient(id)?.ghl_location_id || "").trim();
    if (loc) return loc;
  }
  return null;
}

async function pooledMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

/** Sort richest email-attributed accounts first (bookings, then forms). */
export function sortAttributionWins(
  a: AttributionRollupRow,
  b: AttributionRollupRow
): number {
  return (
    b.attributedAppointments - a.attributedAppointments ||
    b.attributedFormFills - a.attributedFormFills ||
    a.clientName.localeCompare(b.clientName)
  );
}

/** Split scanned rows into accounts with email wins vs everyone else. */
export function partitionAttributionRows(rows: AttributionRollupRow[]): {
  wins: AttributionRollupRow[];
  others: AttributionRollupRow[];
} {
  const wins = rows
    .filter((r) => r.attributedAppointments > 0 || r.attributedFormFills > 0)
    .sort(sortAttributionWins);
  const others = rows
    .filter((r) => r.attributedAppointments === 0 && r.attributedFormFills === 0)
    .sort((a, b) => a.clientName.localeCompare(b.clientName));
  return { wins, others };
}

export function clearAttributionRollupCache(): void {
  cache.clear();
}

/**
 * Scan every GHL-linked Lifecycle hub client and sum last-touch email wins.
 */
export async function pullAttributionRollup(options: {
  range?: AnalyticsPreset;
  from?: string | null;
  to?: string | null;
  attributionDays?: number;
  refresh?: boolean;
}): Promise<AttributionRollup> {
  const range = options.range || "3m";
  const attributionDays = options.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS;
  const { start, end } = resolveAnalyticsRange(range, options.from, options.to);
  const cacheKey = `${range}:${start}:${end}:${attributionDays}`;

  if (!options.refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.payload, cached: true };
    }
  }

  const hub = buildLifecycleHub();
  const targets = hub.clients
    .filter((c) => c.ghlLinked)
    .map((c) => {
      const locationId = resolveLocationId(c.id, c.memberIds || []);
      return locationId
        ? { clientId: c.id, clientName: c.name, locationId }
        : null;
    })
    .filter(Boolean) as Array<{
    clientId: string;
    clientName: string;
    locationId: string;
  }>;

  const rows = await pooledMap(targets, ROLLUP_CONCURRENCY, async (target) => {
    try {
      const summary = await pullClientAttributionSummary(
        target.locationId,
        start,
        end,
        attributionDays
      );
      return {
        clientId: target.clientId,
        clientName: target.clientName,
        locationId: target.locationId,
        attributedAppointments: summary.attributedAppointments,
        attributedFormFills: summary.attributedFormFills,
        totalAppointments: summary.totalAppointments,
        totalFormFills: summary.totalFormFills,
        campaignSends: summary.campaignSends,
        flowSends: summary.flowSends,
        error: summary.error,
      } satisfies AttributionRollupRow;
    } catch (err) {
      return {
        clientId: target.clientId,
        clientName: target.clientName,
        locationId: target.locationId,
        attributedAppointments: 0,
        attributedFormFills: 0,
        totalAppointments: null,
        totalFormFills: null,
        campaignSends: 0,
        flowSends: 0,
        error: err instanceof Error ? err.message : "Scan failed.",
      } satisfies AttributionRollupRow;
    }
  });

  const { wins, others } = partitionAttributionRows(rows);

  const payload: AttributionRollup = {
    start,
    end,
    range,
    attributionDays,
    fetchedAt: new Date().toISOString(),
    scanned: rows.length,
    withWins: wins.length,
    totals: {
      attributedAppointments: rows.reduce(
        (n, r) => n + r.attributedAppointments,
        0
      ),
      attributedFormFills: rows.reduce((n, r) => n + r.attributedFormFills, 0),
    },
    wins,
    others,
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
