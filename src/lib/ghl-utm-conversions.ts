/**
 * Live GHL read for email/SMS attribution.
 *
 * Fast path: one custom-field lookup and a contacts search on Converted Date.
 * Latest/First UTMs are read from those contacts, then from GET /contacts for
 * conversions the search did not return. Conversation history is loaded only
 * for events that still have no UTM credit — and only to verify the specific
 * email or SMS on that contact.
 *
 * Trailhead Family Chiropractic is never requested.
 */

import { GhlError, ghlRequest } from "./ghl";
import {
  listBookedAppointmentEvents,
  listFormFillEvents,
  listWorkflowEmailCampaigns,
} from "./ghl-conversion-analytics";
import {
  annotateMarketingEmailOpens,
  listContactThreadMessages,
} from "./ghl-contact-email-touch";
import { listLocationEmailSchedules } from "./ghl-email-analytics";
import { isGhlCampaignNotYetSent } from "./ghl-email-campaign-status";
import {
  DEFAULT_ATTRIBUTION_DAYS,
  type AttributionSend,
  type ConversionEvent,
} from "./email-conversion-attribution";
import { listRevClients } from "./revenue";
import {
  assembleAttribution,
  customFieldEntries,
  inferCreditFromMessages,
  isHipaaBlockedAccount,
  resolveConvertedFieldIds,
  type AttributionRow,
  type CustomFieldDef,
  type InferredCredit,
  type ResolvedConvertedFields,
} from "./utm-conversion-attribution";

const SEARCH_PAGE = 100;
const SEARCH_PAGES = 20;
const CONTACT_CONCURRENCY = 6;
const THREAD_CONCURRENCY = 4;
const FIELD_CACHE_TTL_MS = 30 * 60 * 1000;

export type LocationMessageAttribution = {
  rows: AttributionRow[];
  campaignSends: number;
  flowSends: number;
  totalAppointments: number | null;
  totalFormFills: number | null;
  error: string | null;
  skipped: "hipaa" | null;
};

type FieldCacheEntry = { at: number; ids: ResolvedConvertedFields };

const fieldCache = new Map<string, FieldCacheEntry>();

export function clearUtmConversionCache(): void {
  fieldCache.clear();
}

function emptyResult(
  error: string | null,
  skipped: "hipaa" | null = null
): LocationMessageAttribution {
  return {
    rows: [],
    campaignSends: 0,
    flowSends: 0,
    totalAppointments: null,
    totalFormFills: null,
    error,
    skipped,
  };
}

export function locationIsHipaaBlocked(
  locationId: string,
  clientName?: string | null
): boolean {
  if (isHipaaBlockedAccount(clientName)) return true;
  const loc = locationId.trim();
  if (!loc) return false;
  try {
    return listRevClients(true).some(
      (client) =>
        (client.ghl_location_id || "").trim() === loc &&
        isHipaaBlockedAccount(client.name)
    );
  } catch {
    return false;
  }
}

async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
}

async function loadConvertedFieldIds(
  locationId: string
): Promise<ResolvedConvertedFields> {
  const hit = fieldCache.get(locationId);
  if (hit && Date.now() - hit.at < FIELD_CACHE_TTL_MS) return hit.ids;
  let fields: CustomFieldDef[] = [];
  const readFields = async (model?: string) => {
    const result = await ghlRequest<{
      customFields?: CustomFieldDef[];
      fields?: CustomFieldDef[];
      customField?: CustomFieldDef[];
    }>("GET", `/locations/${locationId}/customFields`, {
      locationId,
      params: model ? { locationId, model } : { locationId },
    });
    return result.customFields || result.fields || result.customField || [];
  };
  try {
    fields = await readFields("contact");
  } catch (err) {
    if (!(err instanceof GhlError) || !err.status || err.status >= 500) {
      throw err;
    }
    try {
      fields = await readFields();
    } catch (retryErr) {
      if (!(retryErr instanceof GhlError) || !retryErr.status || retryErr.status >= 500) {
        throw retryErr;
      }
      fields = [];
    }
  }
  const ids = resolveConvertedFieldIds(fields);
  fieldCache.set(locationId, { at: Date.now(), ids });
  return ids;
}

