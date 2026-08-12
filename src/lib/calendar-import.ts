// Turning a client's editorial calendar spreadsheet into planned sends.
//
// Agencies plan a year of content in a sheet, not in an app, so the sheet is the
// real source and this is the door it comes in through. Two things shape the
// design:
//
//   1. Nothing is written until a person has looked at a preview. Every import
//      is parsed, validated, and diffed against what is already on the calendar
//      first, and the same function produces the preview and the commit, so what
//      you approved is what lands.
//   2. Every created row is stamped with a batch id. An import that turns out
//      wrong is one undo, not twenty deletions.
//
// Client productions are never touched. A shoot the client booked or an admin
// briefed is real scheduling, not editorial planning, and a replace-the-range
// import must not wipe it.

import { nanoid } from "nanoid";
import { getDb, type AssetType, type SendStatus } from "./db";
import { createSend } from "./calendar";
import { clearApproval } from "./plan";
import { cell, mapColumns, parseCsv } from "./csv";

/* ------------------------------------------------------------- columns */

// Field name -> the normalized headers that mean it, best match first.
// Deliberately generous: these are the words that actually appear in client
// sheets, and a header we fail to recognise costs an admin a manual re-entry.
const COLUMN_ALIASES = {
  sendDate: ["senddate", "date", "publishdate", "postdate", "scheduleddate", "when", "day"],
  title: ["title", "campaign", "campaignname", "emailname", "name", "asset", "assetname", "topic"],
  sendTime: ["sendtime", "time", "posttime"],
  status: ["status", "state", "stage"],
  assetType: ["assettype", "type", "channel", "format", "contenttype", "medium"],
  platform: ["platform", "network", "destination"],
  audience: ["audience", "segment", "list", "targetaudience", "recipients"],
  purpose: ["purpose", "goal", "objective", "description", "angle", "details"],
  offer: ["offer", "cta", "calltoaction", "promotion", "promo", "offers"],
  subject: ["subject", "subjectline", "hook", "headline"],
  previewText: ["previewtext", "preview", "preheader", "previewline"],
  note: ["note", "notes", "internalnote", "comments", "remarks"],
} as const;

type Field = keyof typeof COLUMN_ALIASES;

// Headers we recognise but have no column of their own for. Listing them stops
// the preview reporting "Day" or "Week" as an unrecognised column and making an
// admin wonder what they lost.
const IGNORED_HEADERS = new Set([
  "day", "dayofweek", "weekday", "week", "weeknumber", "month", "quarter",
  "owner", "assignedto", "assignee", "designer", "writer", "id", "row",
]);

/* --------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rejects Feb 30 and friends rather than letting Date roll them forward.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Two-digit years: a content calendar is about now, so 26 is 2026 and never 1926.
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * A date cell as YYYY-MM-DD, or "" if it isn't a date.
 *
 * Slash and dash forms are read month-first (8/12 is August 12). Every sheet
 * this runs against is written by a US team, and a silent day-first reading
 * would move half a year of sends without anyone noticing. Unambiguous forms
 * (ISO, spelled-out months) are read as written.
 */
export function parseLooseDate(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  // ISO, and the "2026-08-12 00:00:00" that database exports produce.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return validYmd(+iso[1], +iso[2], +iso[3]) || "";

  // 8/12/2026, 08-12-26, 8.12.2026
  const numeric = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (numeric) {
    return validYmd(expandYear(+numeric[3]), +numeric[1], +numeric[2]) || "";
  }

  // Aug 12, 2026 / August 12 2026 / Wed, Aug 12, 2026
  const monthFirst = text
    // Drop a leading weekday. Matched against the weekday names specifically:
    // a generic "leading word" strip eats the month out of "Sep 1, 2026".
    .replace(/^(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+/i, "")
    .match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2,4})?$/i);
  if (monthFirst) {
    const m = MONTHS[monthFirst[1].toLowerCase()];
    const year = monthFirst[3] ? expandYear(+monthFirst[3]) : new Date().getFullYear();
    if (m) return validYmd(year, m, +monthFirst[2]) || "";
  }

  // 12 Aug 2026
  const dayFirst = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{2,4})?$/i);
  if (dayFirst) {
    const m = MONTHS[dayFirst[2].toLowerCase()];
    const year = dayFirst[3] ? expandYear(+dayFirst[3]) : new Date().getFullYear();
    if (m) return validYmd(year, m, +dayFirst[1]) || "";
  }

  // A bare Excel serial. Only in the range a real calendar date falls in, so a
  // stray "12" in a date column stays an error instead of becoming Jan 1900.
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20000 && serial <= 80000) {
      // Excel's epoch is 1899-12-30 once its non-existent 1900 leap day is
      // accounted for.
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) || "";
    }
  }

  return "";
}

