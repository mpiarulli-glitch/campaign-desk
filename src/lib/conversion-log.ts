/**
 * Cross-account conversion log — flat rows for every email-attributed
 * form fill / booking across GHL-linked Lifecycle accounts.
 */

import {
  type AnalyticsPreset,
  type EmailJourneyKind,
  pullClientEmailJourneys,
  resolveAnalyticsRange,
} from "./ghl-email-analytics";
import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";
import { buildLifecycleHub } from "./lifecycle-hub";
import { getRevClient } from "./revenue";

const LOG_CONCURRENCY = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ConversionLogRow = {
  id: string;
  clientId: string;
  clientName: string;
  kind: EmailJourneyKind;
  conversionAt: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  formFilledAt: string | null;
  sendId: string;
  sendName: string;
  sendChannel: "campaign" | "flow";
  sendOn: string;
  subject: string | null;
  emailTouchDay: string | null;
};

export type ConversionLog = {
  start: string;
  end: string;
  range: AnalyticsPreset;
  attributionDays: number;
  kind: "all" | EmailJourneyKind;
  fetchedAt: string;
  scanned: number;
  totals: {
    appointments: number;
    formFills: number;
  };
  rows: ConversionLogRow[];
  errors: Array<{ clientId: string; clientName: string; error: string }>;
  cached: boolean;
};

type CacheEntry = { at: number; payload: ConversionLog };

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

/** Newest conversions first; stable ties by account then contact. */
export function sortConversionLogRows(
  a: ConversionLogRow,
  b: ConversionLogRow
): number {
  return (
    b.conversionAt.localeCompare(a.conversionAt) ||
    a.clientName.localeCompare(b.clientName) ||
    (a.contactName || "").localeCompare(b.contactName || "") ||
    a.id.localeCompare(b.id)
  );
}

export function filterConversionLogRows(
  rows: ConversionLogRow[],
  kind: "all" | EmailJourneyKind
): ConversionLogRow[] {
  if (kind === "all") return rows;
  return rows.filter((row) => row.kind === kind);
}

export function clearConversionLogCache(): void {
  cache.clear();
}

/**
 * Scan every GHL-linked Lifecycle hub client and collect email-attributed
 * conversion rows (same honesty gate as Email → booked / Email → forms).
 */
export async function pullConversionLog(options: {
  range?: AnalyticsPreset;
  from?: string | null;
  to?: string | null;
  attributionDays?: number;
  kind?: "all" | EmailJourneyKind;
  refresh?: boolean;
}): Promise<ConversionLog> {
  const range = options.range || "3m";
  const kind = options.kind || "all";
  const attributionDays = options.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS;
  const { start, end } = resolveAnalyticsRange(range, options.from, options.to);
  const cacheKey = `${range}:${start}:${end}:${attributionDays}:${kind}`;

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

  const kinds: EmailJourneyKind[] =
    kind === "all" ? ["appointment", "form_fill"] : [kind];

  const errors: ConversionLog["errors"] = [];
  const collected = await pooledMap(targets, LOG_CONCURRENCY, async (target) => {
    const rows: ConversionLogRow[] = [];
    try {
      for (const journeyKind of kinds) {
        const result = await pullClientEmailJourneys(
          target.locationId,
          start,
          end,
          journeyKind,
          attributionDays
        );
        for (const journey of result.journeys) {
          rows.push({
            id: [
              target.clientId,
              journey.kind,
              journey.contactId || "unknown",
              journey.conversionAt,
              journey.sendId,
            ].join(":"),
            clientId: target.clientId,
            clientName: target.clientName,
            kind: journey.kind,
            conversionAt: journey.conversionAt,
            contactId: journey.contactId,
            contactName: journey.contactName,
            contactEmail: journey.contactEmail,
            formFilledAt: journey.formFilledAt,
            sendId: journey.sendId,
            sendName: journey.sendName,
            sendChannel: journey.sendChannel,
            sendOn: journey.sendOn,
            subject: journey.subject,
            emailTouchDay: journey.emailTouchDay,
          });
        }
      }
    } catch (err) {
      errors.push({
        clientId: target.clientId,
        clientName: target.clientName,
        error: err instanceof Error ? err.message : "Scan failed.",
      });
    }
    return rows;
  });

  const rows = filterConversionLogRows(collected.flat(), kind).sort(
    sortConversionLogRows
  );

  const payload: ConversionLog = {
    start,
    end,
    range,
    attributionDays,
    kind,
    fetchedAt: new Date().toISOString(),
    scanned: targets.length,
    totals: {
      appointments: rows.filter((r) => r.kind === "appointment").length,
      formFills: rows.filter((r) => r.kind === "form_fill").length,
    },
    rows,
    errors: errors.sort((a, b) => a.clientName.localeCompare(b.clientName)),
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
