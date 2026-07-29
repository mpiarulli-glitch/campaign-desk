/**
 * GoHighLevel (LeadConnector) client.
 *
 * This is a port of the shared client in `code/ghl-mcp/src/ghl-client.ts`,
 * whose own header says it is "used by both the MCP server and the dashboard
 * app". Same OAuth application, same endpoints, same refresh semantics.
 *
 * One deliberate difference: that module caches tokens in `.tokens.json` on
 * disk. Campaign Desk runs on Railway where the app filesystem is ephemeral
 * outside the mounted volume, so a file cache would be wiped on every deploy
 * and the rotated refresh token lost. Tokens are kept in `app_settings`
 * instead, which lives in the SQLite volume.
 *
 * The behaviours worth keeping from the original, and why:
 *   - Expiry is read from the JWT's own `exp` claim, not from `expires_in`.
 *   - Refreshing ROTATES the refresh token; the old one dies immediately.
 *   - `invalid_grant` means a sibling process already rotated it. Re-read the
 *     store and use its token rather than failing.
 *   - Location requests retry once on 401 with a fresh location token.
 */

import { getDb, nowIso } from "./db";

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = process.env.GHL_API_VERSION || "2021-07-28";

const TOKEN_KEY = "ghl_tokens";
const REQUEST_TIMEOUT_MS = 25_000;
const WORKFLOW_CACHE_TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GhlError";
  }
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function config() {
  return {
    companyId: process.env.GHL_COMPANY_ID || "",
    clientId: process.env.GHL_CLIENT_ID || "",
    clientSecret: process.env.GHL_CLIENT_SECRET || "",
    redirectUri: process.env.GHL_REDIRECT_URI || "",
    seedAccessToken: process.env.GHL_AGENCY_ACCESS_TOKEN || "",
    seedRefreshToken: process.env.GHL_REFRESH_TOKEN || "",
  };
}

export function ghlCompanyId(): string {
  return config().companyId;
}

export function isGhlConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.companyId && (loadTokens() || c.seedRefreshToken));
}

/* ------------------------------------------------------------ token store */

function loadTokens(): TokenData | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(TOKEN_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const d = JSON.parse(row.value) as TokenData;
    return d.refresh_token ? d : null;
  } catch {
    return null;
  }
}

function saveTokens(token: TokenData): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(TOKEN_KEY, JSON.stringify(token), nowIso());
}

/** Read `exp` out of the JWT. More reliable than trusting `expires_in`. */
function jwtExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return 0;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return (payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function isExpired(token: TokenData): boolean {
  if (!token.expires_at) return true;
  return Date.now() >= token.expires_at - 60_000;
}

/* ----------------------------------------------------------- agency token */

let agencyToken: TokenData | null = null;
let refreshInFlight: Promise<TokenData> | null = null;

function seedFromEnv(): TokenData | null {
  // The store always wins: it holds the most recently rotated refresh token.
  // Falling back to the env-baked one after rotation causes invalid_grant.
  const stored = loadTokens();
  if (stored) return stored;

  const c = config();
  if (!c.seedAccessToken && !c.seedRefreshToken) return null;
  return {
    access_token: c.seedAccessToken,
    refresh_token: c.seedRefreshToken,
    expires_at: jwtExpiry(c.seedAccessToken),
  };
}

async function doRefresh(): Promise<TokenData> {
  const c = config();
  const current = agencyToken ?? seedFromEnv();
  if (!current?.refresh_token) throw new GhlError("No GoHighLevel refresh token available");

  const params = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    user_type: "Company",
  });
  if (c.redirectUri) params.set("redirect_uri", c.redirectUri);

  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");

    // Another process (the MCP server, or a second app instance) already
    // rotated this exact token. Pick up its result instead of failing.
    if (detail.includes("invalid_grant")) {
      const stored = loadTokens();
      if (stored && stored.refresh_token !== current.refresh_token && !isExpired(stored)) {
        agencyToken = stored;
        return stored;
      }
    }

    throw new GhlError(
      `GoHighLevel refused the refresh token (${res.status}). Re-authorise the app.${
        detail ? ` ${detail.slice(0, 140)}` : ""
      }`,
      res.status
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };

  const next: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: jwtExpiry(data.access_token) || Date.now() + (data.expires_in || 86_400) * 1000,
  };

  // Persist before the token is used for anything else. If the process dies
  // now, the stored value is the one GHL considers valid.
  saveTokens(next);
  agencyToken = next;
  return next;
}

export async function getAgencyToken(): Promise<string> {
  if (!agencyToken) agencyToken = seedFromEnv();
  if (!agencyToken) throw new GhlError("GoHighLevel is not configured");

  if (isExpired(agencyToken)) {
    const stored = loadTokens();
    if (stored && !isExpired(stored)) {
      agencyToken = stored;
    } else {
      // Share one refresh across callers so the rotating token can't race.
      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null;
        });
      }
      agencyToken = await refreshInFlight;
    }
  }

  return agencyToken.access_token;
}

/* --------------------------------------------------------- location token */

const locationTokens = new Map<string, { access_token: string; expires_at: number }>();