async function searchContactsByConvertedDate(
  locationId: string,
  dateFieldId: string,
  start: string,
  end: string
): Promise<Array<Record<string, unknown>>> {
  const startIso = `${start}T00:00:00.000Z`;
  const endIso = `${end}T23:59:59.999Z`;
  const field = `customFields.${dateFieldId}`;
  const shapes: unknown[] = [
    [startIso, endIso],
    { gte: startIso, lte: endIso },
  ];
  let shapeIndex = 0;
  let shapeReady = false;
  const rows: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= SEARCH_PAGES; page++) {
    let batch: Array<Record<string, unknown>> = [];
    let accepted = false;
    for (let s = shapeIndex; s < shapes.length; s++) {
      try {
        const res = await ghlRequest<{
          contacts?: Array<Record<string, unknown>>;
        }>("POST", "/contacts/search", {
          locationId,
          body: {
            locationId,
            page,
            pageLimit: SEARCH_PAGE,
            filters: [{ field, operator: "range", value: shapes[s] }],
          },
        });
        batch = res.contacts || [];
        shapeIndex = s;
        shapeReady = true;
        accepted = true;
        break;
      } catch (err) {
        if (
          err instanceof GhlError &&
          err.status &&
          err.status >= 400 &&
          err.status < 500
        ) {
          if (shapeReady) return rows;
          continue;
        }
        throw err;
      }
    }
    if (!accepted) return rows;
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < SEARCH_PAGE) break;
  }
  return rows;
}

async function getContact(
  locationId: string,
  contactId: string
): Promise<Record<string, unknown> | null> {
  try {
    const result = await ghlRequest<
      { contact?: Record<string, unknown> } & Record<string, unknown>
    >("GET", `/contacts/${contactId}`, { locationId });
    const contact = result.contact || result;
    if (!contact || typeof contact !== "object") return null;
    if (!contact.id) contact.id = contactId;
    return contact;
  } catch {
    return null;
  }
}

async function loadSends(locationId: string): Promise<{
  sends: AttributionSend[];
  campaignSends: number;
  flowSends: number;
}> {
  const sends: AttributionSend[] = [];
  const seen = new Set<string>();
  const add = (send: AttributionSend) => {
    if (!send.id || seen.has(send.id)) return;
    seen.add(send.id);
    sends.push(send);
  };
  let campaignSends = 0;
  let flowSends = 0;
  try {
    const schedules = await listLocationEmailSchedules(locationId);
    for (const row of schedules) {
      if (!row.id) continue;
      add({
        id: row.id,
        name: row.name || "Untitled campaign",
        subject: row.subject || null,
        sentOn: row.scheduledAt,
        channel: "campaign",
      });
    }
    campaignSends = schedules.filter(
      (row) => row.id && !isGhlCampaignNotYetSent(row.status || "")
    ).length;
  } catch {
    campaignSends = 0;
  }
  try {
    const flows = await listWorkflowEmailCampaigns(locationId);
    const flowIds = new Set<string>();
    for (const flow of flows) {
      if (flow.id) flowIds.add(flow.id);
      add({
        id: flow.id,
        name: flow.name,
        subject: null,
        sentOn: flow.sentOn,
        channel: "flow",
      });
      if (flow.sourceId) {
        add({
          id: flow.sourceId,
          name: flow.name,
          subject: null,
          sentOn: flow.sentOn,
          channel: "flow",
        });
      }
    }
    flowSends = flowIds.size;
  } catch {
    flowSends = 0;
  }
  return { sends, campaignSends, flowSends };
}

/**
 * Confirmed UTM conversions plus contact-verified inferred email/SMS
 * for one sub-account and inclusive date window.
 */
