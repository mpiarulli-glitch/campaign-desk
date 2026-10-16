/**
 * Cross-account conversion log — one row per form fill or booking that an
 * email or SMS drove. UTM-confirmed first. Inferred rows are messages verified
 * on that contact's thread, never an account-level send.
 */

import {
  type AnalyticsPreset,
  type EmailJourneyKind,
  resolveAnalyticsRange,
} from "./ghl-email-analytics";
import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";
import { pullLocationMessageAttribution } from "./ghl-utm-conversions";
import { buildLifecycleHub } from "./lifecycle-hub";
import { getRevClient } from "./revenue";
import {
  isHipaaBlockedAccount,
  type AttributionBasis,
  type AttributionConfidence,
  type MessageSource,
} from "./utm-conversion-attribution";

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
  sendChannel: "campaign" | "flow" | "thread" | "sms" | "utm";
  sendOn: string;
  subject: string | null;
  emailTouchDay: string | null;
  confidence: AttributionConfidence;
  basis: AttributionBasis;
  messageSource: MessageSource;
  campaign: string | null;
  content: string;
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
    confirmed: number;
    inferred: number;
    email: number;
    sms: number;
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
    const client = getRevClient(id);
    if (isHipaaBlockedAccount(client?.name || "")) continue;
    const loc = (client?.ghl_location_id || "").trim();
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
  kind: "all" | EmailJourneyKind,
  extra: {
    confidence?: "all" | AttributionConfidence;
    source?: "all" | MessageSource;
  } = {}
): ConversionLogRow[] {
  return rows.filter((row) => {
    if (kind !== "all" && row.kind !== kind) return false;
    if (
      extra.confidence &&
      extra.confidence !== "all" &&
      row.confidence !== extra.confidence
    ) {
      return false;
    }
    if (extra.source && extra.source !== "all" && row.messageSource !== extra.source) {
      return false;
    }
    return true;
  });
}

export function clearConversionLogCache(): void {
  cache.clear();
}

/**
 * Scan every GHL-linked Lifecycle hub client except Trailhead (HIPAA).
 * Each row names the email or SMS, and whether that credit is UTM-confirmed
 * or inferred from the contact's own thread.
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

  const errors: ConversionLog["errors"] = [];
  const collected = await pooledMap(targets, LOG_CONCURRENCY, async (target) => {
    const rows: ConversionLogRow[] = [];
    try {
      const result = await pullLocationMessageAttribution({
        locationId: target.locationId,
        clientName: target.clientName,
        start,
        end,
        attributionDays,
      });
      if (result.skipped === "hipaa") return rows;
      if (result.error) {
        errors.push({
          clientId: target.clientId,
          clientName: target.clientName,
          error: result.error,
        });
      }
      const formDayByContact = new Map<string, string>();
      for (const credit of result.rows) {
        if (credit.kind !== "form_fill" || !credit.contactId) continue;
        const prev = formDayByContact.get(credit.contactId);
        if (!prev || credit.at > prev) formDayByContact.set(credit.contactId, credit.at);
      }
      for (const credit of result.rows) {
        if (kind !== "all" && credit.kind !== kind) continue;
        const sendChannel: ConversionLogRow["sendChannel"] =
          credit.confidence === "confirmed"
            ? credit.source === "sms"
              ? "sms"
              : "utm"
            : credit.source === "sms"
              ? "sms"
              : credit.sendId
                ? "campaign"
                : "thread";
        const formDay = credit.contactId
          ? formDayByContact.get(credit.contactId) || null
          : null;
        rows.push({
          id: [
            target.clientId,
            credit.kind,
            credit.contactId || "unknown",
            credit.at,
            credit.content,
            credit.basis,
          ].join(":"),
          clientId: target.clientId,
          clientName: target.clientName,
          kind: credit.kind,
          conversionAt: credit.at,
          contactId: credit.contactId,
          contactName: credit.contactName,
          contactEmail: credit.contactEmail,
          formFilledAt:
            credit.kind === "form_fill"
              ? credit.at
              : formDay && formDay <= credit.at
                ? formDay
                : null,
          sendId: credit.sendId || `${credit.basis}:${credit.content}`,
          sendName: credit.content,
          sendChannel,
          sendOn: credit.sendOn || credit.at,
          subject: credit.subject,
          emailTouchDay: credit.confidence === "inferred" ? credit.sendOn : null,
          confidence: credit.confidence,
          basis: credit.basis,
          messageSource: credit.source,
          campaign: credit.campaign,
          content: credit.content,
        });
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
      confirmed: rows.filter((r) => r.confidence === "confirmed").length,
      inferred: rows.filter((r) => r.confidence === "inferred").length,
      email: rows.filter((r) => r.messageSource === "email").length,
      sms: rows.filter((r) => r.messageSource === "sms").length,
    },
    rows,
    errors: errors.sort((a, b) => a.clientName.localeCompare(b.clientName)),
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
