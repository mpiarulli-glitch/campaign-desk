/**
 * Housecall Pro Public API — jobs / appointments for home-service clients
 * who are not on GoHighLevel.
 *
 * Auth: API key from My Apps → API Key Management (MAX / XL plan).
 * Docs: https://docs.housecallpro.com/
 */

import {
  getIntegrationSecret,
  setIntegrationSecret,
  upsertClientIntegration,
} from "./client-integrations";

const HCP_BASE = "https://api.housecallpro.com";
const REQUEST_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export class HousecallError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "HousecallError";
  }
}

export type HousecallCompany = {
  id: string;
  name: string;
};

export type HousecallJobSummary = {
  jobs: number;
  scheduled: number;
  completed: number;
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

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Token ${apiKey}`,
  };
}

async function hcpRequest<T>(
  apiKey: string,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  const url = new URL(`${HCP_BASE}${path}`);
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
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HousecallError("Housecall Pro timed out.");
    }
    throw new HousecallError(
      err instanceof Error ? err.message : "Could not reach Housecall Pro."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new HousecallError(formatHcpError(res.status, text), res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function formatHcpError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    const detail =
      parsed.error ||
      parsed.message ||
      parsed.errors?.map((e) => e.message).filter(Boolean).join(" ");
    if (detail) return `Housecall Pro (${status}): ${detail}`;
  } catch {
    // Fall through.
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  return `Housecall Pro API error (${status})${snippet ? `: ${snippet}` : ""}`;
}

function ymdFromIso(iso: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return match ? match[1] : null;
}

function jobInRange(job: JsonRecord, start: string, end: string): boolean {
  const candidates = [
    str(job.schedule_date),
    str(job.completed_at),
    str(job.created_at),
    str(job.updated_at),
    str(asRecord(job.schedule)?.scheduled_start),
    str(asRecord(job.schedule)?.scheduled_end),
  ];
  for (const raw of candidates) {
    const day = ymdFromIso(raw);
    if (day && day >= start && day <= end) return true;
  }
  return false;
}

function jobStatus(job: JsonRecord): string {
  return str(job.work_status || job.status).toLowerCase();
}

/** Confirm an API key can read company info before we store it. */
export async function verifyHousecallApiKey(
  apiKey: string
): Promise<HousecallCompany> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new HousecallError("Paste a Housecall Pro API key first.");
  if (trimmed.length < 16) {
    throw new HousecallError("That does not look like a Housecall Pro API key.");
  }

  // Prefer /company (single-account key). Fall back to listing jobs if the
  // company endpoint is unavailable on some plans.
  try {
    const company = await hcpRequest<JsonRecord>(trimmed, "/company");
    const id = str(company.id || company.uuid);
    const name = str(company.name || company.company_name) || "Housecall Pro";
    if (id) return { id, name };
  } catch (err) {
    if (!(err instanceof HousecallError) || (err.status !== 404 && err.status !== 405)) {
      // Continue to jobs fallback only for missing endpoint; auth errors bubble.
      if (err instanceof HousecallError && err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
    }
  }

  const jobs = await hcpRequest<JsonRecord>(trimmed, "/jobs", {
    page_size: "1",
  });
  const companyId = str(jobs.company_id) || "housecall";
  return { id: companyId, name: "Housecall Pro" };
}

export async function linkHousecallClient(
  clientId: string,
  apiKey: string
): Promise<HousecallCompany> {
  const company = await verifyHousecallApiKey(apiKey);
  setIntegrationSecret(clientId, "housecall", apiKey.trim());
  upsertClientIntegration({
    clientId,
    provider: "housecall",
    externalId: company.id,
    label: company.name,
    status: "linked",
    verified: true,
    lastError: "",
  });
  return company;
}

/**
 * Count jobs that fall in [start, end] (YYYY-MM-DD).
 * "Scheduled" ≈ appointments booked; "completed" ≈ finished work.
 */
export async function countHousecallJobsInRange(
  clientId: string,
  start: string,
  end: string
): Promise<HousecallJobSummary> {
  const apiKey = getIntegrationSecret(clientId, "housecall");
  if (!apiKey) throw new HousecallError("Housecall Pro is not linked for this account.");

  let page = 1;
  let jobs = 0;
  let scheduled = 0;
  let completed = 0;

  while (page <= MAX_PAGES) {
    const payload = await hcpRequest<JsonRecord>(apiKey, "/jobs", {
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    const list = Array.isArray(payload.jobs)
      ? payload.jobs
      : Array.isArray(payload.data)
        ? payload.data
        : [];

    for (const item of list) {
      const job = asRecord(item);
      if (!job || !jobInRange(job, start, end)) continue;
      jobs += 1;
      const status = jobStatus(job);
      if (
        status.includes("complete") ||
        status.includes("finished") ||
        status === "done"
      ) {
        completed += 1;
      } else {
        scheduled += 1;
      }
    }

    if (list.length < PAGE_SIZE) break;
    const totalPages = Number(payload.total_pages || 0);
    if (totalPages && page >= totalPages) break;
    page += 1;
  }

  return { jobs, scheduled, completed };
}
