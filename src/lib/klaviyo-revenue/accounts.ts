import { nanoid } from "nanoid";
import { getDb, nowIso } from "../db";
import { KlaviyoError, isKlaviyoApiKey, klaviyoKeyHint, normalizeKlaviyoApiKey } from "../klaviyo";
import { decryptSecret, encryptSecret } from "../secrets";
import { AGENCY_TIME_ZONE, type CatalogMetric, type KlaviyoRevenueAccount } from "./types";
import { detectMetrics } from "./detect";
import { errorMessage, fetchAccountProfile, fetchMetrics, liveTransport } from "./api";

const ACCOUNTS_KEY = "klaviyo_revenue_accounts";
const KEYS_KEY = "klaviyo_revenue_api_keys";
const CATALOG_KEY = "klaviyo_revenue_metric_catalog";

type CatalogCache = Record<string, { fetchedAt: string; metrics: CatalogMetric[] }>;

function readSetting(key: string): string {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

function writeSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, nowIso());
}

function loadAccounts(): KlaviyoRevenueAccount[] {
  if (!readSetting(ACCOUNTS_KEY)) return [];
  try {
    const parsed = JSON.parse(readSetting(ACCOUNTS_KEY)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAccount);
  } catch {
    return [];
  }
}

function isAccount(value: unknown): value is KlaviyoRevenueAccount {
  if (!value || typeof value !== "object") return false;
  const row = value as KlaviyoRevenueAccount;
  return typeof row.id === "string" && typeof row.name === "string";
}

