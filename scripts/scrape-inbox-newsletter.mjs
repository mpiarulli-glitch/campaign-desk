#!/usr/bin/env node
/**
 * Scrapes the full archive of Max Sturtevant's "The Inbox Newsletter" into
 * src/content/inbox-newsletter.json, which powers the Knowledge channel on
 * the Lifecycle page.
 *
 * The site sits behind Cloudflare and 403s a default curl/node user agent, so
 * every request goes out with a browser UA. Content lives in a beehiiv
 * `#content-blocks` container of nested style-only divs, which we walk and
 * flatten into markdown.
 *
 * Usage:
 *   node scripts/scrape-inbox-newsletter.mjs            # full archive
 *   node scripts/scrape-inbox-newsletter.mjs --pages 3  # first 3 archive pages
 *   node scripts/scrape-inbox-newsletter.mjs --new-only # stop at first known slug
 */

import fs from "node:fs";
import path from "node:path";

const ORIGIN = "https://www.inboxnewsletter.com";
const OUT = path.join(import.meta.dirname, "..", "src", "content", "inbox-newsletter.json");
const CONCURRENCY = 4;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const args = process.argv.slice(2);
const maxPages = args.includes("--pages")
  ? Number(args[args.indexOf("--pages") + 1]) || 1
  : Infinity;
const newOnly = args.includes("--new-only");

/* ------------------------------------------------------------- fetching */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= 4) throw err;
    // Cloudflare throttles bursts. Back off rather than hammering.
    await sleep(1200 * attempt);
    return get(url, attempt + 1);
  }
}

/** Run tasks with a small concurrency cap so we stay a polite client. */
async function pool(items, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

/* --------------------------------------------------------------- parsing */

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#8217": "’",
  "#8216": "‘",
  "#8220": "“",
  "#8221": "”",
  "#8230": "…",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#\d+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
}

/** Beehiiv appends its own UTM tags to every outbound link. Strip them. */
function cleanUrl(url) {
  try {
    const u = new URL(url, ORIGIN);
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "_bhlid") u.searchParams.delete(key);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

/**
 * Slices out the inner HTML of the element whose attributes contain `marker`,
 * by balancing open and close tags of that element's own tag name.
 */
function sliceElement(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const open = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open))?.[1];
  if (!tag) return null;
  const start = html.indexOf(">", at) + 1;

  const re = new RegExp(`</?${tag}\\b`, "gi");
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

function emphasize(html, marker) {
  // inlineToMarkdown trims, so padding is detected on the raw html instead.
  const core = inlineToMarkdown(html);
  if (!core) return " ";
  const lead = /^(\s|&nbsp;)/.test(html) ? " " : "";
  const tail = /(\s|&nbsp;)$/.test(html) ? " " : "";
  return `${lead}${marker}${core}${marker}${tail}`;
}

function inlineToMarkdown(html) {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      // Markdown emphasis markers must hug the text, so any whitespace inside
      // the tag gets re-emitted outside it. Otherwise "**bold**next" collides.
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => emphasize(t, "**"))
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => emphasize(t, "_"))
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
        const label = inlineToMarkdown(t).trim();
        if (!label) return "";
        return `[${label}](${cleanUrl(href)})`;
      })
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * Walks the beehiiv content container in document order and emits markdown.
 * The container is a deep tree of presentational divs, so rather than recurse
 * we scan for the block-level tags that actually carry meaning.
 */
function contentToMarkdown(container) {
  const html = container
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  const blocks = [];
  const re =
    /<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<img\b([^>]*)>|<hr\b[^>]*>/gi;
  let m;

  while ((m = re.exec(html))) {
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const text = inlineToMarkdown(m[2]);
      if (!text) continue;
      if (tag === "li") blocks.push(`- ${text.replace(/\n/g, " ")}`);
      else if (tag === "blockquote") blocks.push(`> ${text.replace(/\n/g, "\n> ")}`);
      else if (tag === "p") blocks.push(text);
      else blocks.push(`${"#".repeat(Number(tag[1]))} ${text.replace(/\*\*/g, "")}`);
      continue;
    }
    if (m[3] !== undefined) {
      const src = /src="([^"]*)"/i.exec(m[3])?.[1];
      if (!src) continue;
      const alt = decode(/alt="([^"]*)"/i.exec(m[3])?.[1] ?? "").trim();
      blocks.push(`![${alt}](${cleanUrl(src)})`);
      continue;
    }
    blocks.push("---");
  }

  return blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function jsonLd(html) {
  const out = {};
  for (const m of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node && (node["@type"] === "Article" || node["@type"] === "NewsArticle" || node.headline)) {
          Object.assign(out, node);
        }
      }
    } catch {
      /* a malformed block is not worth failing the whole post over */
    }
  }
  return out;
}

/* ---------------------------------------------------------------- topics */

