// Turn Basecamp activity into weekly snapshot suggestions.
//
// Pure: no network and no database. The editor fetches completed to-dos, then
// this file decides the department, drops anything outside the week, and hides
// items the team already added or dismissed.

import { ACCOUNT_MANAGER_BASECAMP_NAME, personTeam, type Team } from "./people";
import { slugForName } from "./team";
import type { SnapshotDepartmentSlug, SnapshotItemStatus } from "./snapshot-department-list";
import { addWeeks } from "./week";

export type SnapshotSuggestionDepartment = SnapshotDepartmentSlug | "unsorted";

export type BasecampActivity = {
  /** Stable id, e.g. todo:123. Dismissal is keyed on this. */
  sourceKey: string;
  title: string;
  /** Where it lived: todo list, group, or card column. */
  place: string;
  assigneeNames?: string[];
  /** Basecamp completed_at, ISO or YYYY-MM-DD. For a sent card, when it moved. */
  completedAt?: string | null;
  /**
   * "sent" is a card moved to a Sent-for-approval column. It was delivered,
   * and it is not a completed check.
   */
  mark?: "done" | "sent";
};

export type DepartmentSuggestion = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotSuggestionDepartment;
  /** "sent" keeps the suggestion off the green completed check. */
  mark?: "done" | "sent";
};

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

/** Calendar day in Pacific, so a Friday-evening completion stays in that week. */
export function pacificYmd(iso: string): string {
  const raw = (iso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function completedInSnapshotWeek(
  completedAt: string | null | undefined,
  weekStart: string
): boolean {
  const ymd = pacificYmd(completedAt || "");
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return false;
  return ymd >= weekStart && ymd < addWeeks(weekStart, 1);
}

export function normalizeSuggestionText(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Suggestions for one week. Dismissed keys stay hidden. A to-do already on a
 * department list stays hidden even after its wording is edited. The same
 * wording, with no source id, is also hidden.
 */
export function suggestionsForWeek(input: {
  activities: BasecampActivity[];
  weekStart: string;
  existingItems: string[];
  /** source_key values already stored on this week's list items. */
  existingSourceKeys?: string[];
  dismissedKeys: string[];
}): DepartmentSuggestion[] {
  const dismissed = new Set(input.dismissedKeys);
  const takenKeys = new Set((input.existingSourceKeys || []).map((key) => key.trim()).filter(Boolean));
  const taken = new Set(
    input.existingItems.map((item) => normalizeSuggestionText(item)).filter(Boolean)
  );
  const seenTitle = new Set<string>();
  const out: DepartmentSuggestion[] = [];
  for (const activity of input.activities) {
    const title = (activity.title || "").trim();
    if (!title) continue;
    if (!activity.sourceKey || dismissed.has(activity.sourceKey) || takenKeys.has(activity.sourceKey)) {
      continue;
    }
    if (!completedInSnapshotWeek(activity.completedAt, input.weekStart)) continue;
    const key = normalizeSuggestionText(title);
    if (!key || taken.has(key) || seenTitle.has(key)) continue;
    seenTitle.add(key);
    out.push({
      sourceKey: activity.sourceKey,
      title,
      place: (activity.place || "").trim(),
      department: matchSnapshotDepartment({
        title,
        place: activity.place || "",
        assigneeNames: activity.assigneeNames,
      }),
      mark: activity.mark === "sent" ? "sent" : "done",
    });
  }
  return out;
}
