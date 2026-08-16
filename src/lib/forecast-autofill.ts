import {
  asPerson,
  basecampConnected,
  hasConnection,
  listAssignedDueTodos,
} from "./basecamp";
import { getConnection } from "./basecamp-identity";
import { clientNameFor } from "./basecamp-clients";
import { createTask, linkedTodoIdsForPerson, type ForecastTask } from "./forecast";
import { planAutofill } from "./forecast-autofill-plan";
import { listRevClients } from "./revenue";

export { AUTO_TODO_HOURS, planAutofill } from "./forecast-autofill-plan";

function clientNameForProject(projectId: string, projectName: string): string {
  const hit = listRevClients(true).find((c) => c.basecamp_project_id === projectId);
  if (hit?.name) return hit.name;
  return clientNameFor(projectName) || projectName;
}

export async function autofillForecastFromTodos(
  person: string,
  weekStart: string
): Promise<{
  tasks: ForecastTask[];
  added: number;
  skippedExisting: number;
  skippedOtherWeek: number;
  scanned: number;
  reason: string | null;
}> {
  if (!basecampConnected()) {
    return {
      tasks: [],
      added: 0,
      skippedExisting: 0,
      skippedOtherWeek: 0,
      scanned: 0,
      reason: "not-connected",
    };
  }
  const conn = getConnection(person);
  if (!conn || !hasConnection(person)) {
    return {
      tasks: [],
      added: 0,
      skippedExisting: 0,
      skippedOtherWeek: 0,
      scanned: 0,
      reason: "person-not-connected",
    };
  }

  const assigned = await listAssignedDueTodos(conn.bc_person_id, asPerson(person));
  const plan = planAutofill({
    weekStart,
    existingTodoIds: linkedTodoIdsForPerson(person),
    candidates: assigned.map((t) => ({
      todoId: t.id,
      title: t.title,
      dueOn: t.dueOn,
      projectId: t.projectId,
      client: clientNameForProject(t.projectId, t.projectName),
    })),
  });

  const tasks = plan.items.map((item) =>
    createTask({
      person,
      taskDate: item.taskDate,
      client: item.client,
      notes: item.notes,
      hours: item.hours,
      basecampTodoId: item.basecampTodoId,
      basecampProjectId: item.basecampProjectId,
    })
  );

  return {
    tasks,
    added: tasks.length,
    skippedExisting: plan.skippedExisting,
    skippedOtherWeek: plan.skippedOtherWeek,
    scanned: assigned.length,
    reason: assigned.length ? null : "no-assigned-due",
  };
}