export async function getLocationToken(locationId: string): Promise<string> {
  const hit = locationTokens.get(locationId);
  if (hit && hit.expires_at > Date.now()) return hit.access_token;

  const agency = await getAgencyToken();
  const res = await fetch(`${BASE}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agency}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: API_VERSION,
    },
    body: JSON.stringify({ companyId: ghlCompanyId(), locationId }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GhlError(
      `No location token for ${locationId} (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
      res.status
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const entry = {
    access_token: data.access_token,
    expires_at: jwtExpiry(data.access_token) || Date.now() + (data.expires_in || 86_400) * 1000,
  };
  locationTokens.set(locationId, entry);
  return entry.access_token;
}

/* ---------------------------------------------------------------- request */

interface RequestOptions {
  locationId?: string;
  params?: Record<string, string | number | boolean>;
  agencyLevel?: boolean;
}

export async function ghlRequest<T = unknown>(
  method: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { locationId, params, agencyLevel = false } = options;

  let token: string;
  if (agencyLevel) token = await getAgencyToken();
  else if (locationId) token = await getLocationToken(locationId);
  else throw new GhlError("Either locationId or agencyLevel must be provided");

  let url = `${BASE}${endpoint}`;
  if (params) {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    if (query) url += `?${query}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Version: API_VERSION,
  };
  if (locationId && !agencyLevel) headers["location_id"] = locationId;

  const send = async (h: Record<string, string>): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { method, headers: h, signal: controller.signal, cache: "no-store" });
    } catch (err) {
      const why = err instanceof Error && err.name === "AbortError" ? "timed out" : "network error";
      throw new GhlError(`GoHighLevel request ${why}`);
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send(headers);

  // A stale location token gets one retry with a freshly minted one.
  if (res.status === 401 && !agencyLevel && locationId) {
    locationTokens.delete(locationId);
    headers.Authorization = `Bearer ${await getLocationToken(locationId)}`;
    res = await send(headers);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GhlError(
      `GoHighLevel API error (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      res.status
    );
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/* ------------------------------------------------------------- endpoints */

export interface GhlLocation {
  id: string;
  name: string;
}

export async function listLocations(): Promise<GhlLocation[]> {
  const data = await ghlRequest<{ locations?: Array<{ id: string; name: string }> }>(
    "GET",
    "/locations/search",
    { agencyLevel: true, params: { companyId: ghlCompanyId(), limit: 500 } }
  );
  return (data.locations ?? []).map((l) => ({ id: l.id, name: l.name }));
}

export interface GhlWorkflow {
  id: string;
  name: string;
  /** "published" is the only status that actually fires. */
  status: string;
  locationId: string;
  updatedAt: string;
  createdAt: string;
}

export async function listWorkflows(locationId: string): Promise<GhlWorkflow[]> {
  const data = await ghlRequest<{ workflows?: unknown[] }>("GET", "/workflows/", {
    locationId,
    params: { locationId },
  });

  return (data.workflows ?? []).map((raw) => {
    const w = raw as Record<string, unknown>;
    return {
      id: String(w.id ?? ""),
      name: String(w.name ?? "Untitled workflow"),
      status: String(w.status ?? "unknown"),
      locationId: String(w.locationId ?? locationId),
      updatedAt: String(w.updatedAt ?? ""),
      createdAt: String(w.createdAt ?? ""),
    };
  });
}

/* ------------------------------------------------------------------ sweep */

export interface GhlWorkflowSweep {
  fetchedAt: string;
  locations: Array<{
    locationId: string;
    clientId: string;
    clientName: string;
    workflows: GhlWorkflow[];
    error?: string;
  }>;
}

let sweepCache: { at: number; key: string; data: GhlWorkflowSweep } | null = null;

async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Pull workflows for the given client locations.
 *
 * Only locations mapped to a client are swept. The agency has 150+ locations
 * and most are not accounts we run lifecycle for, so sweeping all of them
 * would be slow and mostly noise.
 *
 * A location that fails is recorded against that location rather than failing
 * the sweep: one un-authorised subaccount must not blank the whole panel.
 */
export async function sweepWorkflows(
  targets: Array<{ locationId: string; clientId: string; clientName: string }>,
  force = false
): Promise<GhlWorkflowSweep> {
  const key = targets.map((t) => t.locationId).sort().join(",");
  if (
    !force &&
    sweepCache &&
    sweepCache.key === key &&
    Date.now() - sweepCache.at < WORKFLOW_CACHE_TTL_MS
  ) {
    return sweepCache.data;
  }

  const locations = await pooled(targets, async (t) => {
    try {
      return { ...t, workflows: await listWorkflows(t.locationId) };
    } catch (err) {
      return {
        ...t,
        workflows: [] as GhlWorkflow[],
        error: err instanceof Error ? err.message : "Failed to load workflows",
      };
    }
  });

  const data: GhlWorkflowSweep = { fetchedAt: new Date().toISOString(), locations };
  sweepCache = { at: Date.now(), key, data };
  return data;
}

export function clearGhlCache(): void {
  sweepCache = null;
  agencyToken = null;
  locationTokens.clear();
}
