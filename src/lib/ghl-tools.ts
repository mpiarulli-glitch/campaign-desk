/**
 * Agency-wide GoHighLevel audits for the lifecycle Tools panel.
 *
 * Everything here fans out across every location on the agency, not just the
 * ones mapped to a Campaign Desk client, because the unmapped subaccounts are
 * usually where the mess is. The fan-out, the per-location error isolation and
 * the caching all follow `sweepWorkflows` in lib/ghl, for the same reasons: one
 * unauthorised subaccount must not blank a whole report, and nobody wants to
 * wait 7 seconds twice.
 *
 * Nothing in this file writes to GoHighLevel. Writes live in `applyTagPlan`,
 * which only ever acts on actions a person ticked.
 */

import {
  ghlRequest,
  listLocations,
  type GhlLocation,
} from "./ghl";

const CONCURRENCY = 4;
const CACHE_TTL_MS = 10 * 60 * 1000;

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

/* ------------------------------------------------------------------ tags */

export interface GhlTag {
  id: string;
  name: string;
}

async function locationTags(locationId: string): Promise<GhlTag[]> {
  const res = await ghlRequest<{ tags?: Array<{ id?: string; name?: string }> }>(
    "GET",
    `/locations/${locationId}/tags`,
    { locationId }
  );
  return (res.tags || [])
    .filter((t) => t.id && t.name)
    .map((t) => ({ id: t.id as string, name: t.name as string }));
}

/** Tag name reduced so near-misses collide: case, spaces and punctuation go. */
export function tagKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface TagIssue {
  kind: "duplicate" | "test" | "dated" | "empty-name";
  /** What the group should collapse to, for a duplicate. */
  canonical: string;
  members: Array<{ locationId: string; locationName: string; tagId: string; name: string }>;
  why: string;
}

export interface TagAudit {
  fetchedAt: string;
  locationsScanned: number;
  locationsFailed: Array<{ locationId: string; locationName: string; error: string }>;
  totalTags: number;
  distinctNames: number;
  issues: TagIssue[];
}

// A tag that is obviously scaffolding rather than a segment.
const TEST_RE = /^(test|testing|null|undefined|asdf|xxx|delete ?me|tmp|temp)\b|^n\/a$/i;
// Date-shaped names: "11/13 door knocking", "10/24/2024", "1/22/2025", "2024".
const DATED_RE = /(^|\s)(\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|20\d{2})(\s|$)/;

/**
 * Audit tags across the agency.
 *
 * Groups by a normalised name so "carlsbad", "Carlsbad Chamber" and
 * "carlsbad chamber" surface together. The canonical choice is the most
 * frequently used spelling, then the longest, so a group collapses to the name
 * people actually type rather than whichever row came back first.
 */