/** A time cell as 24h HH:MM, or "" if it isn't a time. */
export function parseLooseTime(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const m = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\.?$/i);
  if (!m) return "";
  let hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  const suffix = (m[3] || "").toLowerCase();
  if (minute > 59) return "";
  if (suffix.startsWith("p") && hour < 12) hour += 12;
  if (suffix.startsWith("a") && hour === 12) hour = 0;
  // Without am/pm, a bare 1-7 in a marketing calendar means the afternoon.
  if (!suffix && hour >= 1 && hour <= 7) hour += 12;
  if (hour > 23) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

/* ---------------------------------------------------------- asset type */

// Reads the channel/type/platform words a sheet actually uses. Matched longest
// concept first so "video" beating "instagram" on "Instagram Reel (video)" is
// deliberate: the format drives how the work gets produced.
export function inferAssetType(...parts: string[]): AssetType | "" {
  const text = parts.join(" ").toLowerCase();
  if (!text.trim()) return "";
  if (/\bblog|article|seo post|long ?form\b/.test(text)) return "blog_post";
  if (/\bsms|text message|automation|workflow|drip|crm|flow\b/.test(text)) return "crm_automation";
  if (/\bemail|newsletter|broadcast|campaign email|e-?blast\b/.test(text)) return "email_campaign";
  if (/\breel|video|tiktok|carousel|short|yt\b/.test(text)) return "social_video_carousel";
  if (/\bsocial|instagram|\big\b|facebook|\bfb\b|linkedin|twitter|\bx\b|post|story|pinterest\b/.test(text)) {
    return "social_post";
  }
  return "";
}

const STATUS_WORDS: Record<string, SendStatus> = {
  requested: "requested",
  planned: "planned",
  plan: "planned",
  draft: "planned",
  idea: "planned",
  backlog: "planned",
  todo: "planned",
  scheduled: "scheduled",
  schedule: "scheduled",
  queued: "scheduled",
  built: "scheduled",
  ready: "scheduled",
  approved: "scheduled",
  sent: "sent",
  published: "sent",
  posted: "sent",
  live: "sent",
  complete: "sent",
  completed: "sent",
  done: "sent",
};

// An unreadable status is planned, not an error: the date and the title are what
// an import has to get right, and a sheet full of a client's own vocabulary
// should not fail on the word "Ideating".
export function inferStatus(raw: string): SendStatus {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_WORDS[key] || "planned";
}

/* -------------------------------------------------------------- parsing */

export interface ImportIssue {
  /** 1-based line in the file, so the message points at the row on screen. */
  line: number;
  message: string;
}

export interface ParsedSendRow {
  line: number;
  sendDate: string;
  title: string;
  sendTime: string;
  status: SendStatus;
  platform: string;
  assetType: AssetType | "";
  audience: string;
  purpose: string;
  offer: string;
  subject: string;
  previewText: string;
  note: string;
  /** Id of an existing send on the same date with the same title, if any. */
  duplicateOf: string | null;
}

export interface CalendarImportPreview {
  rows: ParsedSendRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Field -> the sheet header it was read from, for "we understood this as". */
  matched: Partial<Record<Field, string>>;
  /** Headers we could not place, so a mis-titled column is visible not silent. */
  unmapped: string[];
  start: string;
  end: string;
  duplicateCount: number;
  /** Editorial sends already on the calendar inside the file's date range. */
  existingInRange: number;
  /** Productions inside the range. Counted so the UI can promise not to touch them. */
  protectedInRange: number;
}

