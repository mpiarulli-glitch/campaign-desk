/**
 * HubSpot private-app API — forms + deals for clients who use HubSpot as CRM
 * instead of (or alongside) GoHighLevel.
 *
 * Auth: Private app access token (Bearer).
 * Docs: https://developers.hubspot.com/
 */

import {
  getIntegrationSecret,
  setIntegrationSecret,
  upsertClientIntegration,
} from "./client-integrations";

const HUBSPOT_BASE = "https://api.hubapi.com";
const REQUEST_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;
const MAX_FORMS = 40;
const MAX_SUBMISSION_PAGES = 10;
const MAX_DEAL_PAGES = 20;

export class HubSpotError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "HubSpotError";
  }
}

export type HubSpotAccount = {
  id: string;
  name: string;
};

export type HubSpotConversionSummary = {
  formFills: number;
  dealsCreated: number;
  formsScanned: number;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function hubspotRequest<T>(
  token: string,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  const url = new URL(`${HUBSPOT_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: authHeaders(token),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HubSpotError("HubSpot timed out.");
    }
    throw new HubSpotError(
      err instanceof Error ? err.message : "Could not reach HubSpot."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new HubSpotError(formatHubSpotError(res.status, text), res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function hubspotPost<T>(
  token: string,
  path: string,
  body: unknown
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${HUBSPOT_BASE}${path}`, {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HubSpotError("HubSpot timed out.");
    }
    throw new HubSpotError(
      err instanceof Error ? err.message : "Could not reach HubSpot."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new HubSpotError(formatHubSpotError(res.status, text), res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function formatHubSpotError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      error?: string;
      errors?: Array<{ message?: string }>;
    };
    const detail =
      parsed.message ||
      parsed.error ||
      parsed.errors?.map((e) => e.message).filter(Boolean).join(" ");
    if (detail) return `HubSpot (${status}): ${detail}`;
  } catch {
    // Fall through.
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  return `HubSpot API error (${status})${snippet ? `: ${snippet}` : ""}`;
}

function ymdFromMs(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function ymdFromIso(iso: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return match ? match[1] : null;
}

function dayInRange(day: string | null, start: string, end: string): boolean {
  return Boolean(day && day >= start && day <= end);
}

/** Confirm a private app token can read account + CRM before we store it. */
export async function verifyHubSpotToken(token: string): Promise<HubSpotAccount> {
  const trimmed = token.trim();
  if (!trimmed) throw new HubSpotError("Paste a HubSpot private app token first.");
  if (trimmed.length < 20) {
    throw new HubSpotError("That does not look like a HubSpot private app token.");
  }

  try {
    const info = await hubspotRequest<JsonRecord>(
      trimmed,
      "/account-info/v3/details"
    );
    const id = String(info.portalId ?? info.hubId ?? "").trim();
    const name =
      str(info.accountType) ||
      (id ? `HubSpot portal ${id}` : "HubSpot");
    if (id) return { id, name };
  } catch (err) {
    if (err instanceof HubSpotError && err.status && err.status >= 400 && err.status < 500) {
      // Fall through to contacts probe for scope-limited tokens.
      if (err.status === 401 || err.status === 403) throw err;
    } else if (!(err instanceof HubSpotError)) {
      throw err;
    }
  }

  await hubspotRequest(trimmed, "/crm/v3/objects/contacts", { limit: "1" });
  return { id: "hubspot", name: "HubSpot" };
}

export async function linkHubSpotClient(
  clientId: string,
  token: string
): Promise<HubSpotAccount> {
  const account = await verifyHubSpotToken(token);
  setIntegrationSecret(clientId, "hubspot", token.trim());
  upsertClientIntegration({
    clientId,
    provider: "hubspot",
    externalId: account.id,
    label: account.name,
    status: "linked",
    verified: true,
    lastError: "",
  });
  return account;
}

async function listFormIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let after = "";
  while (ids.length < MAX_FORMS) {
    const query: Record<string, string> = { limit: "50" };
    if (after) query.after = after;
    const payload = await hubspotRequest<JsonRecord>(
      token,
      "/marketing/v3/forms",
      query
    );
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const item of results) {
      const row = asRecord(item);
      const id = str(row?.id);
      if (id) ids.push(id);
      if (ids.length >= MAX_FORMS) break;
    }
    const paging = asRecord(payload.paging);
    const nextPage = paging ? asRecord(paging.next) : null;
    after = str(nextPage?.after);
    if (!after || results.length === 0) break;
  }
  return ids;
}

async function countSubmissionsForForm(
  token: string,
  formId: string,
  start: string,
  end: string
): Promise<number> {
  let count = 0;
  let after = "";
  for (let page = 0; page < MAX_SUBMISSION_PAGES; page += 1) {
    const query: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (after) query.after = after;
    const payload = await hubspotRequest<JsonRecord>(
      token,
      `/form-integrations/v1/submissions/forms/${encodeURIComponent(formId)}`,
      query
    );
    const results = Array.isArray(payload.results) ? payload.results : [];
    let sawOlder = false;
    for (const item of results) {
      const row = asRecord(item);
      if (!row) continue;
      const submitted =
        typeof row.submittedAt === "number"
          ? ymdFromMs(row.submittedAt)
          : ymdFromIso(str(row.submittedAt));
      if (dayInRange(submitted, start, end)) count += 1;
      if (submitted && submitted < start) sawOlder = true;
    }
    const paging = asRecord(payload.paging);
    const nextPage = paging ? asRecord(paging.next) : null;
    after = str(nextPage?.after);
    if (!after || results.length === 0 || sawOlder) break;
  }
  return count;
}

async function countDealsCreated(
  token: string,
  start: string,
  end: string
): Promise<number> {
  // HubSpot search uses millisecond timestamps for createdate.
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T23:59:59.999Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;

  let count = 0;
  let after = "";
  for (let page = 0; page < MAX_DEAL_PAGES; page += 1) {
    const body: JsonRecord = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "createdate",
              operator: "BETWEEN",
              value: String(startMs),
              highValue: String(endMs),
            },
          ],
        },
      ],
      properties: ["dealname", "createdate", "dealstage"],
      limit: PAGE_SIZE,
    };
    if (after) body.after = after;

    const payload = await hubspotPost<JsonRecord>(
      token,
      "/crm/v3/objects/deals/search",
      body
    );
    const results = Array.isArray(payload.results) ? payload.results : [];
    count += results.length;
    if (typeof payload.total === "number" && page === 0 && payload.total >= 0) {
      // Prefer the search total when present (avoids paging the whole set).
      return payload.total;
    }
    const paging = asRecord(payload.paging);
    const nextPage = paging ? asRecord(paging.next) : null;
    after = str(nextPage?.after);
    if (!after || results.length < PAGE_SIZE) break;
  }
  return count;
}

/**
 * Form fills in the window + deals created (booking / opportunity proxy).
 */
export async function countHubSpotConversionsInRange(
  clientId: string,
  start: string,
  end: string
): Promise<HubSpotConversionSummary> {
  const token = getIntegrationSecret(clientId, "hubspot");
  if (!token) throw new HubSpotError("HubSpot is not linked for this account.");

  let formFills = 0;
  let formsScanned = 0;
  let formError: string | null = null;
  try {
    const formIds = await listFormIds(token);
    formsScanned = formIds.length;
    for (const formId of formIds) {
      formFills += await countSubmissionsForForm(token, formId, start, end);
    }
  } catch (err) {
    formError = err instanceof Error ? err.message : "Could not read HubSpot forms.";
  }

  let dealsCreated = 0;
  let dealError: string | null = null;
  try {
    dealsCreated = await countDealsCreated(token, start, end);
  } catch (err) {
    dealError = err instanceof Error ? err.message : "Could not read HubSpot deals.";
  }

  if (formError && dealError) {
    throw new HubSpotError(`${formError} ${dealError}`.trim());
  }

  return { formFills, dealsCreated, formsScanned };
}
