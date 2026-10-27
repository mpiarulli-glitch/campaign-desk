// Fetches a client's logo once and stores the bytes under data/client-logos.
// The Clients view reads the stored file, then a favicon from that same
// folder, then initials. It does not hotlink.
//
// The domain is the one Lifecycle cards already use (rev_clients.website),
// and when that is empty the Lifecycle account links. See client-logo-domain.
//
// Chain: apple-touch-icon, then a logo link, then og:image, then the largest
// favicon, then a few well-known icon paths, then Google's favicon service
// downloaded and saved. A square image about apple-touch size stops the
// search. Tiny and blank images are skipped. Nothing is hotlinked.
// Sites that answer 403/406 to a bot get a normal browser User-Agent, and a
// miss still falls through to the favicon service.

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import {
  assessLogoBytes,
  classifyLogoBytes,
  clientLogoPublicUrl,
  faviconPublicUrl,
  readCachedFavicon,
  readClientLogo,
  saveCachedFavicon,
  saveClientLogo,
} from "./client-logos";
import { getDb } from "./db";
import { getRevClient, updateRevClient } from "./revenue";

export const LOGO_FETCH_TIMEOUT_MS = 8000;
export const LOGO_MAX_REDIRECTS = 4;
const HTML_MAX_BYTES = 750_000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

const blockedNets = new BlockList();
blockedNets.addSubnet("0.0.0.0", 8, "ipv4");
blockedNets.addSubnet("10.0.0.0", 8, "ipv4");
blockedNets.addSubnet("100.64.0.0", 10, "ipv4");
blockedNets.addSubnet("127.0.0.0", 8, "ipv4");
blockedNets.addSubnet("169.254.0.0", 16, "ipv4");
blockedNets.addSubnet("172.16.0.0", 12, "ipv4");
blockedNets.addSubnet("192.0.0.0", 24, "ipv4");
blockedNets.addSubnet("192.0.2.0", 24, "ipv4");
blockedNets.addSubnet("192.168.0.0", 16, "ipv4");
blockedNets.addSubnet("198.18.0.0", 15, "ipv4");
blockedNets.addSubnet("198.51.100.0", 24, "ipv4");
blockedNets.addSubnet("203.0.113.0", 24, "ipv4");
blockedNets.addSubnet("224.0.0.0", 4, "ipv4");
blockedNets.addSubnet("240.0.0.0", 4, "ipv4");
blockedNets.addAddress("::", "ipv6");
blockedNets.addAddress("::1", "ipv6");
blockedNets.addSubnet("fc00::", 7, "ipv6");
blockedNets.addSubnet("fe80::", 10, "ipv6");
blockedNets.addSubnet("ff00::", 8, "ipv6");
blockedNets.addSubnet("2001:db8::", 32, "ipv6");

export type LogoAttempt = { url: string; source: string };

export type LogoFetchOk = {
  ok: true;
  data: Buffer;
  mime: string;
  source: string;
};

export type LogoFetchResult = LogoFetchOk | { ok: false; error: string };

export type LogoTransportResponse =
  | { ok: true; status: number; contentType: string; body: Buffer; url: string }
  | { ok: false; error: string };

export type LogoTransport = (url: string) => Promise<LogoTransportResponse>;

export type LogoPullReport = {
  fetched: Array<{ id: string; name: string; source: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  planned: Array<{ id: string; name: string; website: string; source: string }>;
  /** Clients whose Lifecycle records have no usable domain. */
  unresolved: Array<{ id: string; name: string }>;
};

/** How many missing logos one Clients view load will start. */
export const LOGO_RESOLVE_BATCH = 4;
const LOGO_RESOLVE_GAP_MS = 200;
const LOGO_RESOLVE_COOLDOWN_MS = 10 * 60 * 1000;

type ClientLogoRow = {
  id: string;
  name: string;
  website: string | null;
  logo_path: string | null;
};

/** True for loopback, private, link-local, multicast, and reserved addresses. */
export function isBlockedIp(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(raw) === 4) return blockedNets.check(raw, "ipv4");
  if (isIP(raw) === 6) {
    if (blockedNets.check(raw, "ipv6")) return true;
    const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockedNets.check(mapped[1], "ipv4");
    return false;
  }
  return true;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (isIP(host)) return isBlockedIp(host);
  return false;
}

