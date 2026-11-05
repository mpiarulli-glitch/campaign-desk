// On-demand Basecamp suggestions for the weekly snapshot editor.
//
// Completed to-dos on the client's linked project, kept for ten minutes so
// opening the editor again does not walk Basecamp every time. Refresh skips
// the cache. Nothing here runs at process start. A missing project or a
// Basecamp failure is an empty list.

import { getProjectPeopleForMention, listProjectCompletedTodos } from "./basecamp";
import { getDb, nowIso } from "./db";
import { nanoid } from "nanoid";
import { getRevClient } from "./revenue";
import { departmentNotesForWeek } from "./snapshot-departments";
import {
  suggestionsForWeek,
  type BasecampActivity,
  type DepartmentSuggestion,
} from "./snapshot-basecamp-suggestions";

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; activities: BasecampActivity[] }>();

export function clearBasecampSuggestionCache(): void {
  cache.clear();
}

async function activitiesForProject(projectId: string, refresh: boolean): Promise<BasecampActivity[]> {
  const cached = cache.get(projectId);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.activities;
  try {
    const [todos, people] = await Promise.all([
      listProjectCompletedTodos(projectId),
      getProjectPeopleForMention(projectId).catch(() => []),
    ]);
    const names = new Map(people.map((person) => [person.id, person.name]));
    const activities = todos.map((todo) => ({
      sourceKey: `todo:${todo.id}`,
      title: todo.title,
      place: todo.list,
      assigneeNames: todo.assigneeIds
        .map((id) => names.get(id) || "")
        .filter(Boolean),
      completedAt: todo.completedAt || null,
    }));
    cache.set(projectId, { at: Date.now(), activities });
    return activities;
  } catch {
    return [];
  }
}

export function dismissedSuggestionKeys(clientId: string, weekStart: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT source_key FROM snapshot_suggestion_dismissals
       WHERE client_id = ? AND week_start = ?`
    )
    .all(clientId, weekStart) as Array<{ source_key: string }>;
  return rows.map((row) => row.source_key);
}

export function dismissWeekSuggestion(input: {
  clientId: string;
  weekStart: string;
  sourceKey: string;
}): void {
  const key = input.sourceKey.trim();
  if (!key) return;
  getDb()
    .prepare(
      `INSERT INTO snapshot_suggestion_dismissals
         (id, client_id, week_start, source_key, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id, week_start, source_key) DO NOTHING`
    )
    .run(nanoid(12), input.clientId, input.weekStart, key, nowIso());
}

export async function weekBasecampSuggestions(
  clientId: string,
  weekStart: string,
  opts?: { refresh?: boolean }
): Promise<DepartmentSuggestion[]> {
  const projectId = (getRevClient(clientId)?.basecamp_project_id || "").trim();
  if (!projectId) return [];
  const activities = await activitiesForProject(projectId, Boolean(opts?.refresh));
  const existing = departmentNotesForWeek(clientId, weekStart).flatMap((note) =>
    note.items.map((item) => item.body)
  );
  return suggestionsForWeek({
    activities,
    weekStart,
    existingItems: existing,
    dismissedKeys: dismissedSuggestionKeys(clientId, weekStart),
  });
}