export type ImportMode = "add" | "skip_duplicates" | "replace_range";

/**
 * Parse the file on its own, with no database involved.
 *
 * Errors are per row and never abort the file: an admin fixing three bad dates
 * wants all three named at once, not one at a time.
 */
export function parseCalendarCsv(text: string): {
  rows: Omit<ParsedSendRow, "duplicateOf">[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  matched: Partial<Record<Field, string>>;
  unmapped: string[];
} {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const table = parseCsv(text);

  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "The file is empty." }], warnings, matched: {}, unmapped: [] };
  }

  const header = table[0];
  const cols = mapColumns(header, COLUMN_ALIASES);
  const matched: Partial<Record<Field, string>> = {};
  for (const field of Object.keys(COLUMN_ALIASES) as Field[]) {
    if (cols[field] >= 0) matched[field] = header[cols[field]].trim();
  }

  const usedIndexes = new Set(Object.values(cols).filter((i) => i >= 0));
  const unmapped = header
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h, i }) => h && !usedIndexes.has(i))
    .filter(({ h }) => !IGNORED_HEADERS.has(h.toLowerCase().replace(/[^a-z0-9]/g, "")))
    .map(({ h }) => h);

  if (cols.sendDate < 0) {
    errors.push({
      line: 1,
      message: "No date column found. Name one of the columns Date or Send Date.",
    });
  }
  if (cols.title < 0) {
    errors.push({
      line: 1,
      message: "No title column found. Name one of the columns Title, Campaign, or Name.",
    });
  }
  if (errors.length) return { rows: [], errors, warnings, matched, unmapped };

  const rows: Omit<ParsedSendRow, "duplicateOf">[] = [];
  const seen = new Map<string, number>(); // date + title -> line it first appeared on

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const line = r + 1;
    const rawDate = cell(row, cols.sendDate);
    const title = cell(row, cols.title);

    if (!rawDate && !title) continue; // spacer row inside the sheet

    if (!rawDate) {
      errors.push({ line, message: `"${title}" has no date.` });
      continue;
    }
    const sendDate = parseLooseDate(rawDate);
    if (!sendDate) {
      errors.push({
        line,
        message: `Could not read "${rawDate}" as a date. Use YYYY-MM-DD or M/D/YYYY.`,
      });
      continue;
    }
    if (!title) {
      errors.push({ line, message: `The row on ${sendDate} has no title.` });
      continue;
    }

    const rawTime = cell(row, cols.sendTime);
    const sendTime = parseLooseTime(rawTime);
    if (rawTime && !sendTime) {
      warnings.push({ line, message: `Ignored the time "${rawTime}" — left as no time.` });
    }

    const channel = cell(row, cols.assetType);
    const platform = cell(row, cols.platform);
    const assetType = inferAssetType(channel, platform);
    if (channel && !assetType) {
      warnings.push({
        line,
        message: `Could not tell what kind of asset "${channel}" is — asset type left unset.`,
      });
    }

    const key = `${sendDate}|${title.toLowerCase()}`;
    const firstLine = seen.get(key);
    if (firstLine) {
      warnings.push({
        line,
        message: `Same date and title as line ${firstLine} — importing both.`,
      });
    } else {
      seen.set(key, line);
    }

    rows.push({
      line,
      sendDate,
      title,
      sendTime,
      status: inferStatus(cell(row, cols.status)),
      // Keep whatever the sheet called the channel when it is not the asset type
      // itself, so the detail is not thrown away by the mapping.
      platform: platform || (assetType ? "" : channel),
      assetType,
      audience: cell(row, cols.audience),
      purpose: cell(row, cols.purpose),
      offer: cell(row, cols.offer),
      subject: cell(row, cols.subject),
      previewText: cell(row, cols.previewText),
      note: cell(row, cols.note),
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 0, message: "No rows to import — the file has headers but no data." });
  }

  return { rows, errors, warnings, matched, unmapped };
}

/* -------------------------------------------------------------- preview */

interface ExistingSend {
  id: string;
  title: string;
  send_date: string;
  requested_by_client: number;
  production_brief: string;
}