/** http(s) only, ports 80 and 443, no credentials, no private hosts. */
export function validateLogoUrl(
  raw: string
): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That address is not allowed." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "That address is not allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "That address is not allowed." };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, error: "That address is not allowed." };
  }
  if (blockedHostname(url.hostname)) {
    return { ok: false, error: "That address is not allowed." };
  }
  return { ok: true, url };
}

/** Bare domain or full URL, ready to fetch. Null when it is empty or unsafe. */
export function publicWebsiteUrl(website: string): URL | null {
  const raw = (website || "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const checked = validateLogoUrl(withScheme);
  return checked.ok ? checked.url : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function readAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const key = match[1].toLowerCase();
    const value = decodeHtml((match[2] ?? match[3] ?? match[4] ?? "").trim());
    attrs.set(key, value);
  }
  return attrs;
}

function resolvePublic(href: string, base: string): string | null {
  try {
    const checked = validateLogoUrl(new URL(href, base).toString());
    return checked.ok ? checked.url.toString() : null;
  } catch {
    return null;
  }
}

function iconSize(sizes: string): number {
  const raw = (sizes || "").trim().toLowerCase();
  if (!raw) return 0;
  if (raw === "any") return 512;
  const match = raw.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function collectLogoLinks(html: string): string[] {
  const found: string[] = [];
  const push = (href: string) => {
    const value = (href || "").trim();
    if (!value || found.includes(value) || found.length >= 3) return;
    found.push(value);
  };
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const attrs = readAttrs(tag);
    const rel = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
    if (!rel.some((token) => token === "logo" || token.endsWith("-logo"))) continue;
    push(attrs.get("href") || "");
  }
  const images = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of images) {
    const attrs = readAttrs(tag);
    const hint = `${attrs.get("id") || ""} ${attrs.get("class") || ""} ${attrs.get("alt") || ""} ${attrs.get("src") || ""}`.toLowerCase();
    if (!/\blogo\b/.test(hint)) continue;
    push(attrs.get("src") || "");
  }
  const jsonLogo = /"logo"\s*:\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLogo.exec(html))) push(match[1]);
  return found;
}

function collectIcons(
  html: string,
  kind: "apple" | "icon"
): Array<{ href: string; size: number }> {
  const found: Array<{ href: string; size: number }> = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = readAttrs(tag);
    const rel = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
    const href = attrs.get("href") || "";
    if (!href) continue;
    const apple = rel.some((token) => token.startsWith("apple-touch-icon"));
    const icon =
      rel.includes("icon") || rel.includes("shortcut") || rel.includes("shortcut-icon");
    if (kind === "apple" && !apple) continue;
    if (kind === "icon" && (apple || !icon)) continue;
    found.push({ href, size: iconSize(attrs.get("sizes") || "") });
  }
  return found;
}

function firstOgImage(html: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = readAttrs(tag);
    const key = (attrs.get("property") || attrs.get("name") || "").toLowerCase();
    if (key !== "og:image" && key !== "og:image:url") continue;
    const content = attrs.get("content") || "";
    if (content) return content;
  }
  return "";
}

/** Ordered URLs to try after the homepage. Private addresses are left out. */
export function logoAttempts(
  website: string,
  html: string | null,
  pageUrl?: string | null
): LogoAttempt[] {
  const page = publicWebsiteUrl(website);
  if (!page) return [];
  const base = pageUrl || page.toString();
  const attempts: LogoAttempt[] = [];
  const seen = new Set<string>();
  const push = (href: string, source: string) => {
    const resolved = resolvePublic(href, base);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    attempts.push({ url: resolved, source });
  };

  if (html) {
    const apples = collectIcons(html, "apple").sort((a, b) => b.size - a.size);
    for (const item of apples) push(item.href, "apple-touch-icon");
    for (const href of collectLogoLinks(html)) push(href, "logo");
    const og = firstOgImage(html);
    if (og) push(og, "og:image");
    const icons = collectIcons(html, "icon").sort((a, b) => b.size - a.size);
    for (const item of icons) {
      if (/\.ico(?:$|\?)/i.test(item.href)) continue;
      push(item.href, "favicon");
    }
  }

  for (const path of [
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/favicon.png",
    "/favicon.svg",
  ]) {
    push(`${page.origin}${path}`, "site-icon");
  }

  const host = page.hostname.replace(/^www\./, "");
  push(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
    "favicon-service"
  );

  const service = attempts.filter((item) => item.source === "favicon-service");
  const rest = attempts.filter((item) => item.source !== "favicon-service");
  return [...rest.slice(0, 9), ...service].slice(0, 10);
}

