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
const VIDEO_RE = /\b(?:videos?|youtube|filming|editing|reels?)\b/i;
const WEB_RE = /\b(?:website|web|landing page|wordpress|shopify|dev)\b/i;
const SEO_RE = /\b(?:seo|blogs?|keywords|google business|gmb|backlinks)\b/i;
const STRATEGY_RE = /\b(?:strategy|meetings?|reports?|planning|onboarding|kickoffs?)\b/i;

function keywordDepartment(text: string): SnapshotDepartmentSlug | null {
  const value = text || "";
  if (LIFECYCLE_RE.test(value)) return "lifecycle";
  if (ADS_RE.test(value)) return "ads";
  if (SOCIAL_RE.test(value)) return "social";
  if (VIDEO_RE.test(value)) return "video";
  if (WEB_RE.test(value)) return "web";
  if (SEO_RE.test(value)) return "seo";
  if (STRATEGY_RE.test(value)) return "strategy";
  return null;
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

/**
 * The Basecamp list, group, card table, or column name decides the department.
 * The to-do or card title is used only when that name does not match.
 * Anything still unmatched is unsorted.
 */
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
  if (kind && kind !== "Todo") return null;
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
    sourceKey: `todo:${id}`,
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
  }>,
  today: string
): SnapshotTodoHit[] {
  const out: SnapshotTodoHit[] = [];
  for (const row of rows) {
    const hit = snapshotTodoHit(
      {
        id: row.id,
        title: row.title,
        type: "Todo",
        completed: Boolean((row.completedAt || "").trim()),
        completed_at: row.completedAt,
        starts_on: row.startsOn,
        parent: { title: snapshotListPlace(row.list) },
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

export function matchSnapshotDepartment(input: {
  title: string;
  place: string;
  assigneeNames?: string[];
}): SnapshotSuggestionDepartment {
  const fromPlace = keywordDepartment(input.place || "");
  if (fromPlace) return fromPlace;
  const fromTitle = keywordDepartment(input.title || "");
  if (fromTitle) return fromTitle;
  return "unsorted";
}