export async function pullLocationMessageAttribution(options: {
  locationId: string;
  clientName?: string | null;
  start: string;
  end: string;
  attributionDays?: number;
  discoveryOnly?: boolean;
}): Promise<LocationMessageAttribution> {
  const locationId = options.locationId.trim();
  if (!locationId) return emptyResult("Missing GoHighLevel location.");
  if (locationIsHipaaBlocked(locationId, options.clientName)) {
    return emptyResult(null, "hipaa");
  }

  const attributionDays = options.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS;
  const errors: string[] = [];
  let totalAppointments: number | null = null;
  let totalFormFills: number | null = null;

  let fieldIds: ResolvedConvertedFields = {
    campaignId: null,
    contentId: null,
    sourceId: null,
    dateId: null,
  };
  let formEvents: ConversionEvent[] = [];
  let appointmentEvents: ConversionEvent[] = [];

  const [fieldsResult, formsResult, apptsResult] = await Promise.allSettled([
    loadConvertedFieldIds(locationId),
    listFormFillEvents(locationId, options.start, options.end),
    listBookedAppointmentEvents(locationId, options.start, options.end, {
      discoveryOnly: options.discoveryOnly,
    }),
  ]);

  if (fieldsResult.status === "fulfilled") fieldIds = fieldsResult.value;
  else {
    errors.push(
      fieldsResult.reason instanceof Error
        ? fieldsResult.reason.message
        : "Could not load custom fields."
    );
  }
  if (formsResult.status === "fulfilled") {
    formEvents = formsResult.value;
    totalFormFills = formEvents.length;
  } else {
    errors.push(
      formsResult.reason instanceof Error
        ? formsResult.reason.message
        : "Could not load form fills."
    );
  }
  if (apptsResult.status === "fulfilled") {
    appointmentEvents = apptsResult.value.map((event) => ({
      id: event.id,
      contactId: event.contactId,
      at: event.at,
      kind: "appointment" as const,
    }));
    totalAppointments = appointmentEvents.length;
  } else {
    errors.push(
      apptsResult.reason instanceof Error
        ? apptsResult.reason.message
        : "Could not load appointments."
    );
  }

  const events: ConversionEvent[] = [...formEvents, ...appointmentEvents];
  const contacts = new Map<string, Record<string, unknown>>();

  if (fieldIds.dateId) {
    try {
      const found = await searchContactsByConvertedDate(
        locationId,
        fieldIds.dateId,
        options.start,
        options.end
      );
      for (const contact of found) {
        const id = String(contact.id || "").trim();
        if (id) contacts.set(id, contact);
      }
    } catch (err) {
      if (!(err instanceof GhlError) || !err.status || err.status >= 500) {
        errors.push(
          err instanceof Error ? err.message : "Converted Date search failed."
        );
      }
    }
  }

  // Search hits are sometimes a short contact. Re-read those before deciding
  // the event has no UTM credit, or a slim row would skip Converted fields.
  const missingIds = [
    ...new Set(
      events
        .map((event) => event.contactId || "")
        .filter((id) => {
          if (!id) return false;
          const existing = contacts.get(id);
          if (!existing) return true;
          if (customFieldEntries(existing).length > 0) return false;
          if (
            existing.lastAttributionSource ||
            existing.last_attribution_source ||
            existing.attributionSource ||
            existing.attribution_source
          ) {
            return false;
          }
          return true;
        })
    ),
  ];
  await pooled(missingIds, CONTACT_CONCURRENCY, async (contactId) => {
    const contact = await getContact(locationId, contactId);
    if (contact) contacts.set(contactId, contact);
  });

  const preview = assembleAttribution({
    contacts: [...contacts.values()],
    fieldIds,
    events,
    start: options.start,
    end: options.end,
  });
  const confirmedIds = new Set(preview.map((row) => row.id));
  const needsThread = events.filter(
    (event) => event.contactId && !confirmedIds.has(event.id)
  );

  let campaignSends = 0;
  let flowSends = 0;
  let sends: AttributionSend[] = [];
  if (needsThread.length > 0) {
    const loaded = await loadSends(locationId);
    sends = loaded.sends;
    campaignSends = loaded.campaignSends;
    flowSends = loaded.flowSends;
  }

  const formDayByContact = new Map<string, string>();
  for (const event of formEvents) {
    if (!event.contactId) continue;
    const day = event.at.slice(0, 10);
    const prev = formDayByContact.get(event.contactId);
    if (!prev || day > prev) formDayByContact.set(event.contactId, day);
  }

  const inferredByEventId: Record<string, InferredCredit | null> = {};
  const threadByContact = new Map<string, Promise<Array<Record<string, unknown>>>>();
  const needsOpen = needsThread.some((event) => event.kind === "form_fill");

  function threadFor(contactId: string): Promise<Array<Record<string, unknown>>> {
    let pending = threadByContact.get(contactId);
    if (!pending) {
      pending = (async () => {
        const messages = await listContactThreadMessages(locationId, contactId);
        if (!needsOpen) return messages;
        return annotateMarketingEmailOpens(locationId, messages);
      })();
      threadByContact.set(contactId, pending);
    }
    return pending;
  }

  await pooled(needsThread, THREAD_CONCURRENCY, async (event) => {
    const contactId = event.contactId as string;
    let messages: Array<Record<string, unknown>> = [];
    try {
      messages = await threadFor(contactId);
    } catch {
      messages = [];
    }
    inferredByEventId[event.id] = inferCreditFromMessages({
      messages,
      contactId,
      eventAt: event.at,
      kind: event.kind,
      sends,
      attributionDays,
      formFilledAt:
        event.kind === "appointment"
          ? formDayByContact.get(contactId) || null
          : null,
    });
  });

  const rows = assembleAttribution({
    contacts: [...contacts.values()],
    fieldIds,
    events,
    inferredByEventId,
    start: options.start,
    end: options.end,
  });

  return {
    rows,
    campaignSends,
    flowSends,
    totalAppointments,
    totalFormFills,
    error: errors.length ? errors.join("; ") : null,
    skipped: null,
  };
}