// A send that exists because of real scheduling rather than editorial planning.
// These are never replaced or deleted by an import.
function isProtected(s: ExistingSend): boolean {
  return s.requested_by_client === 1 || !!s.production_brief.trim();
}

function existingInRange(clientId: string, start: string, end: string): ExistingSend[] {
  return getDb()
    .prepare(
      `SELECT id, title, send_date, requested_by_client, production_brief
       FROM scheduled_sends
       WHERE client_id = ? AND send_date >= ? AND send_date <= ?`
    )
    .all(clientId, start, end) as ExistingSend[];
}

/** Parse a file and diff it against what the client already has on the calendar. */
export function previewCalendarImport(
  clientId: string,
  text: string
): CalendarImportPreview {
  const parsed = parseCalendarCsv(text);
  const base: CalendarImportPreview = {
    rows: [],
    errors: parsed.errors,
    warnings: parsed.warnings,
    matched: parsed.matched,
    unmapped: parsed.unmapped,
    start: "",
    end: "",
    duplicateCount: 0,
    existingInRange: 0,
    protectedInRange: 0,
  };
  if (!parsed.rows.length) return base;

  const dates = parsed.rows.map((r) => r.sendDate).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const existing = existingInRange(clientId, start, end);

  // Same day, same title, case and whitespace insensitive. Re-importing a
  // corrected sheet is the normal case, so it has to be recognised.
  const byKey = new Map<string, string>();
  for (const s of existing) {
    if (isProtected(s)) continue;
    byKey.set(`${s.send_date}|${s.title.trim().toLowerCase()}`, s.id);
  }

  const rows: ParsedSendRow[] = parsed.rows.map((r) => ({
    ...r,
    duplicateOf: byKey.get(`${r.sendDate}|${r.title.toLowerCase()}`) || null,
  }));

  return {
    ...base,
    rows,
    start,
    end,
    duplicateCount: rows.filter((r) => r.duplicateOf).length,
    existingInRange: existing.filter((s) => !isProtected(s)).length,
    protectedInRange: existing.filter(isProtected).length,
  };
}

/* ---------------------------------------------------------------- apply */

export interface CalendarImportResult {
  ok: boolean;
  error?: string;
  batchId: string;
  created: number;
  skipped: number;
  deleted: number;
  /** Rows the file could not offer, reported so a partial import says so. */
  failed: number;
  start: string;
  end: string;
  /** Set when the client had already signed off and the plan just changed. */
  approvalCleared: boolean;
}

/**
 * Write the import.
 *
 * The whole thing is one transaction: a file that fails halfway leaves the
 * calendar exactly as it was rather than half-imported, which is the state
 * nobody can reason about.
 *
 * Because the plan just changed, any client sign-off on it is cleared. An
 * "Approved" badge over a calendar the client has not seen is worse than no
 * badge at all.
 */
