// Website Operations desk. Pure rules: stages, summaries, filters, and the
// shape of a project. Nothing here opens the database, so the page and the
// tests can share one definition of "due this week" and "waiting".

import { mondayOf } from "./week";

export const WEBSITE_BOARDS = ["website", "landing"] as const;
export type WebsiteBoard = (typeof WEBSITE_BOARDS)[number];

export const WEBSITE_DISPOSITIONS = [
  "active",
  "paused",
  "non_responsive",
  "launched",
  "archived",
] as const;
export type WebsiteDisposition = (typeof WEBSITE_DISPOSITIONS)[number];

export const WEBSITE_PRIORITIES = ["low", "medium", "high"] as const;
export type WebsitePriority = (typeof WEBSITE_PRIORITIES)[number];

export const WEBSITE_GROUPS = ["web", "custom"] as const;
export type WebsiteGroup = (typeof WEBSITE_GROUPS)[number] | "";

export const WEBSITE_OWNER_CHIPS = [
  "Roy",
  "Saqib",
  "Luis",
  "Carlos",
  "Jerald",
  "Sylvia",
  "Morris",
] as const;

export const WEBSITE_STAGES = [
  { key: "briefing", label: "Briefing" },
  { key: "discovery", label: "Discovery" },
  { key: "design", label: "Design" },
  { key: "content_review", label: "Content Review" },
  { key: "development", label: "Development" },
  { key: "qa", label: "QA" },
  { key: "final_qa", label: "Final QA" },
  { key: "launched", label: "Launched" },
] as const;

export const LANDING_STAGES = [
  { key: "needs_information", label: "Needs information" },
  { key: "in_progress", label: "In progress" },
  { key: "under_review", label: "Under Review" },
  { key: "paused", label: "Paused" },
  { key: "unknown", label: "Unknown" },
  { key: "done", label: "Done" },
] as const;

const TERMINAL_STAGES = new Set(["launched", "done"]);

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type WebsiteProject = {
  id: string;
  board: WebsiteBoard;
  projectGroup: WebsiteGroup;
  name: string;
  clientName: string;
  clientId: string | null;
  tier: string;
  platform: string;
  deliverables: string;
  stage: string;
  disposition: WebsiteDisposition;
  outsource: string;
  owners: string;
  waitingOn: string;
  priority: WebsitePriority;
  startOn: string;
  targetOn: string;
  launchOn: string;
  lastTouchpoint: string;
  nextStep: string;
  blockers: string;
  basecampUrl: string;
  quarter: string;
  coverage: boolean;
  coverageWhen: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export type WebsiteDraft = {
  board: WebsiteBoard;
  projectGroup: WebsiteGroup;
  name: string;
  clientName: string;
  clientId: string | null;
  tier: string;
  platform: string;
  deliverables: string;
  stage: string;
  disposition: WebsiteDisposition;
  outsource: string;
  owners: string;
  waitingOn: string;
  priority: WebsitePriority;
  startOn: string;
  targetOn: string;
  launchOn: string;
  lastTouchpoint: string;
  nextStep: string;
  blockers: string;
  basecampUrl: string;
  quarter: string;
  coverage: boolean;
  coverageWhen: string;
};

export type WebsiteSummary = {
  active: number;
  dueThisWeek: number;
  overdue: number;
  waiting: number;
  launched: number;
  paused: number;
  nonResponsive: number;
};

export type WebsiteBucket =
  | ""
  | "active"
  | "due"
  | "overdue"
  | "waiting"
  | "launched"
  | "paused"
  | "non_responsive"
  | "coverage";

export type WebsiteFilter = {
  q: string;
  board: "" | WebsiteBoard;
  stage: string;
  priority: "" | WebsitePriority;
  owner: string;
  bucket: WebsiteBucket;
};

const LIMITS = {
  name: 180,
  short: 240,
  url: 600,
  notes: 8000,
};

export function deskToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isWebsiteBoard(value: unknown): value is WebsiteBoard {
  return value === "website" || value === "landing";
}

export function stagesFor(board: WebsiteBoard): ReadonlyArray<{ key: string; label: string }> {
  return board === "website" ? WEBSITE_STAGES : LANDING_STAGES;
}

export function stageLabel(board: WebsiteBoard, key: string): string {
  return stagesFor(board).find((s) => s.key === key)?.label || key;
}

export function defaultStage(board: WebsiteBoard): string {
  return board === "website" ? "briefing" : "needs_information";
}

export function dispositionLabel(value: WebsiteDisposition): string {
  switch (value) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "non_responsive":
      return "Non-responsive";
    case "launched":
      return "Launched";
    case "archived":
      return "Archived";
  }
}

