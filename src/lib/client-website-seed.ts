// One-time fill of rev_clients.website from the researched domain list.
//
// A blank website is filled. A website that already has a value is left alone,
// including when several locations share one domain. Matching uses the same
// normalizer as Basecamp link-all (case, punctuation, "&" / "and", apostrophes,
// legal suffixes), plus parenthetical text, which that helper keeps as words.
// A name that matches nobody is logged and skipped. The run is recorded in
// app_settings. Unmatched names are tried again on later boots until they
// match or a few boots have passed. After a pass, logos for the matched
// clients are pulled a few at a time. Clients that already have a file are
// skipped by the logo fetcher.

import {
  CLIENT_WEBSITE_SEED,
  type ClientWebsiteSeedEntry,
} from "../data/client-website-seed";

export type { ClientWebsiteSeedEntry };
import { normalizeClientMatchKey } from "./basecamp-client-match";
import {
  pullClientLogosInBatches,
  publicWebsiteUrl,
  type LogoTransport,
} from "./client-logo-fetch";
import { getDb, nowIso } from "./db";

export const CLIENT_WEBSITE_SEED_KEY = "client_website_seed_v1";
export const CLIENT_WEBSITE_SEED_MAX_ATTEMPTS = 4;

export type ClientWebsiteSeedStatus = "filled" | "already-set" | "no-match";

export type ClientWebsiteSeedClient = {
  id: string;
  name: string;
  website: string;
};

export type ClientWebsiteSeedRow = {
  name: string;
  domain: string;
  status: ClientWebsiteSeedStatus;
  clientId?: string;
  clientName?: string;
  website?: string;
};

export type ClientWebsiteSeedReport = {
  skipped: boolean;
  attempts: number;
  done: boolean;
  pending: string[];
  rows: ClientWebsiteSeedRow[];
  failed?: boolean;
};

export type ClientWebsiteSeedOptions = {
  seeds?: readonly ClientWebsiteSeedEntry[];
  transport?: LogoTransport;
  /** Defaults to true. Tests pass false so a run does not touch the network. */
  pullLogos?: boolean;
  logoGapMs?: number;
};

type SeedState = {
  attempts: number;
  pending: string[];
  done: boolean;
};

/** Bare host, or null when the value is empty or not a public http(s) site. */
export function canonicalSeedDomain(domain: string): string | null {
  const page = publicWebsiteUrl(domain);
  if (!page) return null;
  return page.hostname.replace(/^www\./i, "").toLowerCase();
}

/**
 * Keys for one display name. Parenthetical text is dropped before the
 * Basecamp normalizer so "GenEX (Azteca Cleaning)" can match "GenEX".
 * A leading "the" and the word "one" are extra keys, not replacements.
 */
export function clientWebsiteMatchKeys(name: string): string[] {
  const sources = [name || "", (name || "").replace(/\([^)]*\)/g, " ")];
  const keys = new Set<string>();
  for (const source of sources) {
    const key = normalizeClientMatchKey(source);
    if (!key) continue;
    const noThe = key.replace(/^the\s+/, "");
    for (const variant of [key, noThe]) {
      if (!variant) continue;
      keys.add(variant);
      const one = variant.replace(/\bone\b/g, "1");
      if (one !== variant) keys.add(one);
    }
  }
  return [...keys];
}

function collapsed(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.replace(/ /g, "")).filter(Boolean))];
}

/** True when every word of `shorter` is the start of `longer`, and at least two words. */
function wordPrefix(shorter: string, longer: string): boolean {
  if (!shorter || shorter === longer) return false;
  const a = shorter.split(" ").filter(Boolean);
  const b = longer.split(" ").filter(Boolean);
  if (a.length < 2 || a.length >= b.length) return false;
  return a.every((word, index) => b[index] === word);
}

function unique(hits: ClientWebsiteSeedClient[]): ClientWebsiteSeedClient | "ambiguous" | "none" {
  const rows = [...new Map(hits.map((hit) => [hit.id, hit])).values()];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return "ambiguous";
  return "none";
}

function lookupExact(
  clients: ClientWebsiteSeedClient[],
  keys: string[]
): ClientWebsiteSeedClient | "ambiguous" | "none" {
  const want = new Set(keys);
  return unique(
    clients.filter((client) => clientWebsiteMatchKeys(client.name).some((key) => want.has(key)))
  );
}

function lookupCollapsed(
  clients: ClientWebsiteSeedClient[],
  keys: string[]
): ClientWebsiteSeedClient | "ambiguous" | "none" {
  const want = new Set(collapsed(keys));
  return unique(
    clients.filter((client) =>
      collapsed(clientWebsiteMatchKeys(client.name)).some((key) => want.has(key))
    )
  );
}

function lookupPrefix(
  clients: ClientWebsiteSeedClient[],
  keys: string[]
): ClientWebsiteSeedClient | "ambiguous" | "none" {
  return unique(
    clients.filter((client) => {
      const clientKeys = clientWebsiteMatchKeys(client.name);
      return keys.some((seedKey) => clientKeys.some((clientKey) => wordPrefix(clientKey, seedKey)));
    })
  );
}

function cascade(
  clients: ClientWebsiteSeedClient[],
  names: string[]
): ClientWebsiteSeedClient | "ambiguous" | "none" {
  const keys = [...new Set(names.flatMap((name) => clientWebsiteMatchKeys(name)))];
  if (!keys.length) return "none";
  const exact = lookupExact(clients, keys);
  if (exact !== "none") return exact;
  const folded = lookupCollapsed(clients, keys);
  if (folded !== "none") return folded;
  return lookupPrefix(clients, keys);
}