/**
 * Topic tags are derived from the text so the panel can be filtered without
 * anyone hand-tagging 300+ issues.
 */
const TOPICS = [
  ["Welcome flow", /welcome (flow|series|sequence|email)|double opt-?in/i],
  ["Retention & churn", /churn|cancel|retention|subscription|rebill|winback|win-?back|ltv/i],
  ["Abandonment", /abandon(ed)?\s*(cart|checkout|browse)|browse abandon/i],
  ["Post-purchase", /post-?purchase|order confirmation|shipping|thank you email|upsell|cross-?sell/i],
  ["Campaigns & calendar", /campaign calendar|promo(tion)?al calendar|send calendar|campaign schedule/i],
  ["Segmentation", /segment|engaged \d+|suppress|list clean/i],
  ["Deliverability", /deliverabilit|spam|inbox placement|dmarc|dkim|warm(ing|-up)|sender reputation/i],
  ["Subject lines", /subject line|preview text|preheader|open rate/i],
  ["Copywriting", /copy ?max|copywriting|body copy|headline|hero section|angle/i],
  ["Design", /design|hero image|gif|layout|template|zaymo|figma/i],
  ["A/B testing", /a\/?b test|split test|variant|test(ed|ing) (this|the)/i],
  ["Offers & pricing", /offer|discount|bundle|free (shipping|gift)|price|pricing/i],
  ["SMS", /\bsms\b|text message|attentive|postscript/i],
  ["Sign-up forms", /pop-?up|sign-?up form|lead capture|quiz|spin to win/i],
  ["Flows & automation", /\bflow(s)?\b|automation|klaviyo flow|trigger/i],
  ["Analytics & reporting", /revenue per (recipient|email)|attribution|report|analytics|welltv|benchmark/i],
  ["Agency & business", /agency|client|hiring|team|retainer|proposal|onboarding a client/i],
  ["Black Friday", /black friday|bfcm|cyber monday/i],
];

function topicsFor(title, body) {
  const hay = `${title}\n${body}`;
  const hits = TOPICS.filter(([, re]) => re.test(hay)).map(([name]) => name);
  return hits.length ? hits.slice(0, 4) : ["General"];
}

/* ------------------------------------------------------------- extraction */

const INSPO_HEADING = /^#{1,6} .*Email Inspiration Of The Day/im;
const TEMPLATE_HEADING = /^#{1,6} .*Template [Oo]f [Tt]he Day/im;

/**
 * Two recurring features sit below the main essay in most issues:
 *
 *   "Email Inspiration Of The Day" — a brand, a Drive link to the design, and
 *   Max's note on why it works.
 *   "Template of The Day" — a named template from his library, usually a image.
 *
 * Both get split out of the body so they can be browsed as their own swipe
 * file rather than being buried inside 300+ issues.
 */
function extractFeatures(markdown) {
  const inspoAt = markdown.search(INSPO_HEADING);
  const templateAt = markdown.search(TEMPLATE_HEADING);

  const cuts = [inspoAt, templateAt].filter((n) => n >= 0);
  const body = cuts.length ? markdown.slice(0, Math.min(...cuts)).trim() : markdown.trim();

  const sectionFrom = (start) => {
    if (start < 0) return "";
    const others = [inspoAt, templateAt].filter((n) => n > start);
    return markdown.slice(start, others.length ? Math.min(...others) : undefined);
  };

  const inspoSection = sectionFrom(inspoAt);
  const templateSection = sectionFrom(templateAt);

  const field = (section, label) => {
    const m = new RegExp(
      `\\*\\*${label}:?\\*\\*:?\\s*\\n+([\\s\\S]*?)(?=\\n\\n\\*\\*|\\n#{1,6} |$)`,
      "i",
    ).exec(section);
    return m ? m[1].trim() : "";
  };

  const brand = field(inspoSection, "Brand");
  const note = field(inspoSection, "Notes");
  const design = /\[?(https:\/\/drive\.google\.com\/[^\s)\]]+)/.exec(inspoSection)?.[1] ?? "";
  const inspiration = brand || design ? { brand, design, note } : null;

  // The template name is the first non-heading line of its section; the image
  // beneath it is the template itself.
  const templateLines = templateSection
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !TEMPLATE_HEADING.test(l));
  const templateName = (templateLines.find((l) => !l.startsWith("!") && !l.startsWith("#")) ?? "")
    .replace(/\*\*/g, "")
    .trim();
  const templateImage = /!\[[^\]]*\]\(([^)]+)\)/.exec(templateSection)?.[1] ?? "";
  const template = templateName || templateImage ? { name: templateName, image: templateImage } : null;

  return { inspiration, template, body };
}

/**
 * Every issue opens with the same masthead: a logo image, the words "The Inbox
 * Newsletter", and a banner. None of it is content, so drop everything above
 * the greeting when we can find one.
 */