function looksLikeHtml(contentType: string, body: Buffer): boolean {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  const head = body.subarray(0, 200).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

type Pinned = { address: string; family: number };

async function resolvePublicHost(hostname: string): Promise<Pinned | { error: string }> {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) return { error: "That address is not allowed." };
    return { address: hostname, family: isIP(hostname) };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { error: "Could not reach that website." };
  }
  if (!records.length) return { error: "Could not reach that website." };
  if (records.some((record) => isBlockedIp(record.address))) {
    return { error: "That address is not allowed." };
  }
  return { address: records[0].address, family: records[0].family };
}

function readLimited(
  res: http.IncomingMessage,
  max: number
): Promise<Buffer | "too-big"> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Buffer | "too-big") => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    res.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > max) {
        res.destroy();
        finish("too-big");
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => finish(Buffer.concat(chunks)));
    res.on("error", () => finish(Buffer.alloc(0)));
  });
}

function requestOnce(
  url: URL,
  pinned: Pinned,
  maxBytes: number
): Promise<
  | { kind: "redirect"; location: string }
  | { kind: "body"; status: number; contentType: string; body: Buffer }
  | { kind: "error"; error: string }
> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      value:
        | { kind: "redirect"; location: string }
        | { kind: "body"; status: number; contentType: string; body: Buffer }
        | { kind: "error"; error: string }
    ) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: logoFetchHeaders(url),
        servername: url.hostname,
        lookup: ((hostname, options, callback) => {
          const cb = typeof options === "function" ? options : callback;
          const all = typeof options === "object" && options?.all;
          if (all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
          void hostname;
        }) as https.RequestOptions["lookup"],
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          finish({ kind: "redirect", location: String(location) });
          return;
        }
        const contentType = String(res.headers["content-type"] || "");
        const declared = Number(res.headers["content-length"] || 0);
        const html = /text\/html|application\/xhtml\+xml/i.test(contentType);
        const cap = html ? Math.min(maxBytes, HTML_MAX_BYTES) : maxBytes;
        if (!html && declared > cap) {
          res.resume();
          finish({ kind: "error", error: "Logo must be 2 MB or smaller." });
          return;
        }
        void readLimited(res, cap).then((body) => {
          if (body === "too-big") {
            finish({
              kind: "error",
              error: html ? "Could not read that page." : "Logo must be 2 MB or smaller.",
            });
            return;
          }
          finish({ kind: "body", status, contentType, body });
        });
      }
    );
    req.setTimeout(LOGO_FETCH_TIMEOUT_MS, () => {
      req.destroy();
      finish({ kind: "error", error: "The logo request timed out." });
    });
    req.on("error", () => finish({ kind: "error", error: "Could not reach that website." }));
    req.end();
  });
}