export function priorityLabel(value: WebsitePriority): string {
  if (value === "high") return "High";
  if (value === "low") return "Low";
  return "Medium";
}

export function groupLabel(value: WebsiteGroup): string {
  if (value === "custom") return "Custom";
  if (value === "web") return "Web";
  return "";
}

export function blankDraft(board: WebsiteBoard = "website"): WebsiteDraft {
  return {
    board,
    projectGroup: board === "website" ? "web" : "",
    name: "",
    clientName: "",
    clientId: null,
    tier: "",
    platform: "",
    deliverables: "",
    stage: defaultStage(board),
    disposition: "active",
    outsource: "",
    owners: "",
    waitingOn: "",
    priority: "medium",
    startOn: "",
    targetOn: "",
    launchOn: "",
    lastTouchpoint: "",
    nextStep: "",
    blockers: "",
    basecampUrl: "",
    quarter: "",
    coverage: false,
    coverageWhen: "",
  };
}

export function projectToDraft(project: WebsiteProject): WebsiteDraft {
  return {
    board: project.board,
    projectGroup: project.projectGroup,
    name: project.name,
    clientName: project.clientName,
    clientId: project.clientId,
    tier: project.tier,
    platform: project.platform,
    deliverables: project.deliverables,
    stage: project.stage,
    disposition: project.disposition,
    outsource: project.outsource,
    owners: project.owners,
    waitingOn: project.waitingOn,
    priority: project.priority,
    startOn: project.startOn,
    targetOn: project.targetOn,
    launchOn: project.launchOn,
    lastTouchpoint: project.lastTouchpoint,
    nextStep: project.nextStep,
    blockers: project.blockers,
    basecampUrl: project.basecampUrl,
    quarter: project.quarter,
    coverage: project.coverage,
    coverageWhen: project.coverageWhen,
  };
}

function ymdParts(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function isYmd(value: string): boolean {
  return ymdParts(value) !== null;
}

/** Accept YYYY-MM-DD or M/D/YYYY. Anything else (notes in a date column) is blank. */
export function parseDeskDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (isYmd(v)) return v;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isYmd(iso) ? iso : "";
}

