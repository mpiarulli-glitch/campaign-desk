// Reading a signed contract's scope of work into snapshot deliverables.
//
// The weekly snapshot only tells the truth if the deliverable list matches what
// the client actually bought, and today that list is retyped by hand off a PDF —
// which is how an account ends up tracking four blog posts a month against a
// contract that says two.
//
// This reads the contract and *proposes*. Nothing is written from the parse: the
// output is candidates with the line each came from, an admin edits them in a
// table, and the save takes the edited rows. That ordering is the whole design.
// Contract language is too varied to trust a parser with, but it is regular
// enough that reviewing a filled-in table beats typing thirty rows from scratch.

import { getDb } from "./db";
import { isTeam } from "./people";
import { createDeliverable, type CadenceUnit, type DeliverableKind } from "./snapshot";

/* ------------------------------------------------------------ categories */

// Heading or deliverable wording -> the category and owning team we file it
// under. Order matters: the first match wins, so the specific patterns come
// before the general ones ("blog" before "content").
//
// Every noun allows a plural or gerund ending. A contract writes "4 emails per
// month" and "12 social posts", so an exact `\bemail\b` matches the heading and
// misses every line under it.
const S = "(?:s|es|ing)?";
const CATEGORY_RULES: Array<{
  test: RegExp;
  category: string;
  team: "" | "email" | "seo" | "social" | "web";
}> = [
  { test: new RegExp(`\\b(email${S}|newsletter${S}|broadcast${S}|klaviyo|mailchimp|e-?blast${S}|drip|lifecycle)\\b`, "i"), category: "Email", team: "email" },
  { test: /\b(sms|text messages?|texts?)\b/i, category: "SMS", team: "email" },
  { test: new RegExp(`\\b(crm|automation${S}|workflow${S}|pipeline${S}|nurture|go ?high ?level|ghl|flow${S})\\b`, "i"), category: "CRM & Automation", team: "email" },
  { test: new RegExp(`\\b(blog${S}|article${S}|seo|keyword${S}|backlink${S}|on-?page|search engine|gbp|google business)\\b`, "i"), category: "SEO", team: "seo" },
  { test: new RegExp(`\\b(social|instagram|facebook|tiktok|linkedin|reel${S}|stor(?:y|ies)|post${S}|community management)\\b`, "i"), category: "Social", team: "social" },
  { test: new RegExp(`\\b(website${S}|web ?site${S}|landing page${S}|webpage${S}|wordpress|shopify|hosting|web design|web dev)\\b`, "i"), category: "Web", team: "web" },
  { test: new RegExp(`\\b(video${S}|photo${S}|shoot${S}|production${S}|videograph\\w*|content capture)\\b`, "i"), category: "Production", team: "social" },
  { test: /\b(ads?|advertising|ppc|paid|google ads|meta ads|adwords)\b/i, category: "Paid Media", team: "" },
  { test: new RegExp(`\\b(report${S}|analytics|dashboard${S}|kpi${S})\\b`, "i"), category: "Reporting", team: "" },
  { test: new RegExp(`\\b(strategy|strategic|consult\\w*|meeting${S}|call${S}|review session${S}|planning)\\b`, "i"), category: "Strategy", team: "" },
  { test: new RegExp(`\\b(brand\\w*|logo${S}|design${S}|creative|graphic${S})\\b`, "i"), category: "Creative", team: "" },
];

function classify(text: string): { category: string; team: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(text)) return { category: rule.category, team: rule.team };
  }
  return { category: "", team: "" };
}

/* --------------------------------------------------------------- sections */

