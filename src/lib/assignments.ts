// Shaping for Basecamp's /my/assignments.json, kept separate from the request so
// it can be tested against real payload shapes without a live account.
//
// Three things about that endpoint drive the code here:
//
//   1. The text is in `content` and `title` is null — the opposite way round
//      from most of the API.
//   2. It returns to-dos AND card-table cards. Both take timesheet entries, and
//      a card reports /buckets/{project}/todos/{id}/completion.json as its own
//      completion_url, so nothing downstream has to tell them apart.
//   3. Subtasks arrive as `children` of an assigned to-do rather than as
//      assignments of their own, because a step carries no assignees. That is
//      the same inheritance rule the per-project picker applies.

export type AssignmentKind = "todo" | "card" | "step";

export interface BcAssignment {
  id: string;
  title: string;
  kind: AssignmentKind;
  projectId: string;
  projectName: string;
  // The to-do list or card column it sits in, for context in a list that spans
  // every project.
  list: string;
  dueOn: string | null;
  parentId?: string;
  parentTitle?: string;
  appUrl: string;
}

export interface AssignmentRaw {
  id: number;
  type?: string;
  title?: string | null;
  content?: string | null;
  due_on?: string | null;
  completed?: boolean;
  app_url?: string;
  bucket?: { id: number; name?: string };
  parent?: { id: number; title?: string };
  children?: AssignmentRaw[];
}

export interface AssignmentsPayload {
  priorities?: AssignmentRaw[];
  non_priorities?: AssignmentRaw[];
}

function kindOf(type: string): AssignmentKind | null {
  const t = (type || "").toLowerCase();
  if (t === "todo" || t === "card" || t === "step") return t;
  return null;
}

function textOf(row: AssignmentRaw): string {
  return (row.content || row.title || "").trim();
}

/**
 * Flatten the payload into a pickable list: every open assignment, each with any
 * open subtasks immediately after it.
 *
 * Completed items are dropped at both levels — this backs a "what should I be
 * doing" list, and a done parent's open subtasks are still worth showing, which
 * is why the child walk does not depend on the parent surviving.
 */
export function shapeAssignments(payload: AssignmentsPayload): BcAssignment[] {
  const rows = [...(payload.priorities || []), ...(payload.non_priorities || [])];
  const out: BcAssignment[] = [];

  for (const row of rows) {
    const kind = kindOf(row.type || "");
    // A step at the top level would have no parent context, and Basecamp does
    // not put them there anyway.
    if (!kind || kind === "step") continue;
    const projectId = String(row.bucket?.id || "");
    if (!projectId) continue;
    const title = textOf(row);
    const projectName = row.bucket?.name || "";
    const list = (row.parent?.title || "").trim();

    if (title && !row.completed) {
      out.push({
        id: String(row.id),
        title,
        kind,
        projectId,
        projectName,
        list,
        dueOn: row.due_on || null,
        appUrl: row.app_url || "",
      });
    }

    for (const child of row.children || []) {
      if (child.completed) continue;
      if (kindOf(child.type || "") !== "step") continue;
      const childTitle = textOf(child);
      if (!childTitle) continue;
      out.push({
        id: String(child.id),
        title: childTitle,
        kind: "step",
        projectId,
        projectName,
        list,
        // A step carries no date of its own, so it falls due when its parent
        // does — the same rule the per-project picker uses.
        dueOn: child.due_on || row.due_on || null,
        parentId: String(row.id),
        parentTitle: title,
        appUrl: child.app_url || row.app_url || "",
      });
    }
  }
  return out;
}