export function addDays(ymd: string, days: number): string {
  const parts = ymdParts(ymd);
  if (!parts) return "";
  const date = new Date(parts.y, parts.m - 1, parts.d + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekBounds(today: string): { start: string; end: string } {
  const parts = ymdParts(today);
  const anchor = parts ? new Date(parts.y, parts.m - 1, parts.d) : new Date();
  const start = mondayOf(anchor);
  return { start, end: addDays(start, 6) };
}

export function formatDeskDate(ymd: string): string {
  const parts = ymdParts(ymd);
  if (!parts) return ymd || "—";
  return `${MONTHS[parts.m - 1]} ${parts.d}`;
}

export function weekLabel(today: string): string {
  const { start, end } = weekBounds(today);
  const a = ymdParts(start);
  const b = ymdParts(end);
  if (!a || !b) return "";
  if (a.y === b.y && a.m === b.m) {
    return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
  }
  if (a.y === b.y) {
    return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  }
  return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

export function quarterOf(ymd: string): string {
  const parts = ymdParts(ymd);
  if (!parts) return "";
  return `Q${Math.floor((parts.m - 1) / 3) + 1}`;
}

export function isActive(project: WebsiteProject): boolean {
  return project.disposition === "active" && !TERMINAL_STAGES.has(project.stage);
}

export function isDueThisWeek(project: WebsiteProject, today: string): boolean {
  if (project.disposition !== "active" || !project.targetOn) return false;
  if (TERMINAL_STAGES.has(project.stage)) return false;
  const { start, end } = weekBounds(today);
  return project.targetOn >= start && project.targetOn <= end;
}

export function isOverdue(project: WebsiteProject, today: string): boolean {
  if (project.disposition !== "active" || !project.targetOn) return false;
  if (TERMINAL_STAGES.has(project.stage)) return false;
  return project.targetOn < today;
}

/** Someone named in Waiting on is blocking the next step, client or internal. */
export function isWaiting(project: WebsiteProject): boolean {
  return project.disposition === "active" && project.waitingOn.trim().length > 0;
}

/** Slug → the short name the website desk uses on owners and filters. */
export const WEBSITE_PERSON_NAMES: Record<string, string> = {
  roy: "Roy",
  saqib: "Saqib",
  luis_romero: "Luis",
  carlos: "Carlos",
  jerald: "Jerald",
  sylvia: "Sylvia",
  kyle_morris: "Morris",
};

export function websitePersonName(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return WEBSITE_PERSON_NAMES[slug] ?? null;
}

export function splitPeople(value: string): string[] {
  return value
    .split(/[/+,;]|&|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Word-boundary match so "Roy" does not match inside another name. */
export function ownerHas(owners: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return splitPeople(owners).some((part) => part.toLowerCase() === needle);
}

export function joinPeople(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.join("/");
}

const TEAM_NAMES = new Set(WEBSITE_OWNER_CHIPS.map((name) => name.toLowerCase()));

/** A client wait is anyone in Waiting on who is not a web-team chip. */
export function waitingKind(waitingOn: string): "none" | "client" | "team" {
  const parts = splitPeople(waitingOn);
  if (!parts.length) return "none";
  const external = parts.filter((part) => !TEAM_NAMES.has(part.toLowerCase()));
  return external.length ? "client" : "team";
}

export function isClientWait(project: WebsiteProject): boolean {
  return isWaiting(project) && waitingKind(project.waitingOn) === "client";
}

export function waitingPhrase(waitingOn: string): string {
  const kind = waitingKind(waitingOn);
  if (kind === "none") return "";
  const label = waitingOn.trim();
  if (kind === "client") {
    if (label.toLowerCase() === "client") return "Waiting on the client";
    return `Waiting on the client · ${label}`;
  }
  return `Waiting on ${label}`;
}

/** Due this week, and coverage items that are not already overdue. */
export function inWeekLane(project: WebsiteProject, today: string): boolean {
  if (!isActive(project) || isOverdue(project, today)) return false;
  return isDueThisWeek(project, today) || project.coverage;
}

/** Open work that is not overdue, not due this week, and not waiting. */
export function inRestLane(project: WebsiteProject, today: string): boolean {
  return (
    isActive(project) &&
    !isOverdue(project, today) &&
    !inWeekLane(project, today) &&
    !isWaiting(project)
  );
}

export function ownedBy(project: WebsiteProject, name: string): boolean {
  return ownerHas(project.owners, name);
}

/** "" is the whole team. "__none" is projects with nobody in Who. */
export function matchesPerson(project: WebsiteProject, person: string): boolean {
  if (!person) return true;
  if (person === "__none") return project.owners.trim().length === 0;
  return ownedBy(project, person);
}

export function waitingBreakdown(projects: WebsiteProject[]): { client: number; team: number } {
  let client = 0;
  let team = 0;
  for (const project of projects) {
    if (!isWaiting(project)) continue;
    if (waitingKind(project.waitingOn) === "client") client += 1;
    else team += 1;
  }
  return { client, team };
}

export function onCoverageList(project: WebsiteProject, today: string): boolean {
  if (project.disposition === "archived" || project.disposition === "launched") return false;
  if (project.coverage) return true;
  return isDueThisWeek(project, today);
}

export function summarize(projects: WebsiteProject[], today: string): WebsiteSummary {
  return {
    active: projects.filter(isActive).length,
    dueThisWeek: projects.filter((p) => isDueThisWeek(p, today)).length,
    overdue: projects.filter((p) => isOverdue(p, today)).length,
    waiting: projects.filter(isWaiting).length,
    launched: projects.filter((p) => p.disposition === "launched").length,
    paused: projects.filter((p) => p.disposition === "paused").length,
    nonResponsive: projects.filter((p) => p.disposition === "non_responsive").length,
  };
}

export function inBucket(project: WebsiteProject, bucket: WebsiteBucket, today: string): boolean {
  switch (bucket) {
    case "":
      return project.disposition === "active" || project.disposition === "paused";
    case "active":
      return isActive(project);
    case "due":
      return isDueThisWeek(project, today);
    case "overdue":
      return isOverdue(project, today);
    case "waiting":
      return isWaiting(project);
    case "launched":
      return project.disposition === "launched";
    case "paused":
      return project.disposition === "paused";
    case "non_responsive":
      return project.disposition === "non_responsive";
    case "coverage":
      return onCoverageList(project, today);
  }
}

export function matchesFilter(
  project: WebsiteProject,
  filter: WebsiteFilter,
  today: string
): boolean {
  if (filter.board && project.board !== filter.board) return false;
  if (filter.stage && project.stage !== filter.stage) return false;
  if (filter.priority && project.priority !== filter.priority) return false;
  if (filter.owner) {
    const needle = filter.owner.trim().toLowerCase();
    if (!project.owners.toLowerCase().includes(needle)) return false;
  }
  const q = filter.q.trim().toLowerCase();
  if (q) {
    const hay = [
      project.name,
      project.clientName,
      project.owners,
      project.waitingOn,
      project.blockers,
      project.nextStep,
      project.platform,
      project.deliverables,
      project.tier,
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return inBucket(project, filter.bucket, today);
}

export function boardColumn(project: WebsiteProject): string {
  if (project.board === "landing") {
    if (project.disposition === "launched" || project.stage === "done") return "done";
    if (project.disposition === "paused" || project.stage === "paused") return "paused";
    return project.stage;
  }
  if (project.disposition === "launched" || project.stage === "launched") return "launched";
  return project.stage;
}

export function onBoard(project: WebsiteProject): boolean {
  return project.disposition !== "archived" && project.disposition !== "non_responsive";
}

const PRIORITY_RANK: Record<WebsitePriority, number> = { high: 0, medium: 1, low: 2 };

export function compareProjects(a: WebsiteProject, b: WebsiteProject): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  if (a.targetOn && b.targetOn && a.targetOn !== b.targetOn) {
    return a.targetOn < b.targetOn ? -1 : 1;
  }
  if (a.targetOn && !b.targetOn) return -1;
  if (!a.targetOn && b.targetOn) return 1;
  return a.name.localeCompare(b.name);
}

const INTERNAL_PROJECT =
  /^(meg website|empire analytics|inframe app|inframe|internal)\b/i;

/**
 * Link a project label to one Campaign Desk client when the names agree.
 * Internal work (MEG site, Empire Analytics, InFrame) stays unlinked.
 * Ambiguous matches stay unlinked so a person picks the client.
 */
export function matchClientId(
  label: string,
  clients: Array<{ id: string; name: string }>
): string | null {
  const raw = label.trim();
  if (!raw || INTERNAL_PROJECT.test(raw)) return null;
  const head = raw.split(/\s+[—–-]\s+/)[0]?.trim() || raw;
  if (!head || INTERNAL_PROJECT.test(head)) return null;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const candidates = [norm(head), norm(raw)].filter((s) => s.length >= 3);
  for (const client of clients) {
    const name = norm(client.name);
    if (name.length >= 3 && candidates.includes(name)) return client.id;
  }
  const hits = clients.filter((client) => {
    const name = norm(client.name);
    if (name.length < 4) return false;
    return candidates.some((n) => n.startsWith(`${name} `) || name.startsWith(`${n} `));
  });
  return hits.length === 1 ? hits[0].id : null;
}

function clip(value: string, max: number, label: string): string | { error: string } {
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} is too long.` };
  return trimmed;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function reconcileDraft(
  draft: WebsiteDraft,
  previous: WebsiteDraft | null,
  touched: Set<string>,
  today: string
): WebsiteDraft {
  const next: WebsiteDraft = { ...draft };
  if (next.board === "landing") next.projectGroup = "";

  if (touched.has("stage") && !touched.has("disposition")) {
    if (TERMINAL_STAGES.has(next.stage)) {
      next.disposition = "launched";
      if (!next.launchOn) next.launchOn = today;
    } else if (next.stage === "paused") {
      next.disposition = "paused";
    } else if (
      previous &&
      (previous.disposition === "launched" || previous.disposition === "paused")
    ) {
      next.disposition = "active";
    }
  }

  if (touched.has("disposition") && next.disposition === "launched" && !TERMINAL_STAGES.has(next.stage)) {
    next.stage = next.board === "landing" ? "done" : "launched";
  }
  if (touched.has("disposition") && next.disposition === "paused" && next.board === "landing") {
    next.stage = "paused";
  }
  if (
    touched.has("disposition") &&
    next.disposition === "active" &&
    (TERMINAL_STAGES.has(next.stage) || next.stage === "paused")
  ) {
    next.stage = defaultStage(next.board) === "briefing" ? "development" : "in_progress";
  }

  if (TERMINAL_STAGES.has(next.stage) && next.disposition === "active") {
    next.disposition = "launched";
  }
  if (next.disposition === "launched" && !next.launchOn) next.launchOn = today;
  if (!next.quarter && next.launchOn) next.quarter = quarterOf(next.launchOn);
  return next;
}

const DRAFT_KEYS: Array<keyof WebsiteDraft> = [
  "board",
  "projectGroup",
  "name",
  "clientName",
  "clientId",
  "tier",
  "platform",
  "deliverables",
  "stage",
  "disposition",
  "outsource",
  "owners",
  "waitingOn",
  "priority",
  "startOn",
  "targetOn",
  "launchOn",
  "lastTouchpoint",
  "nextStep",
  "blockers",
  "basecampUrl",
  "quarter",
  "coverage",
  "coverageWhen",
];

export function applyDraftPatch(
  base: WebsiteDraft,
  patch: Partial<WebsiteDraft>,
  today: string
): { ok: true; draft: WebsiteDraft } | { ok: false; error: string } {
  const touched = new Set<string>();
  const merged: WebsiteDraft = { ...base };
  for (const key of DRAFT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    touched.add(key);
    const value = patch[key];
    if (key === "coverage") {
      merged.coverage = Boolean(value);
    } else if (key === "clientId") {
      merged.clientId = typeof value === "string" && value.trim() ? value.trim() : null;
    } else if (typeof value === "string" || value == null) {
      (merged[key] as string) = asText(value);
    } else {
      return { ok: false, error: "That project could not be read." };
    }
  }

  if (!isWebsiteBoard(merged.board)) return { ok: false, error: "Pick websites or landing pages." };
  if (!WEBSITE_DISPOSITIONS.includes(merged.disposition)) {
    return { ok: false, error: "That status is not one this desk uses." };
  }
  if (!WEBSITE_PRIORITIES.includes(merged.priority)) {
    return { ok: false, error: "Priority should be low, medium, or high." };
  }
  if (merged.projectGroup !== "" && merged.projectGroup !== "web" && merged.projectGroup !== "custom") {
    return { ok: false, error: "Group should be Web or Custom." };
  }

  const name = clip(merged.name, LIMITS.name, "Project name");
  if (typeof name !== "string") return { ok: false, error: name.error };
  if (!name) return { ok: false, error: "A project needs a name." };
  merged.name = name;

  const shortFields: Array<[keyof WebsiteDraft, string]> = [
    ["clientName", "Client name"],
    ["tier", "Tier"],
    ["platform", "Platform"],
    ["deliverables", "Deliverables"],
    ["outsource", "Outsource"],
    ["owners", "Owners"],
    ["waitingOn", "Waiting on"],
    ["quarter", "Quarter"],
    ["coverageWhen", "When"],
  ];
  for (const [key, label] of shortFields) {
    const clipped = clip(String(merged[key] ?? ""), LIMITS.short, label);
    if (typeof clipped !== "string") return { ok: false, error: clipped.error };
    (merged[key] as string) = clipped;
  }
  for (const [key, label] of [
    ["nextStep", "Next step"],
    ["blockers", "Notes"],
  ] as const) {
    const clipped = clip(merged[key], LIMITS.notes, label);
    if (typeof clipped !== "string") return { ok: false, error: clipped.error };
    merged[key] = clipped;
  }

  const url = clip(merged.basecampUrl, LIMITS.url, "Basecamp link");
  if (typeof url !== "string") return { ok: false, error: url.error };
  if (url && !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "Basecamp link should start with http." };
  }
  merged.basecampUrl = url;

  for (const key of ["startOn", "targetOn", "launchOn", "lastTouchpoint"] as const) {
    const raw = merged[key].trim();
    if (!raw) {
      merged[key] = "";
      continue;
    }
    const parsed = parseDeskDate(raw);
    if (!parsed) return { ok: false, error: "Use a real date, like 2026-11-09." };
    merged[key] = parsed;
  }

  const reconciled = reconcileDraft(merged, base, touched, today);
  if (!stagesFor(reconciled.board).some((s) => s.key === reconciled.stage)) {
    return { ok: false, error: "That stage does not belong on this board." };
  }
  return { ok: true, draft: reconciled };
}
