// Classify Basecamp to-dos for the manual weekly-snapshot add picker.
//
// Pure: no network and no database. Opening a week does not import these.
// The picker offers a department's lists, and asks which department an
// unmatched list belongs to before it is added.

import { ACCOUNT_MANAGER_BASECAMP_NAME, personTeam, type Team } from "./people";
import { slugForName } from "./team";
import type { SnapshotDepartmentSlug, SnapshotItemStatus } from "./snapshot-department-list";

export type SnapshotSuggestionDepartment = SnapshotDepartmentSlug | "unsorted";

// Lifecycle is tested first. A list that mentions LinkedIn and also email, SMS,
// or automations belongs to Lifecycle, not Social Media.
const LIFECYCLE_RE =
  /\b(?:emails?|sms|texts?|mms|linkedin|automations?|flows?|klaviyo|ghl|go high level|mailchimp|hubspot|newsletters?|drips?|lifecycle|retention|loyalty|push)\b/i;
// Checked before Social. "Paid Social" and "Meta Ads" are Ads, not Social Media.
const ADS_RE =
  /\b(?:google ads|meta ads|facebook ads|paid social|campaign budget|retargeting|ads|ad|paid|ppc|sem)\b/i;
const SOCIAL_RE = /\b(?:social|instagram|facebook|tiktok|content calendar|posts)\b/i;
// "Vid", "film", and "production" are how Ecoworkz names video work
// ("07 Oct Vid", "Film the testimonial", "Social / Content / Production").
const VIDEO_RE =
  /\b(?:videos?|vids?|youtube|film(?:ing|ed|s)?|shoots?|editing|reels?|productions?)\b/i;
const WEB_RE = /\b(?:website|web|landing page|wordpress|shopify|dev)\b/i;
// "keyword" is often singular, and this team writes Google Business as GBP.
const SEO_RE =
  /\b(?:seo|blogs?|keywords?|google business|gmb|gbp|backlinks?|service pages?)\b/i;
const STRATEGY_RE = /\b(?:strategy|meetings?|reports?|planning|onboarding|kickoffs?)\b/i;

const DEPARTMENT_RES: Array<{ department: SnapshotDepartmentSlug; pattern: RegExp }> = [
  { department: "lifecycle", pattern: LIFECYCLE_RE },
  { department: "ads", pattern: ADS_RE },
  { department: "social", pattern: SOCIAL_RE },
  { department: "video", pattern: VIDEO_RE },
  { department: "web", pattern: WEB_RE },
  { department: "seo", pattern: SEO_RE },
  { department: "strategy", pattern: STRATEGY_RE },
];

function keywordDepartment(text: string): SnapshotDepartmentSlug | null {
  const value = text || "";
  for (const rule of DEPARTMENT_RES) {
    if (rule.pattern.test(value)) return rule.department;
  }
  return null;
}

/** Every department a string names, in the same priority order as a single match. */
function departmentsIn(text: string): SnapshotDepartmentSlug[] {
  const value = text || "";
  const found: SnapshotDepartmentSlug[] = [];
  for (const rule of DEPARTMENT_RES) {
    if (rule.pattern.test(value)) found.push(rule.department);
  }
  return found;
}

/**
 * Departments named by a list, board, or column path.
 * "Social / Content / Production" is social and video. "Paid Social" stays
 * ads, because that phrase is one segment and ads is checked before social.
 * A todoset or board prefix is included when the caller left it on the place.
 */
