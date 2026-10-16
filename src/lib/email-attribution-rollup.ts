/**
 * Cross-account rollup: which email or SMS drove form fills and bookings.
 * UTM-confirmed first (Converted fields, then Latest/First attribution).
 * Inferred rows are only messages verified on that contact's thread.
 */

import {
  type AnalyticsPreset,
  resolveAnalyticsRange,
} from "./ghl-email-analytics";
import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";
import { pullLocationMessageAttribution } from "./ghl-utm-conversions";
import { buildLifecycleHub } from "./lifecycle-hub";
import { getRevClient } from "./revenue";
import {
  groupAttributionByContent,
  isHipaaBlockedAccount,
  summarizeAttributionRows,
  type ContentGroup,
} from "./utm-conversion-attribution";

const ROLLUP_CONCURRENCY = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type AttributionRollupRow = {
  clientId: string;
  clientName: string;
  locationId: string;
  attributedAppointments: number;
  attributedFormFills: number;
  confirmedAppointments: number;
  confirmedFormFills: number;
  inferredAppointments: number;
  inferredFormFills: number;
  emailAppointments: number;
  emailFormFills: number;
  smsAppointments: number;
  smsFormFills: number;
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
    confirmedAppointments: number;
    confirmedFormFills: number;
    inferredAppointments: number;
    inferredFormFills: number;
    emailAppointments: number;
    emailFormFills: number;
    smsAppointments: number;
    smsFormFills: number;
  };
  /** One row per email/SMS (Converted Content, or the verified thread message). */
  pieces: ContentGroup[];
  /** Accounts with at least one attributed booking or form fill, richest first. */
  wins: AttributionRollupRow[];
  /** GHL-linked accounts with zero attributed conversions (or pull errors). */
  others: AttributionRollupRow[];
  cached: boolean;
};

type CacheEntry = { at: number; payload: AttributionRollup };

const cache = new Map<string, CacheEntry>();

function memberIsHipaa(clientId: string): boolean {
  return isHipaaBlockedAccount(getRevClient(clientId)?.name || "");
}

/**
 * Location for a hub card. Trailhead Family Chiropractic is never selected,
 * even when it shares a group with another client.
 */
function resolveLocationId(clientId: string, memberIds: string[]): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    if (memberIsHipaa(id)) continue;
    const client = getRevClient(id);
    const loc = (client?.ghl_location_id || "").trim();
    if (!loc) continue;
    if (isHipaaBlockedAccount(client?.name || "")) continue;
    return loc;
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
    b.confirmedAppointments - a.confirmedAppointments ||
    b.attributedAppointments - a.attributedAppointments ||
    b.confirmedFormFills - a.confirmedFormFills ||
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

const EMPTY_COUNTS = {
  attributedAppointments: 0,
  attributedFormFills: 0,
  confirmedAppointments: 0,
  confirmedFormFills: 0,
  inferredAppointments: 0,
  inferredFormFills: 0,
  emailAppointments: 0,
  emailFormFills: 0,
  smsAppointments: 0,
  smsFormFills: 0,
};

/**
 * Scan every GHL-linked Lifecycle hub client except Trailhead (HIPAA).
 * Confirmed UTM credit is preferred. Inferred credit is contact-thread only.
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
    .filter((c) => c.ghlLinked && !isHipaaBlockedAccount(c.name))
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

  const scanned = await pooledMap(targets, ROLLUP_CONCURRENCY, async (target) => {
    try {
      const summary = await pullLocationMessageAttribution({
        locationId: target.locationId,
        clientName: target.clientName,
        start,
        end,
        attributionDays,
      });
      if (summary.skipped === "hipaa") return null;
      const counts = summarizeAttributionRows(summary.rows);
      return {
        row: {
          clientId: target.clientId,
          clientName: target.clientName,
          locationId: target.locationId,
          ...counts,
          totalAppointments: summary.totalAppointments,
          totalFormFills: summary.totalFormFills,
          campaignSends: summary.campaignSends,
          flowSends: summary.flowSends,
          error: summary.error,
        } satisfies AttributionRollupRow,
        pieces: groupAttributionByContent(
          summary.rows.map((piece) => ({
            ...piece,
            clientId: target.clientId,
            clientName: target.clientName,
          }))
        ),
      };
    } catch (err) {
      return {
        row: {
          clientId: target.clientId,
          clientName: target.clientName,
          locationId: target.locationId,
          ...EMPTY_COUNTS,
          totalAppointments: null,
          totalFormFills: null,
          campaignSends: 0,
          flowSends: 0,
          error: err instanceof Error ? err.message : "Scan failed.",
        } satisfies AttributionRollupRow,
        pieces: [] as ContentGroup[],
      };
    }
  });

  const present = scanned.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  const rows = present.map((item) => item.row);
  const pieces = present
    .flatMap((item) => item.pieces)
    .sort(
      (a, b) =>
        b.appointments - a.appointments ||
        b.formFills - a.formFills ||
        a.content.localeCompare(b.content) ||
        a.clientName.localeCompare(b.clientName)
    );

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
      confirmedAppointments: rows.reduce(
        (n, r) => n + r.confirmedAppointments,
        0
      ),
      confirmedFormFills: rows.reduce((n, r) => n + r.confirmedFormFills, 0),
      inferredAppointments: rows.reduce(
        (n, r) => n + r.inferredAppointments,
        0
      ),
      inferredFormFills: rows.reduce((n, r) => n + r.inferredFormFills, 0),
      emailAppointments: rows.reduce((n, r) => n + r.emailAppointments, 0),
      emailFormFills: rows.reduce((n, r) => n + r.emailFormFills, 0),
      smsAppointments: rows.reduce((n, r) => n + r.smsAppointments, 0),
      smsFormFills: rows.reduce((n, r) => n + r.smsFormFills, 0),
    },
    pieces,
    wins,
    others,
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
