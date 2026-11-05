// Turn Basecamp activity into weekly snapshot suggestions.
//
// Pure: no network and no database. The editor fetches completed to-dos, then
// this file decides the department, drops anything outside the week, and hides
// items the team already added or dismissed.

import { ACCOUNT_MANAGER_BASECAMP_NAME, personTeam, type Team } from "./people";
import { slugForName } from "./team";
import type { SnapshotDepartmentSlug } from "./snapshot-department-list";
import { addWeeks } from "./week";

export type SnapshotSuggestionDepartment = SnapshotDepartmentSlug | "unsorted";

export type BasecampActivity = {
  /** Stable id, e.g. todo:123. Dismissal is keyed on this. */
  sourceKey: string;
  title: string;
  /** Where it lived: todo list, group, or card column. */
  place: string;
  assigneeNames?: string[];
  /** Basecamp completed_at, ISO or YYYY-MM-DD. */
  completedAt?: string | null;
};

export type DepartmentSuggestion = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotSuggestionDepartment;
};

const KEYWORD_RULES: { department: SnapshotDepartmentSlug; pattern: RegExp }[] = [
  { department: "seo", pattern: /\b(?:seo|blogs?)\b/i },
  { department: "social", pattern: /\b(?:social|instagram|facebook|tiktok|linkedin|reels?)\b/i },
  { department: "video", pattern: /\b(?:videos?|youtube|film(?:ing|ed)?|shoot)\b/i },
  { department: "web", pattern: /\b(?:website|web)\b/i },
  {
    department: "lifecycle",
    pattern: /\b(?:emails?|sms|automations?|klaviyo|lifecycle|newsletters?)\b/i,
  },
  { department: "strategy", pattern: /\b(?:strategy|strategic)\b/i },
];

function keywordDepartment(text: string): SnapshotDepartmentSlug | null {
  const value = text || "";
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(value)) return rule.department;
  }
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
 * List or column name wins, then the to-do title, then a specialist assignee.
 * Anything still unmatched is unsorted so a person can choose the department.
 */
export function matchSnapshotDepartment(input: {
  title: string;
  place: string;
  assigneeNames?: string[];
}): SnapshotSuggestionDepartment {
  const fromPlace = keywordDepartment(input.place || "");
  if (fromPlace) return fromPlace;
  const fromTitle = keywordDepartment(input.title || "");
  if (fromTitle) return fromTitle;
  for (const name of input.assigneeNames || []) {
    const fromPerson = departmentForAssigneeName(name);
    if (fromPerson) return fromPerson;
  }
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
 * Suggestions for one week. Dismissed keys stay hidden. An item already on
 * any department list, with the same wording, is not suggested again.
 */
export function suggestionsForWeek(input: {
  activities: BasecampActivity[];
  weekStart: string;
  existingItems: string[];
  dismissedKeys: string[];
}): DepartmentSuggestion[] {
  const dismissed = new Set(input.dismissedKeys);
  const taken = new Set(
    input.existingItems.map((item) => normalizeSuggestionText(item)).filter(Boolean)
  );
  const seenTitle = new Set<string>();
  const out: DepartmentSuggestion[] = [];
  for (const activity of input.activities) {
    const title = (activity.title || "").trim();
    if (!title) continue;
    if (!activity.sourceKey || dismissed.has(activity.sourceKey)) continue;
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
    });
  }
  return out;
}
