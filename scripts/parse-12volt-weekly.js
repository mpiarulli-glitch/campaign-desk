#!/usr/bin/env node
/**
 * Parse the 12 Volt Power weekly roadmap sheet (Google Sheets HTML export) and
 * push per-week entries for the last 3 months (May, June, July 2026) into the
 * live Campaign Desk snapshot on Railway.
 *
 * Each populated Wk1..Wk5 cell becomes its own dated entry (keyed to that
 * week's Monday). The month's Status chip, Next Steps and Notes columns are
 * folded in too.
 *
 * Usage:
 *   node scripts/parse-12volt-weekly.js            # dry run (prints what it found)
 *   node scripts/parse-12volt-weekly.js --commit   # push to Railway
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SRC =
  process.env.SHEET ||
  path.join(os.homedir(), "Downloads", "Weekly Client Snapshot", "12 Volt Power.html");
const URL = process.env.CAMPAIGN_DESK_URL || "https://campaign-desk-production.up.railway.app";
const PASSWORD = process.env.CAMPAIGN_DESK_PASSWORD || "Marketingeg1!";
const COMMIT = process.argv.includes("--commit");
const MONTHS = ["May", "June", "July"]; // last 3 months
const YEAR = 2026;

/* ----------------------------------------------------------- HTML helpers */

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", bull: "•" };
function decode(s) {
  return s
    .replace(/&(amp|lt|gt|quot|#39|nbsp|bull);/g, (_, e) => ENT[e] || " ")
    .replace(/ /g, " ");
}
// text content of an html fragment, tags stripped, <br> -> space
function textOf(html) {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

const STATUS_MAP = new Map([
  ["completed", "completed"],
  ["share & approved", "approved"],
  ["shared & approved", "approved"],
  ["approved", "approved"],
  ["shared & not yet approved", "shared"],
  ["shared - not yet approved", "shared"],
  ["not yet approved", "shared"],
  ["not shared", "shared"],
  ["shared", "shared"],
  ["shared — awaiting approval", "shared"],
  ["in progress", "in_progress"],
  ["ongoing", "in_progress"],
  ["assigned", "not_started"],
  ["on hold", "not_started"],
]);
const isPlaceholder = (t) => !t || /^[â—\-–—\s]+$/.test(t);

// Given a <td>'s inner html, return { chipStatus, work }
// chipStatus = a normalized status if the cell holds a status chip
// work = human text (link titles kept, status-chip text and dash placeholders dropped)
function parseCell(inner) {
  let chipStatus = null;
  const chips = [];
  inner.replace(/<span class="s19"[^>]*>([\s\S]*?)<\/span>/gi, (m, body) => {
    chips.push(body);
    return "";
  });
  for (const body of chips) {
    const hasLink = /<a\b/i.test(body);
    const label = textOf(body);
    if (hasLink) continue; // link chip -> keep as work text (handled below)
    const norm = label.toLowerCase().replace(/\s+/g, " ").trim();
    if (STATUS_MAP.has(norm)) chipStatus = STATUS_MAP.get(norm);
    // else placeholder dash -> ignore
  }
  // work text = whole cell text, minus any pure status-chip labels
  let work = textOf(inner);
  if (chipStatus) {
    // remove the status label words from work (they equal the chip text)
    for (const body of chips) {
      if (!/<a\b/i.test(body)) {
        const label = textOf(body);
        if (label && STATUS_MAP.has(label.toLowerCase())) {
          work = work.replace(label, "").trim();
        }
      }
    }
  }
  if (isPlaceholder(work)) work = "";
  return { chipStatus, work };
}

/* ------------------------------------------------------------- grid build */

function parseRows(html) {
  const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tbody))) {
    const cells = [];
    const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = tdRe.exec(m[1]))) {
      const attrs = c[1];
      if (/row-header|freezebar/.test(attrs) && !/class="s\d/.test(attrs)) {
        // row-header / freezebar spacer cells still occupy a column
        cells.push({ colspan: 1, rowspan: 1, inner: "", spacer: true });
        continue;
      }
      const cs = parseInt((attrs.match(/colspan="(\d+)"/) || [])[1] || "1", 10);
      const rs = parseInt((attrs.match(/rowspan="(\d+)"/) || [])[1] || "1", 10);
      cells.push({ colspan: cs, rowspan: rs, inner: c[2] });
    }
    rows.push(cells);
  }
  return rows;
}