// Headings that open the part of a contract worth reading.
const SCOPE_START =
  /^\s*(?:\d+[.)]\s*)?(scope of (?:work|services)|deliverables?|services (?:provided|included|rendered)|what(?:'s| is) included|monthly (?:services|deliverables|scope)|services? (?:&|and) deliverables?|statement of work|our services|inclusions)\b/i;

// Headings that close it. Everything past here is legal and commercial terms,
// and reading them produces deliverables like "Late fees" and "Governing law".
const SCOPE_END =
  /^\s*(?:\d+[.)]\s*)?(payment|fees?\b|investment|pricing|compensation|term(?:s)?(?:\s+and\s+termination)?\b|termination|cancellation|confidential|non-?disclosure|intellectual property|ownership|governing law|liability|indemnif|warrant|dispute|force majeure|entire agreement|signature|acceptance|in witness|acknowledge?ment)\b/i;

/* ---------------------------------------------------------------- cadence */

interface Cadence {
  cadence: string; // as written, for the admin to read back
  unit: CadenceUnit;
  quantity: number | null;
  kind: DeliverableKind;
  /** Set when the contract's cadence has no exact equivalent in the app. */
  note?: string;
}

const ONE_TIME =
  /\b(one[- ]?time|onboard(?:ing)?|set[- ]?up|setup|initial|kick[- ]?off|launch|migration|implementation|installation|audit|build[- ]?out|initial build|discovery)\b/i;

// Words that mean the item repeats but say nothing about how often.
const BARE_RECURRING = /\b(ongoing|continuous|as needed|throughout|recurring)\b/i;

/**
 * Read the cadence out of one scope line.
 *
 * Returns monthly as the fallback because a monthly retainer is what these
 * contracts are, and monthly is also the least punishing guess: the behind
 * report only flags a monthly item once the month is actually over.
 */
export function parseCadence(line: string): Cadence {
  const text = line.toLowerCase();

  // "4 per month", "2x/mo", "8 a month", "4 blog posts per month"
  const perUnit = text.match(
    /(\d+)\s*(?:x|times)?\s*(?:[a-z\s]{0,24}?)\s*(?:per|\/|a|each|every)\s*(week|wk|month|mo|quarter|qtr|year|yr)\b/
  );
  if (perUnit) {
    const qty = Number(perUnit[1]);
    const raw = perUnit[2];
    const unit: CadenceUnit = /^(week|wk)$/.test(raw)
      ? "weekly"
      : /^(quarter|qtr)$/.test(raw)
        ? "quarterly"
        : /^(year|yr)$/.test(raw)
          ? "quarterly"
          : "monthly";
    const period = /^(week|wk)$/.test(raw)
      ? "week"
      : /^(quarter|qtr)$/.test(raw)
        ? "quarter"
        : /^(year|yr)$/.test(raw)
          ? "year"
          : "month";
    return {
      cadence: `${qty} per ${period}`,
      unit,
      quantity: qty,
      kind: "recurring",
      note:
        period === "year"
          ? "The contract says yearly. The app tracks weekly, monthly, or quarterly, so this is set to quarterly."
          : undefined,
    };
  }

  // "every other week", "bi-weekly", "twice monthly"
  if (/\b(bi-?weekly|every other week|every 2 weeks|fortnightly)\b/.test(text)) {
    return { cadence: "Every other week", unit: "weekly", quantity: null, kind: "recurring" };
  }
  if (/\b(twice|2x)\s*(a|per)?\s*month(ly)?\b/.test(text)) {
    return { cadence: "2 per month", unit: "monthly", quantity: 2, kind: "recurring" };
  }
  if (/\bweekly\b/.test(text)) {
    return { cadence: "Weekly", unit: "weekly", quantity: null, kind: "recurring" };
  }
  if (/\bquarterly\b/.test(text)) {
    return { cadence: "Quarterly", unit: "quarterly", quantity: null, kind: "recurring" };
  }
  if (/\b(monthly|per month|each month)\b/.test(text)) {
    return { cadence: "Monthly", unit: "monthly", quantity: null, kind: "recurring" };
  }
  if (/\b(annual(ly)?|yearly|per year)\b/.test(text)) {
    return {
      cadence: "Annually",
      unit: "quarterly",
      quantity: null,
      kind: "recurring",
      note: "The contract says annually. The app tracks weekly, monthly, or quarterly, so this is set to quarterly.",
    };
  }
  if (/\b(daily|every day|5x per week)\b/.test(text)) {
    return { cadence: "Daily", unit: "weekly", quantity: null, kind: "recurring", note: "Daily has no exact match; set to weekly." };
  }

  // One-time wording is only decisive once no repeating cadence was found: a
  // line like "monthly SEO audit" is recurring work, not a setup task.
  if (ONE_TIME.test(text)) {
    return { cadence: "One-time", unit: "monthly", quantity: null, kind: "one_time" };
  }
  if (BARE_RECURRING.test(text)) {
    return { cadence: "Ongoing", unit: "monthly", quantity: null, kind: "recurring" };
  }

  return { cadence: "", unit: "monthly", quantity: null, kind: "recurring" };
}

/* ------------------------------------------------------------- candidates */

export interface DeliverableCandidate {
  name: string;
  category: string;
  team: string;
  cadence: string;
  kind: DeliverableKind;
  cadenceUnit: CadenceUnit;
  /** The contract line this came from, shown next to the row under review. */
  sourceLine: string;
  /** Low when the line had no cadence and no bullet — most likely to be wrong. */
  confidence: "high" | "low";
  /** Id of an active deliverable with the same name, if the account has one. */
  existingId: string | null;
  /** Anything the parse had to approximate, surfaced on the row. */
  note?: string;
}

export interface ContractTerms {
  monthlyRetainer: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  termMonths: number | null;
}

export interface ContractParseResult {
  candidates: DeliverableCandidate[];
  terms: ContractTerms;
  /** True when a scope-of-work heading was found and used to narrow the read. */
  foundScopeSection: boolean;
  warnings: string[];
  /** Character count of the text we read, so a thin extraction is visible. */
  textLength: number;
}

const BULLET = /^\s*(?:[•·▪◦‣*+–-]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i;

// Page furniture, signature blocks, and money lines. None of these are scope,
// and all of them survive into the extracted text.
const NOT_A_DELIVERABLE = [
  /^page \d+( of \d+)?$/i,
  /^\d+ of \d+$/i,
  /^[\d\s./,-]+$/, // a bare date or number
  /^\$[\d,.]+$/,
  // Signature-block labels. The colon or rule line is required, because the bare
  // words are also section headings: a scope of work headed "Email" was being
  // thrown away here, which cost every deliverable under it its category.
  /^(signature|signed|date|name|title|by|printed name|company|client|agency|address|email|phone)\s*(?::|_{2,})[\s_]*$/i,
  /^(exhibit|appendix|schedule|attachment)\s+[a-z0-9]/i,
  /^(total|subtotal|tax|due|balance|invoice)\b/i,
  /^https?:\/\//i,
  /@/, // an email address line
];

function isNoise(line: string): boolean {
  return NOT_A_DELIVERABLE.some((re) => re.test(line.trim()));
}

// A heading rather than a deliverable: short, no sentence punctuation, and
// either ending in a colon or written in title/upper case.
function isHeading(line: string): boolean {
  const text = line.trim();
  if (text.length > 60 || text.length < 3) return false;
  if (BULLET.test(line)) return false;
  if (text.endsWith(":")) return true;
  if (/[.!?,;]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 6) return false;
  const isUpper = text === text.toUpperCase() && /[A-Z]/.test(text);
  const isTitle = words.every((w) => /^[^a-z]/.test(w) || w.length <= 3);
  return isUpper || isTitle;
}

// Strip the cadence off the end of a name so the row does not read
// "Blog posts - 4 per month  |  4 per month". Cadence lives in its own column.
function cleanName(line: string): string {
  return line
    .replace(BULLET, "")
    .replace(/\s*[([]\s*(?:\d+\s*(?:x|times)?\s*)?(?:per|\/|a|each)?\s*(?:week|month|quarter|year|mo|wk|qtr)s?\s*[)\]]\s*$/i, "")
    .replace(/\s*[-–—:,]\s*(?:\d+\s*(?:x|times)?\s*)?(?:per|\/|a|each|every)?\s*(?:week|month|quarter|year|mo|wk|qtr)(?:ly)?s?\s*$/i, "")
    .replace(/\s*[-–—:,]\s*(?:weekly|monthly|quarterly|annually|bi-?weekly|ongoing|one[- ]?time)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "")
    .trim();
}

/** Active deliverable names for the account, lowercased, to spot re-imports. */
function existingByName(clientId: string): Map<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT id, name FROM snapshot_deliverables WHERE client_id = ? AND active = 1`
    )
    .all(clientId) as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
}

/* ------------------------------------------------------------------ terms */

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const DATE_WORDS =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toYmd(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const y = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return `${y}-${String(+slash[1]).padStart(2, "0")}-${String(+slash[2]).padStart(2, "0")}`;
  }
  const words = text.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (words) {
    const m = MONTH_NUM[words[1].toLowerCase()];
    if (m) return `${words[3]}-${String(m).padStart(2, "0")}-${String(+words[2]).padStart(2, "0")}`;
  }
  return null;
}

/**
 * The commercial terms, read from the whole document rather than the scope
 * section: a retainer amount and a start date are usually stated in the payment
 * terms, which is exactly the part the scope read excludes.
 */
export function parseContractTerms(text: string): ContractTerms {
  const out: ContractTerms = {
    monthlyRetainer: null,
    contractStart: null,
    contractEnd: null,
    termMonths: null,
  };

  // A labelled monthly amount is worth far more than the first dollar figure in
  // the document, which is as likely to be a late fee or a discount.
  const labelled = text.match(
    /(?:monthly|month(?:ly)?\s+(?:retainer|fee|investment|rate|amount)|retainer|management fee)[^\n$]{0,40}\$\s?([\d,]+(?:\.\d{2})?)/i
  );
  const perMonth = text.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*(?:\/|per\s+)mo(?:nth)?\b/i);
  const amount = labelled?.[1] || perMonth?.[1];
  if (amount) out.monthlyRetainer = parseMoney(amount);

  // The words that can sit between the label and the date: "ends on 8/31/2027",
  // "expires by Aug 31", "effective as of September 1". Written once and shared,
  // because leaving it off one branch is how "ends on <date>" silently failed to
  // match while "ending <date>" worked.
  const CONNECTOR = `(?:\\s+(?:date|on|by|at|as\\s+of|of))?\\W{0,15}`;

  const start = text.match(
    new RegExp(
      `(?:effective|start(?:ing|s)?|commenc\\w+|begins?|term\\s+begins)${CONNECTOR}${DATE_WORDS.source}`,
      "i"
    )
  );
  if (start) out.contractStart = toYmd(start[1]);

  const end = text.match(
    new RegExp(
      `(?:end(?:ing|s)?|expir\\w+|through|until|terminates?)${CONNECTOR}${DATE_WORDS.source}`,
      "i"
    )
  );
  if (end) out.contractEnd = toYmd(end[1]);

  const term = text.match(/\b(\d{1,2})[-\s]?month\s+(?:term|agreement|commitment|contract|engagement)\b/i);
  if (term) out.termMonths = Number(term[1]);

  return out;
}

/* --------------------------------------------------------------- the parse */

/**
 * Read a contract's text into deliverable candidates.
 *
 * The scope section is used when the document names one, because a contract's
 * legal boilerplate produces convincing nonsense otherwise. Without one, the
 * whole document is read but only lines carrying a cadence or a bullet are
 * proposed, which trades some recall for not burying the admin.
 */
export function parseContractText(
  clientId: string,
  raw: string
): ContractParseResult {
  const warnings: string[] = [];
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((l) => l.trim());

  // Narrow to the scope section if the contract labels one.
  let from = 0;
  let to = lines.length;
  let foundScopeSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (SCOPE_START.test(lines[i])) {
      from = i + 1;
      foundScopeSection = true;
      break;
    }
  }
  if (foundScopeSection) {
    for (let i = from; i < lines.length; i++) {
      if (SCOPE_END.test(lines[i])) {
        to = i;
        break;
      }
    }
    // A "scope" heading immediately followed by the payment terms means the
    // heading was a table-of-contents entry, not the section itself.
    if (to - from < 2) {
      warnings.push(
        "Found a scope-of-work heading but almost nothing under it, so the whole document was read instead."
      );
      from = 0;
      to = lines.length;
      foundScopeSection = false;
    }
  } else {
    warnings.push(
      "No scope-of-work heading found, so only lines with a cadence or a bullet were proposed. Check for anything missing."
    );
  }

  const existing = existingByName(clientId);
  const candidates: DeliverableCandidate[] = [];
  const seen = new Set<string>();
  let heading = "";

  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (!line || isNoise(line)) continue;

    if (isHeading(line)) {
      heading = line.replace(/:$/, "").trim();
      continue;
    }

    // Prose, not a list item. A scope line is a phrase; a paragraph this long is
    // the agreement talking about itself.
    if (line.length > 180) continue;
    // A full sentence with no bullet and no cadence is prose too.
    const bulleted = BULLET.test(line);
    const cadence = parseCadence(line);
    const hasCadence = cadence.cadence !== "";
    if (!bulleted && !hasCadence) continue;
    if (!foundScopeSection && !bulleted && !hasCadence) continue;

    const name = cleanName(line);
    if (name.length < 3 || name.length > 120) continue;
    // A line that is only a cadence word ("Monthly:") is a heading in disguise.
    if (/^(weekly|monthly|quarterly|annually|ongoing|one[- ]?time)$/i.test(name)) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // The heading classifies better than the line when the line is terse
    // ("2 per month" under "Email Marketing"), and the line wins otherwise.
    const fromLine = classify(name);
    const fromHeading = classify(heading);
    const category = fromLine.category || fromHeading.category || heading || "Other";
    const team = fromLine.team || fromHeading.team;

    candidates.push({
      name,
      category,
      team: isTeam(team) ? team : "",
      cadence: cadence.cadence,
      kind: cadence.kind,
      cadenceUnit: cadence.unit,
      sourceLine: line,
      confidence: hasCadence && bulleted ? "high" : hasCadence || bulleted ? "high" : "low",
      existingId: existing.get(key) || null,
      note: cadence.note,
    });
  }

  if (!candidates.length) {
    warnings.push(
      "No deliverables could be read out of this document. Paste the scope of work as text, or add the rows by hand."
    );
  }

  return {
    candidates,
    terms: parseContractTerms(text),
    foundScopeSection,
    warnings,
    textLength: text.length,
  };
}

/* --------------------------------------------------------------- applying */

export interface DeliverableInput {
  name: string;
  category?: string;
  team?: string;
  cadence?: string;
  kind?: DeliverableKind;
  cadenceUnit?: CadenceUnit;
}

/**
 * Create the rows the admin approved.
 *
 * One transaction, so a bad row cannot leave half a scope of work on the
 * account. Duplicates by name are skipped rather than merged: an admin who wants
 * an existing deliverable changed edits it in place, and silently rewriting one
 * from a contract import would throw away its cadence history.
 */
export function applyContractDeliverables(
  clientId: string,
  rows: DeliverableInput[]
): { created: number; skipped: number } {
  const existing = existingByName(clientId);
  let created = 0;
  let skipped = 0;

  const run = getDb().transaction(() => {
    for (const row of rows) {
      const name = (row.name || "").trim();
      if (!name) {
        skipped++;
        continue;
      }
      if (existing.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      createDeliverable({
        clientId,
        category: row.category || "",
        team: row.team || "",
        name,
        cadence: row.cadence || "",
        kind: row.kind === "one_time" ? "one_time" : "recurring",
        cadenceUnit: row.cadenceUnit,
      });
      // Guards against the same name appearing twice in one submission.
      existing.set(name.toLowerCase(), "new");
      created++;
    }
  });
  run();

  return { created, skipped };
}