function departmentsInPlace(place: string): SnapshotDepartmentSlug[] {
  const segments = (place || "")
    .split(/\s*(?:›|\/)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const found: SnapshotDepartmentSlug[] = [];
  for (const segment of segments.length ? segments : [(place || "").trim()]) {
    if (!segment) continue;
    const dept = keywordDepartment(segment);
    if (dept && !found.includes(dept)) found.push(dept);
  }
  return found;
}

function departmentForTeam(team: Team | null): SnapshotDepartmentSlug | null {
  if (team === "seo") return "seo";
  if (team === "social") return "social";
  if (team === "web") return "web";
  if (team === "email") return "lifecycle";
  return null;
}

/** Specialist team of a Basecamp display name, when we know that person. */
export function departmentForAssigneeName(name: string): SnapshotDepartmentSlug | null {
  const raw = (name || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const candidates: string[] = [];
  for (const [slug, bcName] of Object.entries(ACCOUNT_MANAGER_BASECAMP_NAME)) {
    if ((bcName || "").trim().toLowerCase() === lower) candidates.push(slug);
  }
  candidates.push(raw);
  const first = raw.split(/\s+/)[0];
  if (first && first !== raw) candidates.push(first);
  for (const candidate of candidates) {
    const slug = slugForName(candidate);
    if (!slug) continue;
    const dept = departmentForTeam(personTeam(slug));
    if (dept) return dept;
  }
  return null;
}

export type SnapshotTodoHit = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotSuggestionDepartment;
  status: SnapshotItemStatus;
};

/**
 * One Basecamp search row, already limited to the client's project.
 * A finished to-do is Completed. A future start date is Scheduled.
 * Anything else still open is In progress.
 */
export function snapshotTodoHit(
  row: {
    id?: number | string;
    title?: string;
    content?: string;
    type?: string;
    completed?: boolean;
    completed_at?: string | null;
    starts_on?: string | null;
    parent?: { title?: string; name?: string } | null;
  },
  today: string
): SnapshotTodoHit | null {
  const kind = (row.type || "Todo").trim();
  const card = kind === "Kanban::Card";
  if (kind && kind !== "Todo" && !card) return null;
  const title = (row.title || row.content || "").trim();
  const id = String(row.id ?? "").trim();
  if (!title || !id) return null;
  const place = (row.parent?.title || row.parent?.name || "").trim();
  const finished = row.completed === true || Boolean((row.completed_at || "").trim());
  const starts = (row.starts_on || "").trim();
  const status: SnapshotItemStatus = finished
    ? "completed"
    : starts && today && starts > today
      ? "scheduled"
      : "in_progress";
  return {
    sourceKey: `${card ? "card" : "todo"}:${id}`,
    title,
    place,
    department: matchSnapshotDepartment({ title, place }),
    status,
  };
}

/**
 * Drop the todoset prefix Basecamp's project walk puts on a list label
 * ("To Dos › Meta Ads" → "Meta Ads") so department matching sees the list,
 * not the todoset. A bare name is left as-is.
 * Card boards are not passed through here: "VIDEOS › Ready for Review" has
 * to keep the board name, and the column is only a status.
 */
export function snapshotListPlace(label: string): string {
  const parts = (label || "")
    .split(" › ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return (label || "").trim();
  return parts.slice(1).join(" › ");
}

/** Project to-dos, as the snapshot add picker receives them from Basecamp. */
export function snapshotHitsForPicker(
  rows: Array<{
    id: string;
    title: string;
    list: string;
    completedAt?: string | null;
    startsOn?: string | null;
    kind?: "todo" | "card";
  }>,
  today: string
): SnapshotTodoHit[] {
  const out: SnapshotTodoHit[] = [];
  for (const row of rows) {
    const card = row.kind === "card";
    const hit = snapshotTodoHit(
      {
        id: row.id,
        title: row.title,
        type: card ? "Kanban::Card" : "Todo",
        completed: Boolean((row.completedAt || "").trim()),
        completed_at: row.completedAt,
        starts_on: row.startsOn,
        parent: { title: card ? (row.list || "").trim() : snapshotListPlace(row.list) },
      },
      today
    );
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * To-dos the add row for one department can offer.
 * A list that maps to this department is ready to add. An unmatched list is
 * offered too, and the row has to ask which department it belongs to.
 * Anything already on this week is hidden.
 */
export function pickerTodosForDepartment(
  todos: SnapshotTodoHit[],
  department: SnapshotDepartmentSlug,
  takenSourceKeys: string[]
): { matched: SnapshotTodoHit[]; unmatched: SnapshotTodoHit[] } {
  const taken = new Set(takenSourceKeys.map((key) => key.trim()).filter(Boolean));
  const matched: SnapshotTodoHit[] = [];
  const unmatched: SnapshotTodoHit[] = [];
  for (const todo of todos) {
    if (!todo.sourceKey || taken.has(todo.sourceKey)) continue;
    if (todo.department === department) matched.push(todo);
    else if (todo.department === "unsorted") unmatched.push(todo);
  }
  return { matched, unmatched };
}

/**
 * One department in the list or board name wins over the title.
 * A path that names two departments ("Social / Content / Production") uses
 * the title to choose, including a title that names a third department
 * ("Set up GBP" is SEO). A title that names nothing stays with the first
 * department in that path. Anything still unmatched is unsorted.
 */
export function matchSnapshotDepartment(input: {
  title: string;
  place: string;
  assigneeNames?: string[];
}): SnapshotSuggestionDepartment {
  const fromPlace = departmentsInPlace(input.place || "");
  if (fromPlace.length === 1) return fromPlace[0];
  const fromTitle = departmentsIn(input.title || "");
  if (fromPlace.length > 1) {
    const overlap = fromTitle.filter((dept) => fromPlace.includes(dept));
    if (overlap.length) return overlap[0];
    if (fromTitle.length) return fromTitle[0];
    return fromPlace[0];
  }
  if (fromTitle.length) return fromTitle[0];
  return "unsorted";
}