export const LOGO_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Browser-like headers. Several client sites answer 403 or 406 to a bot name. */
export function logoFetchHeaders(target: URL): Record<string, string> {
  return {
    Host: target.host,
    "User-Agent": LOGO_BROWSER_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/png,image/svg+xml,image/jpeg,image/gif,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${target.origin}/`,
  };
}

/** One GET, with DNS pinned to addresses checked before the connection. */
export async function fetchPublicBuffer(rawUrl: string, redirects = 0): Promise<LogoTransportResponse> {
  const checked = validateLogoUrl(rawUrl);
  if (!checked.ok) return checked;
  const pinned = await resolvePublicHost(checked.url.hostname);
  if ("error" in pinned) return { ok: false, error: pinned.error };
  const result = await requestOnce(checked.url, pinned, IMAGE_MAX_BYTES);
  if (result.kind === "error") return { ok: false, error: result.error };
  if (result.kind === "redirect") {
    if (redirects >= LOGO_MAX_REDIRECTS) {
      return { ok: false, error: "Too many redirects." };
    }
    let next: string;
    try {
      next = new URL(result.location, checked.url).toString();
    } catch {
      return { ok: false, error: "That address is not allowed." };
    }
    return fetchPublicBuffer(next, redirects + 1);
  }
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, error: `Logo request failed (${result.status}).` };
  }
  return {
    ok: true,
    status: result.status,
    contentType: result.contentType,
    body: result.body,
    url: checked.url.toString(),
  };
}

type LogoCandidate = {
  data: Buffer;
  mime: string;
  source: string;
  score: number;
};

/** A square about the size of an apple touch icon is enough to stop looking. */
const LOGO_STOP_MIN_PX = 160;
const LOGO_STOP_RATIO = 0.85;

function logoCandidate(
  body: Buffer,
  source: string
): { candidate: LogoCandidate; stop: boolean } | null {
  const image = classifyLogoBytes(body);
  if (!image) return null;
  const assessed = assessLogoBytes(image.data);
  if (assessed?.blank || (assessed && assessed.score < 0)) return null;
  const minSide = assessed ? Math.min(assessed.width, assessed.height) : 0;
  const ratio = assessed?.ratio ?? 0;
  return {
    candidate: {
      data: image.data,
      mime: image.mime,
      source,
      score: assessed ? assessed.score : 40,
    },
    stop: ratio >= LOGO_STOP_RATIO && minSide >= LOGO_STOP_MIN_PX,
  };
}

export async function fetchStoredLogo(
  website: string,
  transport: LogoTransport = fetchPublicBuffer
): Promise<LogoFetchResult> {
  const page = publicWebsiteUrl(website);
  if (!page) return { ok: false, error: "No website on the client record." };

  let html: string | null = null;
  let best: LogoCandidate | null = null;
  const keep = (body: Buffer, source: string): boolean => {
    const found = logoCandidate(body, source);
    if (!found) return false;
    if (!best || found.candidate.score > best.score) best = found.candidate;
    return found.stop;
  };
  const finish = (): LogoFetchResult => {
    if (!best) return { ok: false, error: "Could not find a logo on that website." };
    return { ok: true, data: best.data, mime: best.mime, source: best.source };
  };

  const first = await transport(page.toString());
  if (first.ok && first.status >= 200 && first.status < 300) {
    if (classifyLogoBytes(first.body)) {
      if (keep(first.body, "website-image")) return finish();
    } else if (looksLikeHtml(first.contentType, first.body)) {
      html = first.body.toString("utf8");
    }
  }

  const attempts = logoAttempts(website, html, page.toString()).filter(
    (attempt) => attempt.url !== page.toString()
  );
  for (const attempt of attempts) {
    const response = await transport(attempt.url);
    if (!response.ok || response.status < 200 || response.status >= 300) continue;
    if (keep(response.body, attempt.source)) break;
  }
  return finish();
}

function storedLogoExists(clientId: string, logoPath: string): boolean {
  const stored = (logoPath || "").trim();
  if (!stored || stored.includes("..") || stored.includes("/")) return false;
  return readClientLogo(clientId, stored) !== null;
}

const NO_DOMAIN = "No domain on the Lifecycle record.";

async function cacheLifecycleFavicon(host: string, transport: LogoTransport): Promise<boolean> {
  if (readCachedFavicon(host)) return true;
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  const response = await transport(url);
  if (!response.ok || response.status < 200 || response.status >= 300) return false;
  return saveCachedFavicon(host, response.body);
}

/**
 * Download the logo for one domain and store it.
 * An empty website is filled with the host after a file actually lands,
 * so a miss does not pin a bad domain.
 */
async function storeResolvedLogo(
  row: ClientLogoRow,
  domain: { host: string; fetchUrl: string },
  transport?: LogoTransport
): Promise<{ ok: true; source: string } | { ok: false; error: string; faviconCached: boolean }> {
  let faviconCached = false;
  try {
    faviconCached = await cacheLifecycleFavicon(domain.host, transport || fetchPublicBuffer);
  } catch {
    faviconCached = false;
  }
  const fetched = await fetchStoredLogo(domain.fetchUrl, transport);
  const websiteMissing = !(row.website || "").trim();
  if (!fetched.ok) {
    if (websiteMissing && faviconCached) updateRevClient(row.id, { website: domain.host });
    return { ok: false, error: fetched.error, faviconCached };
  }
  const saved = saveClientLogo(row.id, fetched.data, fetched.mime);
  if (!saved.ok) {
    if (websiteMissing && faviconCached) updateRevClient(row.id, { website: domain.host });
    return { ok: false, error: saved.error, faviconCached };
  }
  updateRevClient(row.id, {
    logoPath: saved.filename,
    ...(websiteMissing ? { website: domain.host } : {}),
  });
  return { ok: true, source: fetched.source };
}

/**
 * Pull logos for clients that have a Lifecycle domain and no stored file.
 * Safe to run again: an existing file is left alone unless `force` is set.
 * `dryRun` lists who would be fetched and does not touch the network.
 */
export async function pullMissingClientLogos(options?: {
  dryRun?: boolean;
  force?: boolean;
  clientId?: string;
  transport?: LogoTransport;
}): Promise<LogoPullReport> {
  const dryRun = Boolean(options?.dryRun);
  const force = Boolean(options?.force);
  const transport = options?.transport;
  const only = (options?.clientId || "").trim();
  const rows = getDb()
    .prepare(`SELECT id, name, website, logo_path FROM rev_clients ORDER BY name COLLATE NOCASE`)
    .all() as ClientLogoRow[];
  const { loadLifecycleLogoDomains } = await import("./client-logo-domain");
  const domains = loadLifecycleLogoDomains(rows);

  const report: LogoPullReport = {
    fetched: [],
    failed: [],
    skipped: [],
    planned: [],
    unresolved: [],
  };
  for (const row of rows) {
    if (only && row.id !== only) continue;
    const name = row.name || row.id;
    const domain = domains.get(row.id);
    if (!domain) {
      report.unresolved.push({ id: row.id, name });
      report.skipped.push({ id: row.id, name, reason: NO_DOMAIN });
      continue;
    }
    if (!force && storedLogoExists(row.id, row.logo_path || "")) {
      report.skipped.push({ id: row.id, name, reason: "Already has a stored logo." });
      continue;
    }
    if (dryRun) {
      report.planned.push({
        id: row.id,
        name,
        website: domain.host,
        source: domain.source,
      });
      continue;
    }
    const stored = await storeResolvedLogo(row, domain, transport);
    if (!stored.ok) {
      if (stored.faviconCached) {
        report.fetched.push({ id: row.id, name, source: "favicon-cache" });
      } else {
        report.failed.push({ id: row.id, name, error: stored.error });
      }
      continue;
    }
    report.fetched.push({ id: row.id, name, source: stored.source });
  }
  return report;
}

export async function refreshClientLogo(
  clientId: string,
  transport?: LogoTransport
): Promise<
  | { ok: true; logoUrl: string; source: string }
  | { ok: false; error: string; status: number }
> {
  if (!getRevClient(clientId)) return { ok: false, error: "Not found", status: 404 };
  const report = await pullMissingClientLogos({ force: true, clientId, transport });
  const success = report.fetched[0];
  if (success) {
    const updated = getRevClient(clientId);
    if (updated?.logo_path && readClientLogo(clientId, updated.logo_path)) {
      return {
        ok: true,
        logoUrl: clientLogoPublicUrl(clientId, updated.updated_at),
        source: success.source,
      };
    }
    const { loadLifecycleLogoDomains } = await import("./client-logo-domain");
    const domain = updated
      ? loadLifecycleLogoDomains([{ id: updated.id, website: updated.website }]).get(updated.id)
      : null;
    const cached = domain && readCachedFavicon(domain.host) ? faviconPublicUrl(domain.host) : null;
    if (cached) return { ok: true, logoUrl: cached, source: success.source };
  }
  const failed = report.failed[0];
  if (failed) return { ok: false, error: failed.error, status: 400 };
  const skipped = report.skipped[0];
  return {
    ok: false,
    error: skipped?.reason || "Could not refresh that logo.",
    status: 400,
  };
}

const logoResolveQueued = new Set<string>();
const logoResolveInFlight = new Set<string>();
const logoResolveCooldown = new Map<string, number>();
let logoResolveChain: Promise<void> = Promise.resolve();

/** Clears the in-process queue. Tests only. */
export function resetClientLogoResolveForTests(): void {
  logoResolveQueued.clear();
  logoResolveInFlight.clear();
  logoResolveCooldown.clear();
  logoResolveChain = Promise.resolve();
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start logo fetches for clients on the Clients view that have no stored file.
 * One call starts at most `limit` clients that have a Lifecycle domain.
 * A client already queued or in flight is not started again. A failed fetch
 * cools down so the next load can move on. Callers on the request path should
 * not await this.
 */
export function scheduleMissingClientLogos(
  clientIds: string[],
  options?: { transport?: LogoTransport; limit?: number; gapMs?: number; now?: number }
): Promise<string[]> {
  const run = logoResolveChain.then(() => resolveMissingClientLogos(clientIds, options));
  logoResolveChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function resolveMissingClientLogos(
  clientIds: string[],
  options?: { transport?: LogoTransport; limit?: number; gapMs?: number; now?: number }
): Promise<string[]> {
  const limit = options?.limit ?? LOGO_RESOLVE_BATCH;
  const gapMs = options?.gapMs ?? LOGO_RESOLVE_GAP_MS;
  const now = options?.now ?? Date.now();
  const ordered = [...new Set(clientIds.map((id) => id.trim()).filter(Boolean))];
  if (!ordered.length || limit <= 0) return [];

  const rows = getDb()
    .prepare(
      `SELECT id, name, website, logo_path FROM rev_clients
        WHERE id IN (${ordered.map(() => "?").join(",")})`
    )
    .all(...ordered) as ClientLogoRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const { loadLifecycleLogoDomains } = await import("./client-logo-domain");
  const domains = loadLifecycleLogoDomains(rows);
  const picked: ClientLogoRow[] = [];
  for (const id of ordered) {
    if (picked.length >= limit) break;
    const row = byId.get(id);
    if (!row || !domains.has(id)) continue;
    if (logoResolveQueued.has(id) || logoResolveInFlight.has(id)) continue;
    if ((logoResolveCooldown.get(id) || 0) > now) continue;
    if (storedLogoExists(row.id, row.logo_path || "")) continue;
    logoResolveQueued.add(id);
    picked.push(row);
  }
  const started = picked.map((row) => row.id);
  for (const row of picked) {
    logoResolveQueued.delete(row.id);
    logoResolveInFlight.add(row.id);
    try {
      const domain = domains.get(row.id);
      if (!domain) continue;
      const stored = await storeResolvedLogo(row, domain, options?.transport);
      if (!stored.ok && !stored.faviconCached) {
        logoResolveCooldown.set(row.id, Date.now() + LOGO_RESOLVE_COOLDOWN_MS);
      }
    } catch {
      logoResolveCooldown.set(row.id, Date.now() + LOGO_RESOLVE_COOLDOWN_MS);
    } finally {
      logoResolveInFlight.delete(row.id);
    }
    await wait(gapMs);
  }
  return started;
}

/**
 * Pull stored logos for these clients, a few at a time. An existing file is
 * skipped. A failed fetch is cooled down so the next page load does not
 * immediately hit the same site again. One failure does not stop the batch.
 */
export async function pullClientLogosInBatches(
  clientIds: string[],
  options?: { transport?: LogoTransport; batchSize?: number; gapMs?: number }
): Promise<void> {
  const batchSize = Math.max(1, options?.batchSize ?? 3);
  const gapMs = options?.gapMs ?? LOGO_RESOLVE_GAP_MS;
  const ids = [...new Set(clientIds.map((id) => id.trim()).filter(Boolean))];
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (id) => {
        if (logoResolveInFlight.has(id) || logoResolveQueued.has(id)) return;
        logoResolveInFlight.add(id);
        try {
          const report = await pullMissingClientLogos({
            clientId: id,
            transport: options?.transport,
          });
          if (report.failed.some((row) => row.id === id)) {
            logoResolveCooldown.set(id, Date.now() + LOGO_RESOLVE_COOLDOWN_MS);
          }
        } catch (err) {
          logoResolveCooldown.set(id, Date.now() + LOGO_RESOLVE_COOLDOWN_MS);
          console.error(
            "[client-logos] pull failed",
            id,
            err instanceof Error ? err.message : err
          );
        } finally {
          logoResolveInFlight.delete(id);
        }
      })
    );
    if (index + batchSize < ids.length && gapMs > 0) await wait(gapMs);
  }
}
