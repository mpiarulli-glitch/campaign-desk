#!/usr/bin/env node
/**
 * Import Weekly Client Snapshot HTML exports into Campaign Desk.
 *
 * Parses every tab export, classifies kind/cadence/team the way snapshots
 * actually score, then writes deliverables + period-keyed entries.
 *
 * Usage:
 *   node scripts/import-weekly-snapshot-html.js              # dry run
 *   node scripts/import-weekly-snapshot-html.js --commit     # local DB
 *   node scripts/import-weekly-snapshot-html.js --commit --hub
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const Database = require("better-sqlite3");

const SRC_DIR =
  process.env.SNAPSHOT_HTML_DIR ||
  path.join(os.homedir(), "Downloads", "Weekly Client Snapshot (2)");
const DB_PATH = path.join(__dirname, "..", "data", "campaign-desk.db");
const HUB_URL =
  process.env.CAMPAIGN_DESK_URL || "https://hub.marketingempiregroup.com";
const PASSWORD = process.env.CAMPAIGN_DESK_PASSWORD || "Marketingeg1!";
const LOGIN_ACCOUNTS = (
  process.env.CAMPAIGN_DESK_ACCOUNT || "kyle_onstott,luis_romero,michael"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const COMMIT = process.argv.includes("--commit");
const WANT_HUB = process.argv.includes("--hub");

const FILES = [
  ["12 Volt Power.html", "12 Volt Power"],
  ["BetterLife Coach.html", "BetterLife Coach"],
  ["CIPO Cloud Software.html", "CIPO Cloud Software"],
  ["CISCo Restaurant + Bar.html", "CISCo Restaurant + Bar"],
  ["Ecoworkz.html", "Ecoworkz"],
  ["Guardian Plumbers.html", "Guardian Plumbers"],
  ["Hendo's Barrel House.html", "Hendo's Barrel House"],
  ["Kentina Hospitality.html", "Kentina Hospitality"],
  ["Krak Boba (Corporate).html", "Krak Boba Corporate"],
  ["Pacific Coast Generation.html", "Pacific Coast Generation"],
  ["Pipe It RIght.html", "Pipe It Right"],
  ["The HR Innovator Group.html", "The HR Innovator Group"],
];

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const STATUS_MAP = new Map([
  ["completed", "completed"],
  ["complete", "completed"],
  ["done", "completed"],
  ["presented", "completed"],
  ["share & approved", "approved"],
  ["shared & approved", "approved"],
  ["shared and approved", "approved"],
  ["approved", "approved"],
  ["partially approved", "shared"],
  ["partial approval sent", "shared"],
  ["shared & not yet approved", "shared"],
  ["shared and not yet approved", "shared"],
  ["shared - not yet approved", "shared"],
  ["not yet approved", "shared"],
  ["not shared", "shared"],
  ["shared", "shared"],
  ["shared — awaiting approval", "shared"],
  ["sent for approval", "sent_for_approval"],
  ["sent", "sent_for_approval"],
  ["in progress", "in_progress"],
  ["in development", "in_progress"],
  ["ongoing", "in_progress"],
  ["active", "in_progress"],
  ["live", "in_progress"],
  ["scheduled", "scheduled"],
  ["assigned", "not_started"],
  ["on hold", "not_started"],
  ["not started", "not_started"],
  ["canceled", "canceled"],
  ["cancelled", "canceled"],
]);

const MET_STATUSES = new Set(["scheduled", "completed", "shared", "approved"]);
const MET_RANK = { completed: 1, scheduled: 2, shared: 3, approved: 4 };

function inferContractMetFromNotes(...parts) {
  const text = parts.map((p) => (p || "").trim()).filter(Boolean).join("\n");
  if (!text) return null;
  const n = text
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\bschedled\b/g, "scheduled");
  const has = (re) => re.test(n);
  let hit = null;
  const bump = (s) => {
    if (!hit || MET_RANK[s] > MET_RANK[hit]) hit = s;
  };
  const waitingApproval = has(
    /\b(pending|waiting|awaiting)\s+approval\b|\bnot yet approved\b|\bsend(?:t)?(?:\s+content)?\s+for approval\b/
  );
  const approvedDelivery =
    has(/\bshare[d]?\s*(&|and)\s*approved\b/) ||
    has(/\bclient approved\b/) ||
    has(/\bapproved by (?:the )?client\b/) ||
    has(/\bgraphics approved\b/) ||
    (has(/\bapproved\b/) &&
      !has(/\b(pending|waiting|awaiting|for) approval\b/) &&
      !has(/\bsend(?:t)?(?:\s+content)?\s+for approval\b/));
  if (approvedDelivery) bump("approved");
  if (
    has(/\bshared\b/) ||
    has(/\bnot yet approved\b/) ||
    has(/\bsent to (?:the )?client\b/) ||
    has(/\bemailed to (?:the )?client\b/)
  ) {
    bump("shared");
  }
  if (has(/\bscheduled?(?:\s+out)?\b/)) bump("scheduled");
  if (
    has(/\bcompleted\b/) ||
    has(/\bdelivered\b/) ||
    has(/\bpublished\b/) ||
    has(/\bpublish\b/) ||
    has(/\bposted\b/) ||
    has(/\blaunched\b/) ||
    has(/\blaunch\b/) ||
    has(/\binstalled\b/) ||
    has(/\bwent live\b/) ||
    has(/\baudit generated\b/) ||
    (has(/\bcomplete\b/) && !has(/\bcomplete rebuild\b/))
  ) {
    bump("completed");
  }
  if (!hit) return null;
  if (waitingApproval && hit !== "approved" && hit !== "shared" && hit !== "scheduled") {
    return null;
  }
  return hit;
}

function coalesceEntryStatus(current, workDone, notes) {
  const cur = current || "not_started";
  if (MET_STATUSES.has(cur) || cur === "canceled") return cur;
  return inferContractMetFromNotes(workDone, notes) || cur;
}

const SECTION_RE =
  /^(strategy\s*&\s*planning|reviews?\s*&\s*reputation|content|seo\s*&\s*visibility|crm,?\s*email\s*&\s*automation|website,?\s*tracking\s*&\s*ai|social media strategy\s*&\s*management|content creation|email\s*&\s*outreach|visibility\s*&\s*listings|visibility\s*\(.*|conversion\s*\(.*|nurturing\s*&\s*automation|2026 q1|à la carte requests|a la carte requests|insert contract deliverables|revenue strategy\s*&\s*market domination|search domination.*|estimate\s*&\s*booking.*|creative content|paid media|add-?ons|local search domination.*|onboarding|website\s*&\s*digital experience.*|system integration.*|crm,?\s*data\s*&\s*customer.*)$/i;

const STOP_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "per",
  "up",
  "avg",
  "total",
  "hours",
  "hour",
  "hrs",
  "hr",
  "month",
  "monthly",
  "weekly",
  "week",
  "daily",
  "ongoing",
  "one",
  "time",
  "updated",
  "management",
  "media",
]);

const TOKEN_ALIASES = {
  blogging: "blog",
  graphics: "graphic",
  influencers: "influencer",
  productions: "production",
  posts: "post",
};

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", bull: "•" };

function decode(s) {
  return s
    .replace(/&(amp|lt|gt|quot|#39|nbsp|bull);/g, (_, e) => ENT[e] || " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\u00a0/g, " ");
}

function textOf(html) {
  return decode(
    String(html || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholder(t) {
  return !t || /^[\s\-–—•\u200b\u00a0â—]+$/.test(t) || t === "​";
}

function parseStatus(label) {
  if (!label) return null;
  const n = label
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (STATUS_MAP.has(n)) return STATUS_MAP.get(n);
  for (const [k, v] of STATUS_MAP) {
    if (n === k || n.startsWith(k + " ") || n.startsWith(k + "/") || n.startsWith(k + "-")) {
      return v;
    }
  }
  return null;
}

function parseCell(inner) {
  let chipStatus = null;
  const chips = [];
  String(inner || "").replace(/<span class="s\d+"[^>]*>([\s\S]*?)<\/span>/gi, (m, body) => {
    chips.push(body);
    return "";
  });
  for (const body of chips) {
    if (/<a\b/i.test(body)) continue;
    const label = textOf(body);
    const st = parseStatus(label);
    if (st) chipStatus = st;
  }
  let work = textOf(inner);
  if (chipStatus) {
    for (const body of chips) {
      if (/<a\b/i.test(body)) continue;
      const label = textOf(body);
      if (label && parseStatus(label)) work = work.replace(label, "").trim();
    }
  }
  if (isPlaceholder(work)) work = "";
  if (work && parseStatus(work) && work.length < 48) {
    chipStatus = chipStatus || parseStatus(work);
    work = "";
  }
  return { chipStatus, work };
}

function parseRows(html) {
  const start = html.indexOf("<tbody>");
  const end = html.indexOf("</tbody>");
  const body = start >= 0 ? html.slice(start, end >= 0 ? end : undefined) : html;
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(body))) {
    const cells = [];
    const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = tdRe.exec(m[1]))) {
      const attrs = c[1];
      if (/row-header|freezebar/.test(attrs) && !/class="s\d/.test(attrs)) {
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

function buildGrid(rows) {
  const grid = [];
  const carry = [];
  for (let r = 0; r < rows.length; r++) {
    const line = [];
    let col = 0;
    const active = carry.filter((x) => x.remaining > 0);
    let ci = 0;
    for (const cell of rows[r]) {
      while (active[ci] && active[ci].col === col) {
        line[col] = active[ci].inner;
        active[ci].remaining--;
        col++;
        ci++;
      }
      for (let k = 0; k < cell.colspan; k++) {
        line[col] = k === 0 ? cell.inner : "";
        col++;
      }
      if (cell.rowspan > 1) {
        for (let k = 0; k < cell.colspan; k++) {
          carry.push({
            col: col - cell.colspan + k,
            remaining: cell.rowspan - 1,
            inner: k === 0 ? cell.inner : "",
          });
        }
      }
    }
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

function pad(n) {
  return String(n).padStart(2, "0");
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function firstMondayOfMonth(year, monthIdx0) {
  const d = new Date(year, monthIdx0, 1);
  const day = d.getDay();
  const add = day === 1 ? 0 : (8 - day) % 7;
  d.setDate(1 + add);
  return d;
}
function weekMonday(year, monthIdx0, weekN) {
  const d = firstMondayOfMonth(year, monthIdx0);
  d.setDate(d.getDate() + (weekN - 1) * 7);
  return ymd(d);
}
function periodStart(unit, dateYmd) {
  const [y, m] = dateYmd.split("-").map(Number);
  if (unit === "weekly") return dateYmd;
  if (unit === "quarterly") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return `${y}-${pad(q)}-01`;
  }
  return `${y}-${pad(m)}-01`;
}

function parseLaunch(html) {
  const raw = textOf(html);
  const m = raw.match(
    /LAUNCH DATE:\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );
  if (!m) return null;
  const s = m[1];
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    return { year: y, month: Number(slash[1]), day: Number(slash[2]) };
  }
  const named = s.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i
  );
  if (named) {
    return {
      year: Number(named[3]),
      month: MONTHS[named[1].toLowerCase()],
      day: Number(named[2]),
    };
  }
  return null;
}

function classifyCadence(name) {
  const n = name.toLowerCase();

  const qtyUnit = n.match(
    /(\d+)\s*(?:x|times)?\s*(?:[a-z\s/.-]{0,28}?)\s*(?:per|\/|a|each|every)\s*(week|wk|month|mo|quarter|qtr)\b/
  );
  if (qtyUnit) {
    const qty = qtyUnit[1];
    const raw = qtyUnit[2];
    if (/^(week|wk)$/.test(raw)) {
      return { cadence: `${qty} per week`, kind: "recurring", unit: "weekly" };
    }
    if (/^(quarter|qtr)$/.test(raw)) {
      return { cadence: `${qty} per quarter`, kind: "recurring", unit: "quarterly" };
    }
    return { cadence: `${qty} per month`, kind: "recurring", unit: "monthly" };
  }

  if (/\b(bi-?weekly|every other week|4x week|x\/wk|\/wk|posts\/wk)\b/.test(n)) {
    return { cadence: "Weekly", kind: "recurring", unit: "weekly" };
  }
  if (/\bweekly\b/.test(n)) {
    return { cadence: "Weekly", kind: "recurring", unit: "weekly" };
  }
  if (/\b(bi-?monthly)\b/.test(n)) {
    return { cadence: "Bi-monthly", kind: "recurring", unit: "monthly" };
  }
  if (/\bmonthly\b/.test(n) && /\bquarterly\b/.test(n)) {
    return { cadence: "Monthly", kind: "recurring", unit: "monthly" };
  }
  if (/\bquarterly\b/.test(n) || /updated quarterly/.test(n)) {
    return { cadence: "Quarterly", kind: "recurring", unit: "quarterly" };
  }
  if (
    /\b(\d+)\s*(?:hours?|hrs?)\s*(?:\/\s*|per\s*)?(?:month|mo)\b/.test(n) ||
    /avg\.?\s*\d+\s*(?:hrs?|hours|x)\s*(?:\/\s*|per\s*)?(?:mo|month)/.test(n) ||
    /\bhours?\s+monthly\b/.test(n) ||
    /\b\d+\s+hours?\s+monthly\b/.test(n)
  ) {
    const hrs = n.match(/(\d+)\s*(?:hours?|hrs?)/);
    return {
      cadence: hrs ? `${hrs[1]} hrs/month` : "Monthly",
      kind: "recurring",
      unit: "monthly",
    };
  }
  if (
    /\b(monthly|per month|each month|\/month|x\/month|x\s*month|1x month|\d+x\s*month)\b/.test(n)
  ) {
    return { cadence: "Monthly", kind: "recurring", unit: "monthly" };
  }
  if (/\b(hours total|pieces? of content total|total posts)\b/.test(n) && /avg/.test(n)) {
    return { cadence: "Monthly", kind: "recurring", unit: "monthly" };
  }
  if (/\b\d+\s*(?:hours?|hrs?)\b/.test(n) && !/one[- ]?time/.test(n)) {
    const hrs = n.match(/(\d+)\s*(?:hours?|hrs?)/);
    return {
      cadence: hrs ? `${hrs[1]} hours` : "One-time",
      kind: "one_time",
      unit: "monthly",
    };
  }

  if (/\b(one[- ]?time|1x\)\s*set)\b/.test(n)) {
    return { cadence: "One-time", kind: "one_time", unit: "monthly" };
  }
  if (/\bongoing\b/.test(n) && !/one[- ]?time/.test(n)) {
    return { cadence: "Ongoing", kind: "recurring", unit: "monthly" };
  }

  return { cadence: "One-time", kind: "one_time", unit: "monthly" };
}

function applyCategoryKind(d) {
  if (/one[- ]?time/i.test(d.category) && d.kind === "recurring" && !/\b(monthly|weekly|quarterly|\/month|\/wk)\b/i.test(d.name)) {
    d.kind = "one_time";
    d.cadence = d.cadence || "One-time";
  }
  return d;
}

function classifyTeam(name, category) {
  const t = `${category} ${name}`.toLowerCase();
  if (/\b(email|newsletter|sms|text message|klaviyo|lifecycle|automation|crm|ghl|workflow)\b/.test(t)) {
    return { category: category || "Email", team: "email" };
  }
  if (/\b(blog|seo|keyword|gbp|google business|directory|listing|geo-?grid|local search)\b/.test(t)) {
    return { category: category || "SEO", team: "seo" };
  }
  if (/\b(onboard|kick-?off|systems access)\b/.test(t)) {
    return { category: category || "Onboarding", team: "onboarding" };
  }
  if (/\b(social|instagram|facebook|tiktok|reel|influencer|graphic|production|video|photo|shoot)\b/.test(t)) {
    return { category: category || "Social", team: "social" };
  }
  if (/\b(website|landing page|web ?site|wordpress|homepage|ada|checkout|stripe|booking flow)\b/.test(t)) {
    return { category: category || "Web", team: "web" };
  }
  if (/\b(strategy|meeting|go-to-market|icp|persona|market research|blueprint)\b/.test(t)) {
    return { category: category || "Strategy", team: "" };
  }
  if (/\b(ads?|ppc|paid|google ads|meta ads|ad management)\b/.test(t)) {
    return { category: category || "Paid Media", team: "" };
  }
  return { category: category || "", team: "" };
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function nameTokens(s) {
  const parts = String(s || "")
    .toLowerCase()
    .replace(/\bal\b/g, "ai")
    .match(/[a-z0-9]+/g) || [];
  const out = new Set();
  for (let p of parts) {
    p = TOKEN_ALIASES[p] || p;
    if (STOP_TOKENS.has(p)) continue;
    if (p.length > 1 || /^\d+$/.test(p)) out.add(p);
  }
  return out;
}

function hoursIn(s) {
  const m = String(s || "")
    .toLowerCase()
    .match(/(\d+)\s*(?:hours?|hrs?)/);
  return m ? m[1] : null;
}

function matchDeliverable(remote, name) {
  const n = normName(name);
  const by = new Map(remote.map((d) => [normName(d.name), d]));
  if (by.has(n)) return by.get(n);
  const key = n.slice(0, 14);
  const prefix = remote.filter((d) => {
    const dn = normName(d.name);
    return key && (dn.startsWith(key) || n.startsWith(dn.slice(0, 14)));
  });
  if (prefix.length === 1) return prefix[0];
  const want = nameTokens(name);
  const wantHrs = hoursIn(name);
  const distinctive = new Set([
    "email",
    "seo",
    "blog",
    "social",
    "chatbot",
    "gbp",
    "google",
    "influencer",
    "production",
    "graphic",
    "leads",
    "linkedin",
    "meta",
    "landing",
    "directory",
    "crm",
    "icp",
  ]);
  const scored = [];
  for (const d of remote) {
    const got = nameTokens(d.name);
    const inter = [...want].filter((t) => got.has(t));
    if (wantHrs) {
      const gotHrs = hoursIn(d.name);
      if (gotHrs && gotHrs !== wantHrs) continue;
    }
    if (want.has("automation") !== got.has("automation") && inter.length < 4) continue;
    if (want.has("setup") !== got.has("setup") && inter.length < 4) continue;
    if (inter.length >= 3 || (inter.length >= 2 && inter.some((t) => distinctive.has(t)))) {
      scored.push([inter.length, d]);
    }
  }
  scored.sort((a, b) => b[0] - a[0]);
  if (scored.length && (scored.length === 1 || scored[0][0] > scored[1][0])) {
    return scored[0][1];
  }
  return null;
}

function matchAccount(accounts, phrase) {
  const want = normName(phrase);
  for (const a of accounts) {
    const n = normName(a.name);
    if (n === want || n.includes(want) || want.includes(n)) return a;
  }
  const pt = phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  for (const a of accounts) {
    const ct = new Set(a.name.toLowerCase().split(/[^a-z0-9]+/));
    if (pt.length && pt.every((t) => [...ct].some((c) => c.includes(t) || t.includes(c)))) {
      return a;
    }
  }
  return null;
}

function looksWrap(name, lastName, hasWork) {
  if (!name || !lastName || hasWork) return false;
  if (/^[a-z]/.test(name) || /^[,)&]/.test(name)) return true;
  if (/[+\-,&/]$/.test(lastName.trim())) return true;
  if (/—\s*$/.test(lastName) || /-\s*$/.test(lastName)) return true;
  const lastWord = lastName.trim().split(/\s+/).pop() || "";
  if (lastWord.length >= 4 && lastWord.length <= 6 && !/[.!?)]$/.test(lastName) && !/^(month|weekly|total|setup|pages|hours|meeting|reports|system|content|listings)$/i.test(lastWord)) {
    if (/^(locations|outreaches|management|strategy|youtube|instagram|facebook|tiktok)$/i.test(name.split(/\s/)[0])) {
      return true;
    }
  }
  return false;
}

function parseSheet(html, fileLabel) {
  const rows = parseRows(html);
  const grid = buildGrid(rows);
  const launch = parseLaunch(html.slice(0, 25000));

  let monthRow = -1;
  let wkRow = -1;
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const texts = grid[r].map((h) => textOf(h || ""));
    const months = texts.filter((t) =>
      /In Progress:\s*[A-Za-z]+/i.test(t) ||
      (/^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(t) &&
        !/launch/i.test(t))
    ).length;
    const wks = texts.filter((t) => /^Wk\d$/i.test(t)).length;
    if (months >= 1 && monthRow < 0) monthRow = r;
    if (wks >= 3 && wkRow < 0) wkRow = r;
  }
  if (monthRow < 0 || wkRow < 0) {
    return { error: "Could not find month/week headers", deliverables: [], blocks: [] };
  }

  const width = Math.max(grid[monthRow].length, grid[wkRow].length, ...grid.map((g) => g.length));
  const colInfo = [];
  let lastMonth = null;
  let lastYear = null;
  let lastIdx = null;
  let defaultYear = 2026;
  if (launch) {
    defaultYear = launch.year;
  }

  for (let c = 0; c < width; c++) {
    const mh = textOf(grid[monthRow][c] || "");
    const monthMatch = mh.match(
      /(?:In Progress:\s*)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i
    );
    if (
      monthMatch &&
      (/progress/i.test(mh) || mh.toLowerCase().startsWith(monthMatch[1].toLowerCase()))
    ) {
      const month = monthMatch[1];
      const idx = MONTHS[month.toLowerCase()];
      let year = monthMatch[2] ? Number(monthMatch[2]) : lastYear || defaultYear;
      if (lastIdx != null && idx < lastIdx && year <= (lastYear || year)) {
        year = (lastYear || year) + 1;
      }
      if (!monthMatch[2] && lastIdx == null && launch && idx < launch.month) {
        year = launch.year + 1;
      }
      lastMonth = month;
      lastYear = year;
      lastIdx = idx;
    }
    const sub = textOf(grid[wkRow][c] || "");
    let kind = null;
    const wk = sub.match(/^Wk(\d)/i);
    if (wk) kind = { week: parseInt(wk[1], 10) };
    else if (/^Status/i.test(sub) || /^Status/i.test(mh)) kind = { status: true };
    else if (/^Next Steps/i.test(sub) || /^Next Steps/i.test(mh)) kind = { next: true };
    else if (/^Notes/i.test(sub) || /^Notes/i.test(mh)) kind = { notes: true };
    colInfo.push({ month: lastMonth, year: lastYear, kind, col: c });
  }

  const firstWkCol = colInfo.find((c) => c.kind && c.kind.week != null)?.col;
  if (firstWkCol == null) {
    return { error: "No Wk columns", deliverables: [], blocks: [] };
  }
  const nameInB = firstWkCol >= 3;
  const nameCol = nameInB ? 2 : 1;
  const catCol = 1;

  const blocks = [];
  const seen = new Set();
  let current = null;
  for (const info of colInfo) {
    const k = info.kind;
    if (k && k.week != null && info.month) {
      let key = `${info.month}|${info.year}`;
      if (current && `${current.month}|${current.year}` !== key && seen.has(key)) {
        // Duplicate month label (Guardian's second February) → next month.
        let idx = MONTHS[info.month.toLowerCase()] + 1;
        let year = info.year;
        if (idx > 12) {
          idx = 1;
          year += 1;
        }
        const month = Object.keys(MONTHS).find((n) => MONTHS[n] === idx);
        info.month = month[0].toUpperCase() + month.slice(1);
        info.year = year;
        key = `${info.month}|${info.year}`;
      }
      if (!current || `${current.month}|${current.year}` !== key) {
        current = {
          month: info.month,
          year: info.year,
          weeks: {},
          status: null,
          next: null,
          notes: null,
        };
        blocks.push(current);
        seen.add(key);
      }
      if (current.weeks[k.week] == null) current.weeks[k.week] = info.col;
    } else if (k && current) {
      if (k.status && current.status == null) current.status = info.col;
      else if (k.next && current.next == null) current.next = info.col;
      else if (k.notes && current.notes == null) current.notes = info.col;
    }
  }

  function rowHasWork(r) {
    for (const info of colInfo) {
      if (!info.kind) continue;
      const t = textOf(grid[r][info.col] || "");
      if (t && !isPlaceholder(t) && !/^Wk\d$/i.test(t) && !/^(status|next steps|notes)$/i.test(t)) {
        return true;
      }
    }
    return false;
  }

  let lastCategory = "";
  let lastName = "";
  const deliverables = [];
  let emptyRun = 0;

  for (let r = wkRow + 1; r < grid.length; r++) {
    const a = textOf(grid[r][catCol] || "");
    const b = textOf(grid[r][nameCol] || "");
    let name = "";
    let category = lastCategory;
    if (nameInB) {
      name = b && !/^Wk\d$/i.test(b) && !/^(notes|date|status)$/i.test(b) ? b : "";
      if (a && !name) {
        if (SECTION_RE.test(a) || (a === a.toUpperCase() && a.length < 56 && /&/.test(a))) {
          lastCategory = a;
          category = a;
        } else if (!SECTION_RE.test(a)) {
          name = a;
        }
      } else if (a) {
        lastCategory = a;
        category = a;
      }
    } else {
      name = a;
    }

    if (name && lastName && deliverables.length && looksWrap(name, lastName, rowHasWork(r))) {
      deliverables[deliverables.length - 1].name = `${deliverables[deliverables.length - 1].name} ${name}`.trim();
      lastName = deliverables[deliverables.length - 1].name;
      emptyRun = 0;
      continue;
    }

    if (!name) {
      emptyRun += 1;
      if (emptyRun >= 10 && deliverables.length) break;
      continue;
    }
    emptyRun = 0;

    if (SECTION_RE.test(name) || (name === name.toUpperCase() && name.length < 56 && /&/.test(name))) {
      lastCategory = name;
      continue;
    }
    if (/^insert contract/i.test(name)) continue;
    if (/^(à la carte requests|a la carte requests)$/i.test(name) && (!b || b.toLowerCase() === "date")) {
      lastCategory = name;
      continue;
    }

    lastName = name;
    const cad = classifyCadence(name);
    const own = classifyTeam(name, category && category !== name ? category : "");
    const classified = applyCategoryKind({
      name,
      category: own.category,
      team: own.team,
      cadence: cad.cadence,
      kind: cad.kind,
      cadenceUnit: cad.unit,
    });
    const weekEntries = [];
    for (const blk of blocks) {
      const statusTxt = blk.status != null ? parseCell(grid[r][blk.status] || "") : { chipStatus: null, work: "" };
      const nextTxt = blk.next != null ? parseCell(grid[r][blk.next] || "").work : "";
      const notesTxt = blk.notes != null ? parseCell(grid[r][blk.notes] || "").work : "";
      const monthStatus = statusTxt.chipStatus;
      const weeksWith = [];
      for (let n = 1; n <= 5; n++) {
        const col = blk.weeks[n];
        if (col == null) continue;
        const cell = parseCell(grid[r][col] || "");
        if (cell.work || cell.chipStatus) weeksWith.push({ n, ...cell });
      }
      if (!weeksWith.length && !monthStatus && !nextTxt && !notesTxt) continue;
      const parts = [];
      if (weeksWith.length) {
        for (const w of weeksWith) {
          if (w.work) parts.push(`Wk${w.n}: ${w.work}`);
        }
      }
      const firstN = weeksWith[0]?.n || 1;
      if (classified.cadenceUnit === "weekly") {
        for (const w of weeksWith) {
          weekEntries.push({
            weekStart: weekMonday(blk.year, MONTHS[blk.month.toLowerCase()] - 1, w.n),
            month: blk.month,
            year: blk.year,
            status: w.chipStatus || "not_started",
            workDone: w.work || "",
            nextSteps: nextTxt,
            notes: notesTxt,
            weekCount: 1,
          });
        }
        if (!weeksWith.length && (monthStatus || nextTxt || notesTxt)) {
          weekEntries.push({
            weekStart: weekMonday(blk.year, MONTHS[blk.month.toLowerCase()] - 1, 1),
            month: blk.month,
            year: blk.year,
            status: monthStatus || "not_started",
            workDone: "",
            nextSteps: nextTxt,
            notes: notesTxt,
            weekCount: 1,
          });
        }
      } else {
        const lastChip = [...weeksWith].reverse().find((w) => w.chipStatus);
        const lastWork = weeksWith[weeksWith.length - 1];
        const weekN = lastChip?.n || lastWork?.n || firstN;
        weekEntries.push({
          weekStart: weekMonday(blk.year, MONTHS[blk.month.toLowerCase()] - 1, weekN),
          month: blk.month,
          year: blk.year,
          status: monthStatus || lastChip?.chipStatus || "not_started",
          workDone: parts.join(" · "),
          nextSteps: nextTxt,
          notes: notesTxt,
          weekCount: weeksWith.length || (monthStatus || nextTxt || notesTxt ? 1 : 0),
        });
      }
    }

    deliverables.push({
      row: r,
      name,
      category: classified.category,
      team: classified.team,
      cadence: classified.cadence,
      kind: classified.kind,
      cadenceUnit: classified.cadenceUnit,
      entries: weekEntries,
    });
  }

  return {
    error: null,
    file: fileLabel,
    launch,
    nameInB,
    firstWkCol,
    blocks: blocks.map((b) => ({
      month: b.month,
      year: b.year,
      weeks: Object.keys(b.weeks).map(Number).sort((a, c) => a - c),
    })),
    deliverables,
  };
}

function foldEntries(d) {
  // One snapshot row per scoring period so monthly/quarterly/one-time
  // history survives without colliding week keys.
  const byKey = new Map();
  for (const e of d.entries) {
    const key =
      d.kind === "one_time"
        ? "once"
        : periodStart(d.cadenceUnit, e.weekStart);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        weekStart: e.weekStart,
        status: e.status,
        workDone: e.workDone,
        nextSteps: e.nextSteps,
        notes: e.notes,
      });
      continue;
    }
    prev.workDone = [prev.workDone, e.workDone].filter(Boolean).join(" · ");
    prev.nextSteps = e.nextSteps || prev.nextSteps;
    prev.notes = e.notes || prev.notes;
    if (e.status && e.status !== "not_started") {
      prev.status = e.status;
      prev.weekStart = e.weekStart;
    }
  }
  return [...byKey.values()].filter(
    (e) => e.workDone || e.nextSteps || e.notes || (e.status && e.status !== "not_started")
  );
}

function nid(len = 12) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
const nowIso = () => new Date().toISOString();

function ensureAccount(db, name) {
  let row = db
    .prepare(`SELECT * FROM rev_clients WHERE name = ? COLLATE NOCASE`)
    .get(name);
  if (row) return { account: row, created: false };
  const variants = [
    name.replace(/'/g, ""),
    name.replace(/\bThe\s+/i, ""),
    name.replace(/\s+Corporate$/i, ""),
  ];
  for (const v of variants) {
    row = db.prepare(`SELECT * FROM rev_clients WHERE name = ? COLLATE NOCASE`).get(v);
    if (row) return { account: row, created: false };
  }
  const all = db.prepare(`SELECT * FROM rev_clients`).all();
  const hit = matchAccount(all, name);
  if (hit) return { account: hit, created: false };
  const ts = nowIso();
  const id = nid(12);
  db.prepare(
    `INSERT INTO rev_clients
      (id, name, business_model, retainer, monthly_cost, active, created_at, updated_at)
     VALUES (?, ?, 'home_service', 0, 0, 1, ?, ?)`
  ).run(id, name, ts, ts);
  return { account: db.prepare(`SELECT * FROM rev_clients WHERE id = ?`).get(id), created: true };
}

function writeLocal(db, account, parsed) {
  const remote = db
    .prepare(
      `SELECT * FROM snapshot_deliverables WHERE client_id = ? AND active = 1 ORDER BY sort_order`
    )
    .all(account.id);
  const unmatched = [];
  const remapped = [];
  const created = [];
  let entryCount = 0;

  const maxOrder =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM snapshot_deliverables WHERE client_id = ?`
      )
      .get(account.id).m + 1;

  const insertD = db.prepare(
    `INSERT INTO snapshot_deliverables
      (id, client_id, category, team, name, cadence, kind, cadence_unit, due_date, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`
  );
  const updateD = db.prepare(
    `UPDATE snapshot_deliverables
     SET category = ?, team = ?, cadence = ?, kind = ?, cadence_unit = ?, updated_at = ?
     WHERE id = ?`
  );
  const upsertE = db.prepare(
    `INSERT INTO snapshot_entries
      (id, deliverable_id, client_id, week_start, status, work_done, next_steps, notes, logged_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import:weekly-html', ?, ?)
     ON CONFLICT(deliverable_id, week_start) DO UPDATE SET
       status = excluded.status,
       work_done = excluded.work_done,
       next_steps = excluded.next_steps,
       notes = excluded.notes,
       logged_by = excluded.logged_by,
       updated_at = excluded.updated_at`
  );

  let order = maxOrder;
  const tx = db.transaction(() => {
    for (const d of parsed.deliverables) {
      let rem = matchDeliverable(remote, d.name);
      if (!rem) {
        const ts = nowIso();
        const id = nid(12);
        insertD.run(
          id,
          account.id,
          d.category || "",
          d.team || "",
          d.name,
          d.cadence || "",
          d.kind,
          d.cadenceUnit,
          order++,
          ts,
          ts
        );
        rem = {
          id,
          name: d.name,
          category: d.category || "",
          team: d.team || "",
          cadence: d.cadence || "",
          kind: d.kind,
          cadence_unit: d.cadenceUnit,
        };
        remote.push(rem);
        created.push(d.name);
      } else {
        const changed =
          rem.kind !== d.kind ||
          rem.cadence_unit !== d.cadenceUnit ||
          (d.cadence && rem.cadence !== d.cadence) ||
          (d.team && rem.team !== d.team);
        updateD.run(
          d.category || rem.category || "",
          d.team || rem.team || "",
          d.cadence || rem.cadence || "",
          d.kind,
          d.cadenceUnit,
          nowIso(),
          rem.id
        );
        if (changed) {
          remapped.push({
            name: rem.name,
            from: `${rem.kind}/${rem.cadence_unit}`,
            to: `${d.kind}/${d.cadenceUnit}`,
          });
        }
      }
      const folded = foldEntries(d);
      for (const e of folded) {
        const ts = nowIso();
        upsertE.run(
          nid(12),
          rem.id,
          account.id,
          e.weekStart,
          e.status,
          e.workDone,
          e.nextSteps,
          e.notes,
          ts,
          ts
        );
        entryCount++;
      }
    }
  });
  tx();
  return { unmatched, remapped, created, entryCount };
}

async function hubLogin() {
  for (const slug of LOGIN_ACCOUNTS) {
    const res = await fetch(`${HUB_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD, account: slug }),
    });
    const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const body = await res.json().catch(() => ({}));
    if (body.needsTotp) {
      console.log(`  hub ${slug}: 2FA required`);
      continue;
    }
    if (body.ok && cookie) return { cookie, slug };
  }
  return null;
}

async function hubApi(cookie, method, p, body) {
  const res = await fetch(HUB_URL + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    j = txt;
  }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${txt.slice(0, 300)}`);
  return j;
}

async function writeHub(session, accounts, parsed, phrase) {
  const acct = matchAccount(accounts, phrase) || matchAccount(accounts, parsed.file);
  if (!acct) return { error: `no hub account for ${phrase}`, created: [], remapped: [], entryCount: 0 };
  const detail = await hubApi(session.cookie, "GET", `/api/snapshot/accounts/${acct.id}`);
  const remote = detail.deliverables || [];
  const created = [];
  const remapped = [];
  let entryCount = 0;
  let failE = 0;
  for (const d of parsed.deliverables) {
    let rem = matchDeliverable(remote, d.name);
    if (!rem) {
      const res = await hubApi(session.cookie, "POST", `/api/snapshot/accounts/${acct.id}/deliverables`, {
        name: d.name,
        category: d.category,
        team: d.team,
        cadence: d.cadence,
        kind: d.kind,
        cadenceUnit: d.cadenceUnit,
      });
      rem = res.deliverable;
      remote.push(rem);
      created.push(d.name);
    } else {
      await hubApi(session.cookie, "PATCH", `/api/snapshot/deliverables/${rem.id}`, {
        category: d.category || rem.category,
        team: d.team || rem.team || "",
        cadence: d.cadence || rem.cadence,
        kind: d.kind,
        cadenceUnit: d.cadenceUnit,
      });
      remapped.push(d.name);
    }
    for (const e of foldEntries(d)) {
      try {
        await hubApi(session.cookie, "POST", "/api/snapshot/entry", {
          deliverableId: rem.id,
          weekStart: e.weekStart,
          loggedFor: e.weekStart,
          status: e.status,
          workDone: e.workDone,
          nextSteps: e.nextSteps,
          notes: e.notes,
        });
        entryCount++;
      } catch (err) {
        failE++;
        if (failE <= 5) console.log(`    hub entry fail ${e.weekStart}: ${err.message}`);
      }
    }
  }
  return { account: acct.name, created, remapped, entryCount, failE };
}

function mainSyncParse() {
  const parsed = [];
  for (const [file, phrase] of FILES) {
    const fp = path.join(SRC_DIR, file);
    if (!fs.existsSync(fp)) {
      parsed.push({ phrase, file, error: `missing ${fp}`, deliverables: [], blocks: [] });
      continue;
    }
    const html = fs.readFileSync(fp, "utf8");
    const info = parseSheet(html, file);
    info.phrase = phrase;
    parsed.push(info);
  }
  return parsed;
}

async function main() {
  console.log(`Source: ${SRC_DIR}`);
  console.log(`Mode: ${COMMIT ? "COMMIT" : "dry run"}${WANT_HUB ? " + hub" : " (local)"}\n`);
  const parsed = mainSyncParse();

  for (const info of parsed) {
    console.log(`=== ${info.phrase} ===`);
    if (info.error) {
      console.log(`  PARSE ERROR: ${info.error}`);
      continue;
    }
    const months = info.blocks.map((b) => `${b.month} ${b.year}`).join(", ");
    const entries = info.deliverables.reduce((n, d) => n + foldEntries(d).length, 0);
    const rawWeeks = info.deliverables.reduce((n, d) => n + d.entries.length, 0);
    console.log(
      `  layout: name_col=${info.nameInB ? "B" : "A"} wk_col=${info.firstWkCol} months=[${months}]`
    );
    console.log(
      `  deliverables=${info.deliverables.length}  month-rows=${rawWeeks}  period-entries=${entries}`
    );
    for (const d of info.deliverables) {
      const n = foldEntries(d).length;
      console.log(
        `    [${d.kind}/${d.cadenceUnit}${d.cadence ? " " + d.cadence : ""}] ${d.category ? d.category + " · " : ""}${d.name}  (${n} entries)`
      );
    }
  }

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write the local DB, add --hub to push live.");
    return;
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const localSummary = [];
  for (const info of parsed) {
    if (info.error) {
      localSummary.push({ name: info.phrase, error: info.error });
      continue;
    }
    const { account, created } = ensureAccount(db, info.phrase);
    const result = writeLocal(db, account, info);
    localSummary.push({
      name: account.name,
      accountCreated: created,
      ...result,
    });
    console.log(
      `\nLOCAL ${account.name}: created ${result.created.length}, remapped ${result.remapped.length}, entries ${result.entryCount}`
    );
    if (result.created.length) console.log("  new: " + result.created.join(" | "));
    for (const r of result.remapped) {
      console.log(`  remap: ${r.name}  ${r.from} → ${r.to}`);
    }
  }

  if (WANT_HUB) {
    console.log(`\nConnecting to ${HUB_URL} …`);
    const session = await hubLogin();
    if (!session) {
      console.log("Could not log in to the hub. Local import still applied.");
    } else {
      console.log(`Hub login as ${session.slug}`);
      const accounts = (await hubApi(session.cookie, "GET", "/api/snapshot/accounts")).accounts || [];
      for (const info of parsed) {
        if (info.error) continue;
        try {
          const res = await writeHub(session, accounts, info, info.phrase);
          if (res.error) {
            console.log(`HUB ${info.phrase}: ${res.error}`);
            continue;
          }
          console.log(
            `HUB ${res.account}: created ${res.created.length}, patched ${res.remapped.length}, entries ${res.entryCount}${res.failE ? ` (${res.failE} failed)` : ""}`
          );
        } catch (err) {
          console.log(`HUB ${info.phrase} FAIL: ${err.message}`);
        }
      }
    }
  }

  db.close();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