export async function auditTags(force = false): Promise<TagAudit> {
  if (!force && tagCache && Date.now() - tagCache.at < CACHE_TTL_MS) return tagCache.data;

  const locations = await listLocations();
  const failed: TagAudit["locationsFailed"] = [];
  type Row = { locationId: string; locationName: string; tagId: string; name: string };
  const rows: Row[] = [];

  const per = await pooled(locations, async (loc: GhlLocation) => {
    try {
      return { loc, tags: await locationTags(loc.id), error: "" };
    } catch (err) {
      return {
        loc,
        tags: [] as GhlTag[],
        error: err instanceof Error ? err.message : "Failed to load tags",
      };
    }
  });

  for (const { loc, tags, error } of per) {
    if (error) {
      failed.push({ locationId: loc.id, locationName: loc.name, error });
      continue;
    }
    for (const t of tags) {
      rows.push({ locationId: loc.id, locationName: loc.name, tagId: t.id, name: t.name });
    }
  }

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = tagKey(r.name);
    if (!k) {
      // An all-punctuation name has no key to group on, so it is its own issue.
      continue;
    }
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }

  const issues: TagIssue[] = [];

  for (const [, group] of byKey) {
    const spellings = new Map<string, number>();
    for (const r of group) spellings.set(r.name, (spellings.get(r.name) || 0) + 1);
    if (spellings.size > 1) {
      const canonical = [...spellings.entries()].sort(
        (a, b) => b[1] - a[1] || b[0].length - a[0].length
      )[0][0];
      issues.push({
        kind: "duplicate",
        canonical,
        members: group.filter((r) => r.name !== canonical),
        why: `${spellings.size} spellings of the same tag: ${[...spellings.keys()].join(", ")}`,
      });
    }
  }

  for (const r of rows) {
    if (TEST_RE.test(r.name.trim())) {
      issues.push({
        kind: "test",
        canonical: "",
        members: [r],
        why: "Looks like a test or placeholder tag, not a segment",
      });
    } else if (DATED_RE.test(r.name)) {
      issues.push({
        kind: "dated",
        canonical: "",
        members: [r],
        why: "Date-based tag. Useful the week it was made, clutter afterwards",
      });
    }
    if (!tagKey(r.name)) {
      issues.push({
        kind: "empty-name",
        canonical: "",
        members: [r],
        why: "Name is only punctuation or whitespace",
      });
    }
  }

  const data: TagAudit = {
    fetchedAt: new Date().toISOString(),
    locationsScanned: locations.length - failed.length,
    locationsFailed: failed,
    totalTags: rows.length,
    distinctNames: byKey.size,
    issues: issues.sort((a, b) => b.members.length - a.members.length),
  };
  tagCache = { at: Date.now(), data };
  return data;
}

let tagCache: { at: number; data: TagAudit } | null = null;

/* -------------------------------------------------------- account report */

export interface AccountRow {
  locationId: string;
  locationName: string;
  /** True when a Campaign Desk client points at this location. */
  mapped: boolean;
  tagCount: number;
  contactCount: number | null;
  error?: string;
}

export interface AccountReport {
  fetchedAt: string;
  rows: AccountRow[];
  totals: { locations: number; mapped: number; unmapped: number; tags: number };
}

/**
 * One row per GoHighLevel location.
 *
 * `mappedLocationIds` is passed in rather than read here, so this module stays
 * a pure GoHighLevel client and does not reach into the Campaign Desk database.
 */
export async function accountReport(
  mappedLocationIds: Set<string>,
  force = false
): Promise<AccountReport> {
  if (!force && reportCache && Date.now() - reportCache.at < CACHE_TTL_MS) {
    return reportCache.data;
  }

  const locations = await listLocations();

  const rows = await pooled(locations, async (loc: GhlLocation) => {
    const row: AccountRow = {
      locationId: loc.id,
      locationName: loc.name,
      mapped: mappedLocationIds.has(loc.id),
      tagCount: 0,
      contactCount: null,
    };
    try {
      row.tagCount = (await locationTags(loc.id)).length;
    } catch (err) {
      row.error = err instanceof Error ? err.message : "Failed to read tags";
      return row;
    }
    try {
      // The search endpoint reports a total, which is far cheaper than paging
      // every contact just to count them.
      const res = await ghlRequest<{ total?: number }>("POST", "/contacts/search", {
        locationId: loc.id,
        body: { locationId: loc.id, page: 1, pageLimit: 1 },
      });
      row.contactCount = typeof res.total === "number" ? res.total : null;
    } catch {
      // A location that will not report a count still has a usable tag count,
      // so this is left null rather than failing the row.
      row.contactCount = null;
    }
    return row;
  });

  const data: AccountReport = {
    fetchedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => (b.contactCount || 0) - (a.contactCount || 0)),
    totals: {
      locations: rows.length,
      mapped: rows.filter((r) => r.mapped).length,
      unmapped: rows.filter((r) => !r.mapped).length,
      tags: rows.reduce((s, r) => s + r.tagCount, 0),
    },
  };
  reportCache = { at: Date.now(), data };
  return data;
}

let reportCache: { at: number; data: AccountReport } | null = null;

/* ------------------------------------------------------------- tag plan */

export type TagAction =
  | { type: "rename"; locationId: string; tagId: string; from: string; to: string }
  | { type: "delete"; locationId: string; tagId: string; name: string };