export function applyCalendarImport(
  clientId: string,
  text: string,
  mode: ImportMode
): CalendarImportResult {
  const preview = previewCalendarImport(clientId, text);
  const empty = {
    batchId: "",
    created: 0,
    skipped: 0,
    deleted: 0,
    failed: preview.errors.length,
    start: preview.start,
    end: preview.end,
    approvalCleared: false,
  };
  // Row-level errors do not block the file. Three bad dates in a hundred-row sheet
  // should import the ninety-seven and name the three, which is what the preview
  // already told the admin would happen — refusing the lot instead made a whole
  // year's calendar hostage to one typo. A file with nothing parseable at all is
  // the only real failure, and that is what a header error produces.
  if (!preview.rows.length) {
    return {
      ok: false,
      error: preview.errors[0]?.message || "Nothing to import.",
      ...empty,
    };
  }

  const db = getDb();
  const batchId = `imp_${nanoid(10)}`;
  let created = 0;
  let skipped = 0;
  let deleted = 0;

  const run = db.transaction(() => {
    if (mode === "replace_range") {
      // Clear the editorial slice of the window and rebuild it from the sheet.
      // Productions are excluded by the WHERE clause, not by filtering after the
      // fact, so there is no path where a shoot gets caught in this.
      deleted = db
        .prepare(
          `DELETE FROM scheduled_sends
           WHERE client_id = ? AND send_date >= ? AND send_date <= ?
             AND requested_by_client = 0 AND TRIM(production_brief) = ''`
        )
        .run(clientId, preview.start, preview.end).changes;
    }

    for (const row of preview.rows) {
      // In replace mode the old rows are already gone, so a "duplicate" from the
      // preview is stale and must not cause a skip.
      if (mode === "skip_duplicates" && row.duplicateOf) {
        skipped++;
        continue;
      }
      createSend({
        clientId,
        title: row.title,
        sendDate: row.sendDate,
        sendTime: row.sendTime,
        status: row.status,
        platform: row.platform,
        assetType: row.assetType,
        audience: row.audience,
        purpose: row.purpose,
        offer: row.offer,
        subject: row.subject,
        previewText: row.previewText,
        note: row.note,
        importBatch: batchId,
      });
      created++;
    }
  });
  run();

  const approvalCleared = created > 0 || deleted > 0 ? clearApproval(clientId) : false;

  return {
    ok: true,
    batchId,
    created,
    skipped,
    deleted,
    failed: preview.errors.length,
    start: preview.start,
    end: preview.end,
    approvalCleared,
  };
}

/* ----------------------------------------------------------------- undo */

export interface ImportBatch {
  batchId: string;
  count: number;
  firstDate: string;
  lastDate: string;
  importedAt: string;
}

/**
 * The client's import batches, newest first.
 *
 * Derived from the sends themselves rather than kept in a table of its own: a
 * batch only exists as long as its rows do, so a batch whose sends were all
 * deleted by hand disappears from the undo list on its own.
 */
export function listImportBatches(clientId: string, limit = 5): ImportBatch[] {
  return getDb()
    .prepare(
      `SELECT import_batch AS batchId, COUNT(*) AS count,
              MIN(send_date) AS firstDate, MAX(send_date) AS lastDate,
              MAX(created_at) AS importedAt
       FROM scheduled_sends
       WHERE client_id = ? AND import_batch <> ''
       GROUP BY import_batch
       ORDER BY importedAt DESC
       LIMIT ?`
    )
    .all(clientId, limit) as ImportBatch[];
}

/**
 * Undo an import.
 *
 * Scoped to the client as well as the batch so a stale batch id from another
 * account cannot delete rows here. Sends the team has since edited by hand are
 * still removed: the batch is the unit of undo, and pretending otherwise would
 * leave a half-reverted calendar.
 */
export function undoCalendarImport(
  clientId: string,
  batchId: string
): { ok: boolean; deleted: number } {
  if (!batchId) return { ok: false, deleted: 0 };
  const deleted = getDb()
    .prepare(`DELETE FROM scheduled_sends WHERE client_id = ? AND import_batch = ?`)
    .run(clientId, batchId).changes;
  if (deleted > 0) clearApproval(clientId);
  return { ok: deleted > 0, deleted };
}

/* ------------------------------------------------------------- template */

// The starter file offered next to the upload control. Column names here are the
// first alias of each field, so a sheet built from this always maps cleanly.
export const CSV_TEMPLATE = [
  "Date,Title,Time,Channel,Status,Audience,Purpose,Offer,Subject Line,Preview Text,Notes",
  '2026-09-01,September newsletter,10:00,Email,Planned,Full list,Monthly value newsletter,,"The 3 emails every local business should send",A quick roundup you can copy this month.,',
  "2026-09-04,Fall tune-up promo,,Email,Planned,Past customers,Drive booked jobs,$50 off a fall tune-up,Your furnace called. It wants a checkup.,Booking up fast for October.,Pair with the paid social push",
  "2026-09-08,Behind the scenes at the shop,,Instagram Reel,Planned,Followers,Build trust,,,,Use footage from the August shoot",
  "2026-09-15,How often should you service your HVAC,,Blog,Planned,Organic,SEO + answer a common question,,,,Target: hvac service frequency",
  "",
].join("\n");

export function csvTemplate(): string {
  return CSV_TEMPLATE;
}