function saveAccounts(accounts: KlaviyoRevenueAccount[]): void {
  writeSetting(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function loadKeyMap(): Record<string, string> {
  if (!readSetting(KEYS_KEY)) return {};
  try {
    const parsed = JSON.parse(readSetting(KEYS_KEY)) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveKeyMap(map: Record<string, string>): void {
  writeSetting(KEYS_KEY, JSON.stringify(map));
}

export function listRevenueAccounts(): KlaviyoRevenueAccount[] {
  return loadAccounts().sort((a, b) => a.name.localeCompare(b.name));
}

export function getRevenueAccount(id: string): KlaviyoRevenueAccount | null {
  return loadAccounts().find((account) => account.id === id) ?? null;
}

export function readRevenueApiKey(id: string): string | null {
  const stored = loadKeyMap()[id];
  if (!stored) return null;
  return decryptSecret(stored);
}

export function accountConfigStamp(): string {
  return loadAccounts()
    .map((account) =>
      [
        account.id,
        account.updatedAt,
        account.bookingMetricId,
        account.formMetricId,
        account.conversionMetricId,
        account.smsMetricId,
      ].join(":")
    )
    .join("|");
}

function loadCatalog(): CatalogCache {
  if (!readSetting(CATALOG_KEY)) return {};
  try {
    const parsed = JSON.parse(readSetting(CATALOG_KEY)) as CatalogCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function metricCatalog(accountId: string): { fetchedAt: string | null; metrics: CatalogMetric[] } {
  const row = loadCatalog()[accountId];
  return { fetchedAt: row?.fetchedAt ?? null, metrics: row?.metrics ?? [] };
}

function saveCatalog(accountId: string, metrics: CatalogMetric[]): void {
  const all = loadCatalog();
  all[accountId] = { fetchedAt: nowIso(), metrics };
  writeSetting(CATALOG_KEY, JSON.stringify(all));
}

function applyDetection(
  account: KlaviyoRevenueAccount,
  metrics: CatalogMetric[],
  onlyEmpty: boolean
): KlaviyoRevenueAccount {
  const detected = detectMetrics(metrics);
  const next = { ...account };
  const fill = (
    source: KlaviyoRevenueAccount["bookingDetection"],
    incoming: { id: string; name: string } | null,
    set: (choice: { id: string; name: string } | null) => void
  ) => {
    if (onlyEmpty && source === "manual") return;
    if (incoming) set(incoming);
  };
  fill(next.bookingDetection, detected.booking, (choice) => {
    next.bookingMetricId = choice?.id ?? null;
    next.bookingMetricName = choice?.name ?? null;
    next.bookingDetection = choice ? "auto" : "none";
  });
  fill(next.formDetection, detected.form, (choice) => {
    next.formMetricId = choice?.id ?? null;
    next.formMetricName = choice?.name ?? null;
    next.formDetection = choice ? "auto" : "none";
  });
  const conversion = detected.conversion ?? (detected.booking
    ? { id: detected.booking.id, name: detected.booking.name }
    : null);
  fill(next.conversionDetection, conversion, (choice) => {
    next.conversionMetricId = choice?.id ?? null;
    next.conversionMetricName = choice?.name ?? null;
    next.conversionDetection = choice ? "auto" : "none";
  });
  fill(next.smsDetection, detected.sms, (choice) => {
    next.smsMetricId = choice?.id ?? null;
    next.smsMetricName = choice?.name ?? null;
    next.smsDetection = choice ? "auto" : "none";
  });
  return next;
}

export async function connectRevenueAccount(input: {
  name?: string;
  apiKey: string;
}): Promise<KlaviyoRevenueAccount> {
  const apiKey = normalizeKlaviyoApiKey(input.apiKey);
  if (!isKlaviyoApiKey(apiKey)) {
    throw new KlaviyoError(
      "That does not look like a Klaviyo private API key. It should start with pk_."
    );
  }
  for (const existing of loadAccounts()) {
    if (readRevenueApiKey(existing.id) === apiKey) {
      throw new KlaviyoError(`${existing.name} is already connected with that key.`);
    }
  }

  const transport = liveTransport(apiKey, `connect:${apiKey.slice(-6)}`);
  let profile: { id: string; name: string; timezone: string; currency: string } | null = null;
  try {
    profile = await fetchAccountProfile(transport);
  } catch (err) {
    if (err instanceof KlaviyoError && err.status !== 403) throw err;
  }
  let metrics: CatalogMetric[] = [];
  try {
    metrics = await fetchMetrics(transport);
  } catch (err) {
    throw new KlaviyoError(errorMessage(err), err instanceof KlaviyoError ? err.status : undefined);
  }
  if (!metrics.length && !profile) {
    throw new KlaviyoError("Klaviyo accepted nothing from that key. Check that it is a private key with read access.");
  }

  const now = nowIso();
  const name = (input.name || profile?.name || "Klaviyo account").trim().slice(0, 80);
  let account: KlaviyoRevenueAccount = {
    id: `kr_${nanoid(10)}`,
    name: name || "Klaviyo account",
    klaviyoAccountId: profile?.id || "",
    timezone: profile?.timezone || AGENCY_TIME_ZONE,
    currency: profile?.currency || "USD",
    keyHint: klaviyoKeyHint(apiKey),
    bookingMetricId: null,
    bookingMetricName: null,
    bookingDetection: "none",
    formMetricId: null,
    formMetricName: null,
    formDetection: "none",
    conversionMetricId: null,
    conversionMetricName: null,
    conversionDetection: "none",
    smsMetricId: null,
    smsMetricName: null,
    smsDetection: "none",
    createdAt: now,
    updatedAt: now,
  };
  account = applyDetection(account, metrics, false);
  account.updatedAt = now;

  const accounts = loadAccounts();
  if (account.klaviyoAccountId && accounts.some((row) => row.klaviyoAccountId === account.klaviyoAccountId)) {
    throw new KlaviyoError("That Klaviyo account is already connected.");
  }
  accounts.push(account);
  saveAccounts(accounts);
  const keys = loadKeyMap();
  keys[account.id] = encryptSecret(apiKey);
  saveKeyMap(keys);
  saveCatalog(account.id, metrics);
  return account;
}

export type MetricPatch = {
  name?: string;
  bookingMetricId?: string | null;
  formMetricId?: string | null;
  conversionMetricId?: string | null;
  smsMetricId?: string | null;
};

export function updateRevenueAccount(id: string, patch: MetricPatch): KlaviyoRevenueAccount {
  const accounts = loadAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index < 0) throw new KlaviyoError("That account is not connected.", 404);
  const current = accounts[index];
  const catalog = metricCatalog(id).metrics;
  const nameOf = (metricId: string | null): string | null => {
    if (!metricId) return null;
    return catalog.find((metric) => metric.id === metricId)?.name ?? metricId;
  };
  const next: KlaviyoRevenueAccount = { ...current, updatedAt: nowIso() };
  if (typeof patch.name === "string" && patch.name.trim()) {
    next.name = patch.name.trim().slice(0, 80);
  }
  const apply = (
    value: string | null | undefined,
    setId: (id: string | null) => void,
    setName: (name: string | null) => void,
    setSource: (source: KlaviyoRevenueAccount["bookingDetection"]) => void
  ) => {
    if (value === undefined) return;
    const metricId = value ? value : null;
    setId(metricId);
    setName(nameOf(metricId));
    setSource(metricId ? "manual" : "none");
  };
  apply(
    patch.bookingMetricId,
    (metricId) => {
      next.bookingMetricId = metricId;
    },
    (name) => {
      next.bookingMetricName = name;
    },
    (source) => {
      next.bookingDetection = source;
    }
  );
  apply(
    patch.formMetricId,
    (metricId) => {
      next.formMetricId = metricId;
    },
    (name) => {
      next.formMetricName = name;
    },
    (source) => {
      next.formDetection = source;
    }
  );
  apply(
    patch.conversionMetricId,
    (metricId) => {
      next.conversionMetricId = metricId;
    },
    (name) => {
      next.conversionMetricName = name;
    },
    (source) => {
      next.conversionDetection = source;
    }
  );
  apply(
    patch.smsMetricId,
    (metricId) => {
      next.smsMetricId = metricId;
    },
    (name) => {
      next.smsMetricName = name;
    },
    (source) => {
      next.smsDetection = source;
    }
  );
  accounts[index] = next;
  saveAccounts(accounts);
  return next;
}

export function removeRevenueAccount(id: string): void {
  saveAccounts(loadAccounts().filter((account) => account.id !== id));
  const keys = loadKeyMap();
  delete keys[id];
  saveKeyMap(keys);
  const catalog = loadCatalog();
  delete catalog[id];
  writeSetting(CATALOG_KEY, JSON.stringify(catalog));
}

export async function refreshMetricCatalog(id: string): Promise<CatalogMetric[]> {
  const account = getRevenueAccount(id);
  const apiKey = readRevenueApiKey(id);
  if (!account || !apiKey) throw new KlaviyoError("That account is not connected.", 404);
  const metrics = await fetchMetrics(liveTransport(apiKey, account.id));
  saveCatalog(id, metrics);
  return metrics;
}

/** Test seam: store an account and key without calling Klaviyo. */
export function persistRevenueAccount(account: KlaviyoRevenueAccount, apiKey: string): void {
  const accounts = loadAccounts().filter((row) => row.id !== account.id);
  accounts.push({ ...account, keyHint: klaviyoKeyHint(apiKey) });
  saveAccounts(accounts);
  const keys = loadKeyMap();
  keys[account.id] = encryptSecret(apiKey);
  saveKeyMap(keys);
}