export interface TagPlanResult {
  applied: number;
  failures: Array<{ action: TagAction; error: string }>;
}

/**
 * Apply tag changes a person explicitly approved.
 *
 * Every action carries its own locationId, because the same tag name exists
 * separately in every subaccount and there is no agency-level tag to fix once.
 * Failures are collected rather than thrown so one locked subaccount does not
 * abandon the rest of an approved plan half-done.
 */
export async function applyTagPlan(actions: TagAction[]): Promise<TagPlanResult> {
  const failures: TagPlanResult["failures"] = [];
  let applied = 0;

  for (const action of actions) {
    try {
      if (action.type === "rename") {
        await ghlRequest("PUT", `/locations/${action.locationId}/tags/${action.tagId}`, {
          locationId: action.locationId,
          body: { name: action.to },
        });
      } else {
        await ghlRequest("DELETE", `/locations/${action.locationId}/tags/${action.tagId}`, {
          locationId: action.locationId,
        });
      }
      applied++;
    } catch (err) {
      failures.push({
        action,
        error: err instanceof Error ? err.message : "Failed",
      });
    }
  }

  // The audit is now stale whatever happened, so the next read refetches.
  tagCache = null;
  return { applied, failures };
}

/* ------------------------------------------------- best contacts right now */

export interface ScoredContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  tags: string[];
  dateAdded: string;
  score: number;
  reasons: string[];
  blocked: string;
}

export interface HotList {
  fetchedAt: string;
  locationId: string;
  locationName: string;
  scanned: number;
  contacts: ScoredContact[];
}

/**
 * Signals worth points, highest intent first.
 *
 * Deliberately built on tags the booking flow writes rather than tags people
 * type, because a hand-typed tag in this account is unreliable: the agency's own
 * cleanup plan counted 298 tags with duplicates and typos across 150
 * subaccounts. `abandoned booking` and `meeting booked` come from the form, so
 * they mean the same thing everywhere.
 */
const SIGNALS: Array<{ tag: string; points: number; why: string }> = [
  { tag: "abandoned booking", points: 50, why: "Started booking a call and stopped" },
  { tag: "website form submission", points: 20, why: "Came in through the site" },
  { tag: "mql", points: 10, why: "Marked a marketing qualified lead" },
  { tag: "sql", points: 25, why: "Marked sales qualified" },
  { tag: "follow up needed", points: 20, why: "Someone flagged it for follow up" },
  { tag: "proposal signed", points: -100, why: "Already closed" },
  { tag: "meeting booked", points: -60, why: "Already on the calendar" },
  { tag: "customer", points: -100, why: "Already a customer" },
  { tag: "current clients", points: -100, why: "Already a client" },
  { tag: "careers form submission", points: -200, why: "Job applicant, not a prospect" },
  { tag: "visual visitor", points: -40, why: "De-anonymised traffic, never opted in" },
];

// A form-filler with a company name is a business; one without is usually a
// consumer opt-in off a paid ad, and worth less on a B2B list.
const HAS_COMPANY_POINTS = 15;
const RECENT_DAYS = 45;
const RECENT_POINTS = 20;

/** Vendors pitching the agency, which look like the best leads and are not. */
const VENDOR_RE =
  /agency|advertis|marketing|\bseo\b|\bppc\b|public relations|outsourc|back office|web ?dev|digital/i;

/**
 * Score one location's contacts and return the ones worth calling.
 *
 * Runs per location rather than agency-wide: contact volumes differ by orders
 * of magnitude between subaccounts, and a single ranked list across 150 of them
 * would be dominated by whichever account is biggest rather than showing who is
 * actually hot.
 */