function stripMasthead(markdown) {
  const greeting = markdown.search(/^Hey,? it['’]?s Max\b/im);
  if (greeting > 0) return markdown.slice(greeting).trim();

  // No standard greeting: drop leading image-only and masthead-caption blocks.
  const blocks = markdown.split("\n\n");
  let i = 0;
  while (
    i < blocks.length &&
    (/^!\[[^\]]*\]\([^)]*\)$/.test(blocks[i].trim()) ||
      /^The Inbox Newsletter$/i.test(blocks[i].trim()) ||
      blocks[i].trim() === "")
  ) {
    i++;
  }
  return blocks.slice(i).join("\n\n").trim();
}

/** Everything from the sign-off down is the same promo block every issue. */
function stripSignOff(markdown) {
  // Tolerant of the bolded variants Max uses interchangeably issue to issue.
  const cut = markdown.search(
    /\n\**(?:Reply to this email|Cheers,\**\s*\n+\**Max Sturtevant|P\.?S\.?\**\s*\n|Want The Full Email Marketing Playbook)/i,
  );
  return cut < 0 ? markdown.trim() : markdown.slice(0, cut).trim();
}

function summarize(body) {
  // First real paragraph after the standard greeting.
  const paras = body
    .split("\n\n")
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !p.startsWith("#") &&
        !p.startsWith("!") &&
        !/^Hey it'?s Max/i.test(p) &&
        !/^Let'?s (get into it|dive in)/i.test(p) &&
        p.length > 60,
    );
  const first = paras[0] ?? "";
  return first.replace(/[*_[\]]/g, "").slice(0, 240).trim();
}

async function scrapePost(slug) {
  const url = `${ORIGIN}/p/${slug}`;
  const html = await get(url);

  const meta = jsonLd(html);
  const container = sliceElement(html, 'id="content-blocks"');
  if (!container) throw new Error(`no content container for ${slug}`);

  const raw = contentToMarkdown(container);
  // Order matters: the sign-off sits below the recurring features, so it has to
  // go before they are split out or it lands inside the last field parsed.
  const { inspiration, template, body } = extractFeatures(stripSignOff(stripMasthead(raw)));

  const title = decode(
    meta.headline ??
      /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s*\|.*$/, "") ??
      slug,
  ).trim();

  const published = (meta.datePublished ?? meta.dateModified ?? "").slice(0, 10);
  const words = body.split(/\s+/).filter(Boolean).length;

  return {
    slug,
    url,
    title,
    published,
    summary: summarize(body),
    topics: topicsFor(title, body),
    words,
    readMinutes: Math.max(1, Math.round(words / 220)),
    body,
    inspiration,
    template,
  };
}

/* -------------------------------------------------------------- archive */

async function collectSlugs() {
  const slugs = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`${ORIGIN}/archive?page=${page}`);
    // Each card links the post twice (thumbnail + title), so dedupe per page
    // before diffing against what we have already seen.
    const found = new Set(
      [...html.matchAll(/href="(?:https:\/\/[^"]*)?\/p\/([a-z0-9-]+)"/gi)].map((m) => m[1]),
    );
    const fresh = [...found].filter((s) => !seen.has(s));
    if (fresh.length === 0) break;
    for (const s of fresh) {
      seen.add(s);
      slugs.push(s);
    }
    process.stderr.write(`archive page ${page}: ${fresh.length} posts (${slugs.length} total)\n`);
    await sleep(300);
  }
  return slugs;
}

/* ------------------------------------------------------------------ main */

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const known = new Map((existing?.entries ?? []).map((e) => [e.slug, e]));

let slugs = await collectSlugs();
if (newOnly) slugs = slugs.filter((s) => !known.has(s));

process.stderr.write(`fetching ${slugs.length} posts\n`);

let done = 0;
const failures = [];
const scraped = await pool(slugs, async (slug) => {
  try {
    const post = await scrapePost(slug);
    process.stderr.write(`  [${++done}/${slugs.length}] ${post.published} ${post.title}\n`);
    return post;
  } catch (err) {
    failures.push({ slug, error: String(err.message ?? err) });
    process.stderr.write(`  [${++done}/${slugs.length}] FAILED ${slug}: ${err.message}\n`);
    return null;
  }
});

for (const post of scraped) if (post) known.set(post.slug, post);

const entries = [...known.values()]
  .filter((e) => e.body && e.body.length > 200)
  .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: {
        name: "The Inbox Newsletter",
        author: "Max Sturtevant",
        agency: "Well Copy",
        url: ORIGIN,
      },
      scrapedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    },
    null,
    2,
  )}\n`,
);

process.stderr.write(`\nwrote ${entries.length} entries to ${OUT}\n`);
if (failures.length) {
  process.stderr.write(`${failures.length} failures:\n`);
  for (const f of failures) process.stderr.write(`  ${f.slug}: ${f.error}\n`);
}
