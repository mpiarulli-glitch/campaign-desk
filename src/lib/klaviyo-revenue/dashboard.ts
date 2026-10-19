import { getDb } from "../db";
import { liveTransport } from "./api";
import { combineAccounts, emptySnapshot } from "./aggregate";
import {
  accountConfigStamp,
  listRevenueAccounts,
  readRevenueApiKey,
} from "./accounts";
import { buildFixtureDashboard } from "./fixtures";
import { pullAccount } from "./pull";
import {
  AGENCY_TIME_ZONE,
  BOOKING_METHOD,
  CACHE_TTL_MS,
  EMAIL_METHOD_AGGREGATE,
  EMAIL_METHOD_VALUES,
  FORM_METHOD,
  SMS_RECOVERY_METHOD,
  type AccountSnapshot,
  type DashboardPayload,
  type Preset,
} from "./types";
import { resolveWindow, todayInTimeZone, type ResolvedWindow } from "./window";

function ensureCache(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS klaviyo_revenue_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}

export function clearRevenueCache(): void {
  ensureCache();
  getDb().prepare(`DELETE FROM klaviyo_revenue_cache`).run();
}

function readCache(key: string): DashboardPayload | null {
  ensureCache();
  const row = getDb()
    .prepare(`SELECT payload, fetched_at FROM klaviyo_revenue_cache WHERE cache_key = ?`)
    .get(key) as { payload: string; fetched_at: string } | undefined;
  if (!row) return null;
  const age = Date.now() - Date.parse(row.fetched_at);
  if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(row.payload) as DashboardPayload;
  } catch {
    return null;
  }
}

function readCacheEvenStale(key: string): DashboardPayload | null {
  ensureCache();
  const row = getDb()
    .prepare(`SELECT payload FROM klaviyo_revenue_cache WHERE cache_key = ?`)
    .get(key) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as DashboardPayload;
  } catch {
    return null;
  }
}

function writeCache(key: string, payload: DashboardPayload): void {
  ensureCache();
  getDb()
    .prepare(
      `INSERT INTO klaviyo_revenue_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
    )
    .run(key, JSON.stringify(payload), payload.fetchedAt);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function emailCopy(accounts: AccountSnapshot[]): string {
  const methods = new Set(accounts.map((account) => account.email.method));
  const aggregate = methods.has("metric-aggregate");
  const values = methods.has("values-report");
  if (aggregate && values) return `${EMAIL_METHOD_AGGREGATE} ${EMAIL_METHOD_VALUES}`;
  if (values) return EMAIL_METHOD_VALUES;
  return EMAIL_METHOD_AGGREGATE;
}

function notesFor(accounts: AccountSnapshot[], demo: boolean): string[] {
  const notes: string[] = [];
  if (demo) {
    notes.push(
      "Sample accounts, so you can see the shape before a key is connected. 12volt and Hendos have no booked-appointment metric."
    );
  }
  for (const account of accounts) {
    if (account.error) notes.push(`${account.name}: ${account.error}`);
    for (const warning of account.warnings) notes.push(`${account.name}: ${warning}`);
    if (account.sms.truncated) {
      notes.push(
        `${account.name}: the text-recovery count is partial. Klaviyo returned more events than this refresh kept (3,000 per metric).`
      );
    }
    if (account.sms.tailRecoveries > 0) {
      notes.push(
        `${account.name}: ${account.sms.tailRecoveries} recovered booking${account.sms.tailRecoveries === 1 ? "" : "s"} landed after this window and still count in the total.`
      );
    }
  }
  const untracked = accounts.filter((account) => account.booking.status === "untracked" && !account.error);
  if (untracked.length && accounts.some((account) => account.booking.status === "value")) {
    notes.push(
      `No booked-appointment metric on ${untracked.map((account) => account.name).join(", ")}. Those accounts are left out of the booking and SMS recovery totals.`
    );
  }
  return notes;
}

function payloadFrom(
  accounts: AccountSnapshot[],
  range: ResolvedWindow,
  opts: { demo: boolean; canManage: boolean; fetchedAt: string; fromCache: boolean; stale: boolean }
): DashboardPayload {
  return {
    demo: opts.demo,
    canManage: opts.canManage,
    fetchedAt: opts.fetchedAt,
    fromCache: opts.fromCache,
    stale: opts.stale,
    window: {
      preset: range.preset,
      start: range.start,
      end: range.end,
      label: range.label,
      timeZone: range.timeZone,
      previousStart: range.previousStart,
      previousEnd: range.previousEnd,
      dayCount: range.dayCount,
    },
    accounts,
    combined: combineAccounts(accounts, range.start, range.end),
    notes: notesFor(accounts, opts.demo),
    method: {
      sms: SMS_RECOVERY_METHOD,
      email: emailCopy(accounts),
      booking: BOOKING_METHOD,
      forms: FORM_METHOD,
    },
  };
}

export async function loadKlaviyoDashboard(input: {
  preset: Preset;
  start?: string;
  end?: string;
  refresh: boolean;
  canManage: boolean;
  now?: Date;
}): Promise<DashboardPayload> {
  const now = input.now ?? new Date();
  const range = resolveWindow({
    preset: input.preset,
    start: input.start,
    end: input.end,
    today: todayInTimeZone(AGENCY_TIME_ZONE, now),
    timeZone: AGENCY_TIME_ZONE,
  });
  const fetchedAt = now.toISOString();
  const accounts = listRevenueAccounts();
  const demo = process.env.KLAVIYO_REVENUE_DEMO === "1" && accounts.length === 0;
  if (demo) return buildFixtureDashboard(range, { canManage: input.canManage, fetchedAt });

  const cacheKey = `v1|${range.start}|${range.end}|${accountConfigStamp()}`;
  if (!input.refresh) {
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, canManage: input.canManage, fromCache: true, stale: false };
  }

  try {
    const snapshots = await mapPool(accounts, 2, async (account) => {
      const apiKey = readRevenueApiKey(account.id);
      if (!apiKey) {
        return emptySnapshot({
          id: account.id,
          name: account.name,
          timezone: account.timezone || AGENCY_TIME_ZONE,
          currency: account.currency || "USD",
          error: "The saved key could not be read. Remove the account and add it again.",
          range,
        });
      }
      return pullAccount(account, range, liveTransport(apiKey, account.id));
    });
    const payload = payloadFrom(snapshots, range, {
      demo: false,
      canManage: input.canManage,
      fetchedAt,
      fromCache: false,
      stale: false,
    });
    writeCache(cacheKey, payload);
    return payload;
  } catch (err) {
    const cached = readCacheEvenStale(cacheKey);
    if (cached) {
      return {
        ...cached,
        canManage: input.canManage,
        fromCache: true,
        stale: true,
        notes: [
          ...cached.notes,
          err instanceof Error ? err.message : "Refresh failed. Showing the last saved result.",
        ],
      };
    }
    throw err;
  }
}