export async function hotContacts(
  locationId: string,
  locationName: string,
  limit = 25
): Promise<HotList> {
  const seen = new Map<string, ScoredContact>();
  let scanned = 0;

  // Only pull the tags that can earn points. Scanning every contact in a
  // 10,000-contact subaccount to score most of them at zero is wasted calls.
  const positive = SIGNALS.filter((s) => s.points > 0).map((s) => s.tag);

  for (const tag of positive) {
    let page = 1;
    for (;;) {
      let batch: Array<Record<string, unknown>> = [];
      try {
        const res = await ghlRequest<{ contacts?: Array<Record<string, unknown>> }>(
          "POST",
          "/contacts/search",
          {
            locationId,
            body: {
              locationId,
              page,
              pageLimit: 100,
              filters: [{ field: "tags", operator: "contains", value: tag }],
            },
          }
        );
        batch = res.contacts || [];
      } catch {
        break; // A tag that does not exist here is not an error worth surfacing.
      }
      if (batch.length === 0) break;
      scanned += batch.length;

      for (const c of batch) {
        const id = String(c.id || "");
        if (!id || seen.has(id)) continue;
        const tags = ((c.tags as string[]) || []).map((t) => String(t).toLowerCase());

        let score = 0;
        const reasons: string[] = [];
        for (const s of SIGNALS) {
          if (tags.includes(s.tag)) {
            score += s.points;
            reasons.push(s.points > 0 ? s.why : `${s.why} (down-ranked)`);
          }
        }

        const company = String(c.companyName || "");
        if (company) {
          score += HAS_COMPANY_POINTS;
          reasons.push("Gave a company name");
        }

        const added = String(c.dateAdded || "");
        if (added) {
          const days = (Date.now() - new Date(added).getTime()) / 86_400_000;
          if (days <= RECENT_DAYS) {
            score += RECENT_POINTS;
            reasons.push(`Came in ${Math.round(days)} days ago`);
          }
        }

        const email = String(c.email || "");
        let blocked = "";
        if (VENDOR_RE.test(`${company} ${email}`)) {
          score -= 80;
          blocked = "Looks like a vendor pitching us";
        }
        if (!email && !c.phone) blocked = blocked || "No email and no phone";

        seen.set(id, {
          id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
          email,
          phone: String(c.phone || ""),
          companyName: company,
          tags: ((c.tags as string[]) || []).map(String),
          dateAdded: added,
          score,
          reasons,
          blocked,
        });
      }

      if (batch.length < 100) break;
      page++;
      if (page > 20) break; // 2,000 per tag is far past useful.
    }
  }

  const contacts = [...seen.values()]
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || (b.dateAdded > a.dateAdded ? 1 : -1))
    .slice(0, limit);

  return {
    fetchedAt: new Date().toISOString(),
    locationId,
    locationName,
    scanned,
    contacts,
  };
}

/** Write one tag onto contacts, so a smart list can be built on it once. */
export async function tagContacts(
  locationId: string,
  contactIds: string[],
  tag: string
): Promise<{ tagged: number; failures: string[] }> {
  const failures: string[] = [];
  let tagged = 0;
  for (const id of contactIds) {
    try {
      await ghlRequest("POST", `/contacts/${id}/tags`, {
        locationId,
        body: { tags: [tag] },
      });
      tagged++;
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return { tagged, failures };
}

/* --------------------------------------------- push an email into GHL */

export interface TemplatePush {
  emailId: string;
  title: string;
  ok: boolean;
  templateId?: string;
  previewUrl?: string;
  error?: string;
}

/**
 * Create an email template in a GoHighLevel subaccount.
 *
 * Endpoint and payload match what `code/ghl-mcp/ghl-cli.js upload-template`
 * has been using in production, rather than a fresh read of the docs: this is
 * the one shape known to work against these accounts. `editorType: "html"` is
 * what keeps the template editable as raw HTML on the GoHighLevel side instead
 * of being rewritten by the drag-and-drop builder.
 */
export async function pushEmailTemplate(args: {
  locationId: string;
  name: string;
  subject: string;
  html: string;
}): Promise<{ id: string; previewUrl: string }> {
  const res = await ghlRequest<{ id?: string; previewUrl?: string }>(
    "POST",
    `/emails/public/v2/locations/${args.locationId}/templates`,
    {
      locationId: args.locationId,
      body: {
        name: args.name,
        subject: args.subject,
        editorContent: args.html,
        type: "email",
        editorType: "html",
      },
    }
  );
  return { id: String(res.id || ""), previewUrl: String(res.previewUrl || "") };
}