// expand into grid[r][c] = inner html (colspan/rowspan filled by repeating source)
function buildGrid(rows) {
  const grid = [];
  const carry = []; // {colStart, colEnd, remaining, inner}
  for (let r = 0; r < rows.length; r++) {
    const line = [];
    let col = 0;
    const put = (inner) => {
      line[col] = inner;
      col++;
    };
    const active = carry.filter((x) => x.remaining > 0);
    let ci = 0;
    for (const cell of rows[r]) {
      // fill any carried rowspan columns at this position
      while (active[ci] && active[ci].col === col) {
        line[col] = active[ci].inner;
        active[ci].remaining--;
        col++;
        ci++;
      }
      // colspan: text lands only in the first column, continuations are blank
      for (let k = 0; k < cell.colspan; k++) put(k === 0 ? cell.inner : "");
      if (cell.rowspan > 1) {
        for (let k = 0; k < cell.colspan; k++) {
          carry.push({ col: col - cell.colspan + k, remaining: cell.rowspan - 1, inner: k === 0 ? cell.inner : "" });
        }
      }
    }
    // trailing carried cols
    while (active[ci]) {
      if (active[ci].col >= col) {
        line[active[ci].col] = active[ci].inner;
        active[ci].remaining--;
      }
      ci++;
    }
    grid.push(line);
  }
  return grid;
}

/* ------------------------------------------------------------ date helper */

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function firstMondayOfMonth(year, monthIdx0) {
  const d = new Date(year, monthIdx0, 1);
  const day = d.getDay(); // 0 Sun..6 Sat
  const add = day === 1 ? 0 : (8 - day) % 7; // days until Monday
  d.setDate(1 + add);
  return d;
}
function weekMonday(year, monthIdx0, weekN) {
  const d = firstMondayOfMonth(year, monthIdx0);
  d.setDate(d.getDate() + (weekN - 1) * 7);
  return ymd(d);
}
const MONTH_IDX = { January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11 };

/* ------------------------------------------------------------------- main */