export function matchClientWebsites(
  clients: ClientWebsiteSeedClient[],
  seeds: readonly ClientWebsiteSeedEntry[]
): ClientWebsiteSeedRow[] {
  const used = new Set<string>();
  const rows: ClientWebsiteSeedRow[] = [];
  for (const entry of seeds) {
    const domain = canonicalSeedDomain(entry.domain);
    if (!domain) {
      rows.push({ name: entry.name, domain: entry.domain, status: "no-match" });
      continue;
    }
    const available = () => clients.filter((client) => !used.has(client.id));
    let found = cascade(available(), [entry.name]);
    if (found === "none" && entry.also?.length) found = cascade(available(), [...entry.also]);
    if (found === "none" || found === "ambiguous") {
      rows.push({ name: entry.name, domain, status: "no-match" });
      continue;
    }
    used.add(found.id);
    const existing = (found.website || "").trim();
    if (existing) {
      rows.push({
        name: entry.name,
        domain,
        status: "already-set",
        clientId: found.id,
        clientName: found.name,
        website: existing,
      });
      continue;
    }
    rows.push({
      name: entry.name,
      domain,
      status: "filled",
      clientId: found.id,
      clientName: found.name,
      website: domain,
    });
  }
  return rows;
}

function readState(): SeedState | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(CLIENT_WEBSITE_SEED_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<SeedState>;
    return {
      attempts: Number(parsed.attempts) || 0,
      pending: Array.isArray(parsed.pending) ? parsed.pending.map((name) => String(name)) : [],
      done: Boolean(parsed.done),
    };
  } catch {
    return null;
  }
}

function writeState(state: SeedState): void {
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(CLIENT_WEBSITE_SEED_KEY, JSON.stringify(state), stamp);
}

function logRow(row: ClientWebsiteSeedRow): void {
  if (row.status === "filled") {
    const via =
      row.clientName && row.clientName !== row.name ? ` (${row.clientName})` : "";
    console.log(`[client-websites] filled ${row.name} -> ${row.domain}${via}`);
    return;
  }
  if (row.status === "already-set") {
    console.log(`[client-websites] already set ${row.name} (${row.website || row.domain})`);
    return;
  }
  console.log(`[client-websites] no match ${row.name}`);
}

function loadClients(): ClientWebsiteSeedClient[] {
  return getDb()
    .prepare(`SELECT id, name, IFNULL(website, '') AS website FROM rev_clients`)
    .all() as ClientWebsiteSeedClient[];
}

function fillBlankWebsite(id: string, domain: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE rev_clients
          SET website = ?, updated_at = ?
        WHERE id = ?
          AND TRIM(IFNULL(website, '')) = ''`
    )
    .run(domain, nowIso(), id);
  return result.changes > 0;
}

export async function runClientWebsiteSeed(
  options?: ClientWebsiteSeedOptions
): Promise<ClientWebsiteSeedReport> {
  const seeds = options?.seeds ?? CLIENT_WEBSITE_SEED;
  const prior = readState();
  if (prior?.done) {
    console.log("[client-websites] already completed");
    return {
      skipped: true,
      attempts: prior.attempts,
      done: true,
      pending: prior.pending,
      rows: [],
    };
  }

  const planned = matchClientWebsites(loadClients(), seeds);
  for (const row of planned) {
    if (row.status !== "filled" || !row.clientId) continue;
    if (fillBlankWebsite(row.clientId, row.domain)) continue;
    const current = getDb()
      .prepare(`SELECT IFNULL(website, '') AS website FROM rev_clients WHERE id = ?`)
      .get(row.clientId) as { website: string } | undefined;
    row.status = "already-set";
    row.website = (current?.website || "").trim() || row.domain;
  }
  for (const row of planned) logRow(row);

  const pending = planned.filter((row) => row.status === "no-match").map((row) => row.name);
  const attempts = (prior?.attempts || 0) + 1;
  const done = pending.length === 0 || attempts >= CLIENT_WEBSITE_SEED_MAX_ATTEMPTS;
  const ids = planned
    .filter((row) => row.status !== "no-match" && row.clientId)
    .map((row) => row.clientId as string);

  if (options?.pullLogos !== false && ids.length) {
    try {
      await pullClientLogosInBatches(ids, {
        transport: options?.transport,
        gapMs: options?.logoGapMs,
      });
    } catch (err) {
      console.error(
        "[client-websites] logo pull failed",
        err instanceof Error ? err.message : err
      );
    }
  }

  writeState({ attempts, pending, done });
  const filled = planned.filter((row) => row.status === "filled").length;
  const already = planned.filter((row) => row.status === "already-set").length;
  console.log(
    `[client-websites] filled ${filled}, already set ${already}, no match ${pending.length} (attempt ${attempts}/${CLIENT_WEBSITE_SEED_MAX_ATTEMPTS})`
  );
  if (done && pending.length) {
    console.log(
      `[client-websites] stopping after ${attempts} boots; still unmatched: ${pending.join(", ")}`
    );
  }
  return { skipped: false, attempts, done, pending, rows: planned };
}

/** Deferred startup entry. A thrown error is logged and does not crash boot. */
export async function runClientWebsiteSeedOnStartup(
  options?: ClientWebsiteSeedOptions
): Promise<ClientWebsiteSeedReport> {
  try {
    return await runClientWebsiteSeed(options);
  } catch (err) {
    console.error(
      "[client-websites] seed failed",
      err instanceof Error ? err.message : err
    );
    return {
      skipped: false,
      attempts: 0,
      done: false,
      pending: [],
      rows: [],
      failed: true,
    };
  }
}
