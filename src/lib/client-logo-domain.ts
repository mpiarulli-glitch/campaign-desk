// Where a client logo's domain comes from.
//
// Lifecycle cards and the weekly snapshot call resolveClientLogoUrl. That
// hotlinks Google's favicon for rev_clients.website when no file is stored.
// That column is the domain those cards use in production.
//
// The column is often blank. The same Lifecycle account still has a public
// site on the brand kit, an offer link, an opt-in link, or the reply-to
// address. Those are checked only when website is empty. A successful fetch
// copies the host into website so the next lookup, including Lifecycle's
// hotlink, uses the column and does not walk the account again.
//
// Forecast is not read.

import { getDb } from "./db";
import { publicWebsiteUrl } from "./client-logo-fetch";

export type LifecycleLogoSource =
  | "website"
  | "brand-kit"
  | "offer"
  | "opt-in"
  | "reply-to";

export type LifecycleLogoDomain = {
  host: string;
  fetchUrl: string;
  source: LifecycleLogoSource;
};

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "comcast.net",
  "sbcglobal.net",
]);

// Hosts that show up on a Lifecycle account but are not the client's site.
const SKIPPED_HOSTS = [
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "ggpht.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "filesafe.space",
  "marketingempiregroup.com",
  "bit.ly",
  "linktr.ee",
  "linktree.com",
];

export function skippedLogoHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!name) return true;
  if (FREE_MAIL.has(name)) return true;
  return SKIPPED_HOSTS.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

function fromUrl(raw: string, source: LifecycleLogoSource): LifecycleLogoDomain | null {
  const page = publicWebsiteUrl(raw);
  if (!page) return null;
  const host = page.hostname.toLowerCase().replace(/^www\./, "");
  if (skippedLogoHost(host)) return null;
  return { host, fetchUrl: page.toString(), source };
}

function fromMailbox(raw: string): LifecycleLogoDomain | null {
  const match = (raw || "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!match) return null;
  return fromUrl(match[1], "reply-to");
}

/**
 * First usable domain. `website` wins, because that is what Lifecycle cards
 * already hotlink. The other fields are Lifecycle account records.
 */
export function pickLifecycleLogoDomain(input: {
  website?: string | null;
  logoAssetsUrl?: string | null;
  offerUrls?: string[] | null;
  optInUrls?: string[] | null;
  replyToEmail?: string | null;
}): LifecycleLogoDomain | null {
  const website = fromUrl(input.website || "", "website");
  if (website) return website;
  const brand = fromUrl(input.logoAssetsUrl || "", "brand-kit");
  if (brand) return brand;
  for (const url of input.offerUrls || []) {
    const offer = fromUrl(url, "offer");
    if (offer) return offer;
  }
  for (const url of input.optInUrls || []) {
    const optIn = fromUrl(url, "opt-in");
    if (optIn) return optIn;
  }
  return fromMailbox(input.replyToEmail || "");
}

type DomainClient = { id: string; website: string | null };

type BrandRow = {
  client_id: string;
  logo_assets_url: string;
  reply_to_email: string;
};

type UrlRow = { client_id: string; url: string };

function groupUrls(rows: UrlRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.client_id);
    if (list) list.push(row.url);
    else grouped.set(row.client_id, [row.url]);
  }
  return grouped;
}

/** One read of the Lifecycle fields that can supply a domain. */
export function loadLifecycleLogoDomains(
  clients: DomainClient[]
): Map<string, LifecycleLogoDomain> {
  const found = new Map<string, LifecycleLogoDomain>();
  if (!clients.length) return found;
  const ids = clients.map((client) => client.id);
  const marks = ids.map(() => "?").join(",");
  const db = getDb();
  const brands = db
    .prepare(
      `SELECT client_id, logo_assets_url, reply_to_email
         FROM lifecycle_account_brand
        WHERE client_id IN (${marks})`
    )
    .all(...ids) as BrandRow[];
  const offers = db
    .prepare(
      `SELECT client_id, cta_url AS url
         FROM lifecycle_account_offers
        WHERE client_id IN (${marks}) AND TRIM(cta_url) != ''
        ORDER BY created_at ASC`
    )
    .all(...ids) as UrlRow[];
  const optIns = db
    .prepare(
      `SELECT client_id, url
         FROM lifecycle_account_opt_ins
        WHERE client_id IN (${marks}) AND TRIM(url) != ''
        ORDER BY created_at ASC`
    )
    .all(...ids) as UrlRow[];
  const brandById = new Map(brands.map((row) => [row.client_id, row]));
  const offerById = groupUrls(offers);
  const optInById = groupUrls(optIns);
  for (const client of clients) {
    const brand = brandById.get(client.id);
    const domain = pickLifecycleLogoDomain({
      website: client.website,
      logoAssetsUrl: brand?.logo_assets_url,
      offerUrls: offerById.get(client.id),
      optInUrls: optInById.get(client.id),
      replyToEmail: brand?.reply_to_email,
    });
    if (domain) found.set(client.id, domain);
  }
  return found;
}