async function api(method, p, body, cookieRef) {
  const res = await fetch(URL + p, {
    method,
    headers: { "Content-Type": "application/json", ...(cookieRef.v ? { Cookie: cookieRef.v } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookieRef.v = sc.split(";")[0];
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${txt}`);
  return j;
}

const normName = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function main() {
  const html = fs.readFileSync(SRC, "utf8");
  const rows = parseRows(html);
  const grid = buildGrid(rows);

  // locate header rows
  let monthRow = -1;
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].some((h) => h && /In Progress:/i.test(h))) { monthRow = r; break; }
  }
  const wkRow = monthRow + 1;
  const width = Math.max(grid[monthRow].length, grid[wkRow].length);

  // column -> { month, kind }. The month header only spans the 5 Wk columns, so
  // the Status/Next Steps/Notes columns inherit the month to their left.
  const colInfo = [];
  let lastMonth = null;
  for (let c = 0; c < width; c++) {
    const mh = grid[monthRow][c] ? textOf(grid[monthRow][c]) : "";
    const monthMatch = mh.match(/In Progress:\s*([A-Za-z]+)/);
    if (monthMatch) lastMonth = monthMatch[1];
    const sub = grid[wkRow][c] ? textOf(grid[wkRow][c]) : "";
    let kind = null;
    const wk = sub.match(/^Wk(\d)/);
    if (wk) kind = { week: parseInt(wk[1], 10) };
    else if (/^Status/i.test(sub)) kind = { status: true };
    else if (/^Next Steps/i.test(sub)) kind = { next: true };
    else if (/^Notes/i.test(sub)) kind = { notes: true };
    // A "Notes" column marks the end of a month block; clear month after it.
    colInfo.push({ month: kind ? lastMonth : null, kind });
    if (kind && kind.notes) lastMonth = null;
  }

  // For each target month, take the FIRST occurrence block of columns
  const monthCols = {}; // month -> {weeks:{n:col}, status, next, notes}
  for (const M of MONTHS) {
    for (let c = 0; c < width; c++) {
      const ci = colInfo[c];
      if (ci.month === M && ci.kind) {
        const slot = (monthCols[M] = monthCols[M] || { weeks: {} });
        if (ci.kind.week && slot.weeks[ci.kind.week] == null) slot.weeks[ci.kind.week] = c;
        if (ci.kind.status && slot.status == null) slot.status = c;
        if (ci.kind.next && slot.next == null) slot.next = c;
        if (ci.kind.notes && slot.notes == null) { slot.notes = c; break; }
      }
    }
  }

  // data rows: after wkRow (skip the 3px freezebar spacer row which is all spacers)
  const nameCol = 2; // column B (col0=row-header, col1=A category, col2=B name)
  const deliverables = [];
  for (let r = wkRow + 1; r < grid.length; r++) {
    // column B holds the name; the Paid Media rows (Google Ads / Meta Ads) put
    // their name in column A instead, so fall back to it.
    const name = textOf(grid[r][nameCol] || "") || textOf(grid[r][1] || "");
    if (!name) continue;
    deliverables.push({ r, name });
  }

  // fetch remote deliverables
  const cookie = { v: "" };
  await api("POST", "/api/auth", { password: PASSWORD }, cookie);
  const accounts = (await api("GET", "/api/snapshot/accounts", null, cookie)).accounts;
  const acct = accounts.find((a) => normName(a.name) === normName("12 Volt Power"));
  if (!acct) throw new Error("12 Volt Power account not found on remote");
  const detail = await api("GET", `/api/snapshot/accounts/${acct.id}`, null, cookie);
  const remote = detail.deliverables;
  const remoteByNorm = new Map(remote.map((d) => [normName(d.name), d]));

  function matchRemote(name) {
    const n = normName(name);
    if (remoteByNorm.has(n)) return remoteByNorm.get(n);
    // prefix match on first 14 alnum chars
    const key = n.slice(0, 14);
    let hit = remote.find((d) => normName(d.name).startsWith(key) || n.startsWith(normName(d.name).slice(0, 14)));
    return hit || null;
  }

  // build entries
  const entries = new Map(); // key deliverableId|week -> entry
  const unmatched = [];
  let planned = 0;
  const summary = [];

  for (const d of deliverables) {
    const rem = matchRemote(d.name);
    if (!rem) { unmatched.push(d.name); continue; }
    const lines = [];
    for (const M of MONTHS) {
      const mc = monthCols[M];
      if (!mc) continue;
      const monthIdx = MONTH_IDX[M];
      const statusCell = mc.status != null ? parseCell(grid[d.r][mc.status] || "") : { chipStatus: null };
      const nextText = mc.next != null ? parseCell(grid[d.r][mc.next] || "").work : "";
      const notesText = mc.notes != null ? parseCell(grid[d.r][mc.notes] || "").work : "";
      const monthStatus = statusCell.chipStatus;

      const weeksWithText = [];
      for (let n = 1; n <= 5; n++) {
        const col = mc.weeks[n];
        if (col == null) continue;
        const { work, chipStatus } = parseCell(grid[d.r][col] || "");
        if (work) weeksWithText.push({ n, work, chipStatus });
      }

      const monthEntries = [];
      if (weeksWithText.length) {
        weeksWithText.forEach((w, i) => {
          monthEntries.push({
            weekStart: weekMonday(YEAR, monthIdx, w.n),
            status: w.chipStatus || monthStatus || "not_started",
            workDone: w.work,
            nextSteps: i === weeksWithText.length - 1 ? nextText : "",
            notes: i === weeksWithText.length - 1 ? notesText : "",
            _label: `${M} Wk${w.n}`,
          });
        });
      } else if (monthStatus || nextText || notesText) {
        monthEntries.push({
          weekStart: weekMonday(YEAR, monthIdx, 1),
          status: monthStatus || "not_started",
          workDone: "",
          nextSteps: nextText,
          notes: notesText,
          _label: `${M} (month)`,
        });
      }

      for (const e of monthEntries) {
        const key = `${rem.id}|${e.weekStart}`;
        if (entries.has(key)) {
          const prev = entries.get(key);
          prev.workDone = [prev.workDone, e.workDone].filter(Boolean).join(" | ");
          prev.nextSteps = prev.nextSteps || e.nextSteps;
          prev.notes = prev.notes || e.notes;
        } else {
          entries.set(key, { deliverableId: rem.id, ...e });
        }
        planned++;
        lines.push(`    ${e._label} [${e.weekStart}] ${e.status}${e.workDone ? " :: " + e.workDone.slice(0, 70) : ""}`);
      }
    }
    if (lines.length) summary.push(`  ${d.name}  ->  ${rem.name}\n` + lines.join("\n"));
  }

  console.log(`Source: ${SRC}`);
  console.log(`Deliverables in sheet: ${deliverables.length}, matched with entries: ${summary.length}`);
  if (unmatched.length) console.log(`UNMATCHED (skipped): ${unmatched.join(" | ")}`);
  console.log(`\nMonth column map:`);
  for (const M of MONTHS) console.log(`  ${M}:`, JSON.stringify(monthCols[M]));
  console.log(`\n${summary.join("\n")}`);
  console.log(`\nTotal entries to ${COMMIT ? "PUSH" : "push (dry run)"}: ${entries.size}`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to push.");
    return;
  }

  let ok = 0, fail = 0;
  for (const e of entries.values()) {
    try {
      await api("POST", "/api/snapshot/entry", {
        deliverableId: e.deliverableId,
        weekStart: e.weekStart,
        status: e.status,
        workDone: e.workDone,
        nextSteps: e.nextSteps,
        notes: e.notes,
      }, cookie);
      ok++;
    } catch (err) {
      fail++;
      console.error("  FAIL", e.weekStart, err.message);
    }
  }
  console.log(`\nPushed ${ok} entries, ${fail} failed.`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
