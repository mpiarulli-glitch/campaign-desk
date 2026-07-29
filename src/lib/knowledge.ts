/**
 * Knowledge base: the full archive of Max Sturtevant's "The Inbox Newsletter"
 * (Well Copy), scraped into src/content/inbox-newsletter.json by
 * scripts/scrape-inbox-newsletter.mjs and served to the Lifecycle console.
 *
 * The archive ships as a bundled JSON file rather than database rows so it
 * deploys with the image and needs no migration or prod seeding. Read state is
 * the only mutable part, and that lives in app_settings.
 */

import archive from "@/content/inbox-newsletter.json";
import { getDb, nowIso } from "./db";

export interface KnowledgeInspiration {
  brand: string;
  design: string;
  note: string;
}

export interface KnowledgeTemplate {
  name: string;
  image: string;
}

export interface KnowledgeEntry {
  slug: string;
  url: string;
  title: string;
  published: string;
  summary: string;
  topics: string[];
  words: number;
  readMinutes: number;
  body: string;
  inspiration: KnowledgeInspiration | null;
  template: KnowledgeTemplate | null;
}

/** List rows drop the body so the index payload stays small. */
export type KnowledgeListing = Omit<KnowledgeEntry, "body"> & { read: boolean };

export interface KnowledgeIndex {
  source: { name: string; author: string; agency: string; url: string };
  scrapedAt: string;
  total: number;
  readCount: number;
  topics: Array<{ name: string; count: number }>;
  /** The one issue to read today, rotating deterministically through the archive. */
  todaySlug: string | null;
  entries: KnowledgeListing[];
}

const DATA = archive as unknown as {
  source: KnowledgeIndex["source"];
  scrapedAt: string;
  entries: KnowledgeEntry[];
};

const ENTRIES: KnowledgeEntry[] = [...(DATA.entries ?? [])].sort((a, b) =>
  (b.published || "").localeCompare(a.published || ""),
);

const BY_SLUG = new Map(ENTRIES.map((e) => [e.slug, e]));

/* ----------------------------------------------------------- read state */

const READ_KEY = "knowledge_read_slugs";

function loadRead(): Set<string> {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(READ_KEY) as { value: string } | undefined;
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

function saveRead(slugs: Set<string>): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(READ_KEY, JSON.stringify([...slugs]), nowIso());
}

export function setRead(slug: string, read: boolean): { read: boolean } {
  if (!BY_SLUG.has(slug)) throw new Error("Unknown entry");
  const slugs = loadRead();
  if (read) slugs.add(slug);
  else slugs.delete(slug);
  saveRead(slugs);
  return { read };
}

/* ------------------------------------------------------------ today's pick */

/**
 * Deterministic daily rotation. Ordering the archive by a stable hash of each
 * slug means consecutive days serve unrelated issues, and stepping through that
 * order by day number covers every issue before any repeats.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ROTATION = [...ENTRIES].sort((a, b) => hash(a.slug) - hash(b.slug));

export function todayEntry(date = new Date()): KnowledgeEntry | null {
  if (ROTATION.length === 0) return null;
  const day = Math.floor(date.getTime() / 86_400_000);
  return ROTATION[day % ROTATION.length];
}

/* ------------------------------------------------------------------ queries */

/**
 * Punctuation is flattened to spaces on both sides so a search for
 * "days until churn" still finds "the days-until-churn chart".
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HAYSTACKS = new Map<string, string>();

function matches(entry: KnowledgeEntry, needle: string): boolean {
  if (!needle) return true;
  let hay = HAYSTACKS.get(entry.slug);
  if (hay === undefined) {
    hay = normalize(
      `${entry.title} ${entry.summary} ${entry.topics.join(" ")} ${entry.body}`,
    );
    HAYSTACKS.set(entry.slug, hay);
  }
  return hay.includes(needle);
}

export function getIndex(opts: { q?: string; topic?: string } = {}): KnowledgeIndex {
  const read = loadRead();
  const needle = normalize(opts.q ?? "");
  const topic = (opts.topic ?? "").trim();

  const counts = new Map<string, number>();
  for (const e of ENTRIES) {
    for (const t of e.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const filtered = ENTRIES.filter(
    (e) => (!topic || e.topics.includes(topic)) && matches(e, needle),
  );

  return {
    source: DATA.source,
    scrapedAt: DATA.scrapedAt,
    total: ENTRIES.length,
    readCount: [...read].filter((s) => BY_SLUG.has(s)).length,
    topics: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    todaySlug: todayEntry()?.slug ?? null,
    // Bodies are dropped here: 344 issues of full text is ~1.8MB, and the
    // reader fetches the one issue it needs by slug.
    entries: filtered.map((entry) => {
      const listing: KnowledgeListing = { ...entry, read: read.has(entry.slug) };
      delete (listing as Partial<KnowledgeEntry>).body;
      return listing;
    }),
  };
}

export function getEntry(slug: string): (KnowledgeEntry & { read: boolean }) | null {
  const entry = BY_SLUG.get(slug);
  if (!entry) return null;
  return { ...entry, read: loadRead().has(slug) };
}

export interface SwipeRow {
  slug: string;
  published: string;
  issueTitle: string;
  brand: string;
  design: string;
  note: string;
  templateName: string;
  templateImage: string;
}

/**
 * Every "Email Inspiration Of The Day" and "Template of The Day" pick across
 * the archive, newest first. Max features one real brand email per issue, which
 * adds up to a usable swipe file once they are pulled out of the issues they
 * were buried in.
 */
export function getSwipeFile(): SwipeRow[] {
  return ENTRIES.filter(
    (e) => e.inspiration?.design || e.inspiration?.brand || e.template?.image,
  ).map((e) => ({
    slug: e.slug,
    published: e.published,
    issueTitle: e.title,
    brand: e.inspiration?.brand ?? "",
    design: e.inspiration?.design ?? "",
    note: e.inspiration?.note ?? "",
    templateName: e.template?.name ?? "",
    templateImage: e.template?.image ?? "",
  }));
}
