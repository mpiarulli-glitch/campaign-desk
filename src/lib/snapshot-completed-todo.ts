import {
  clientNameFor,
  isInternalProject,
} from "@/lib/basecamp-clients";
import { isTemplateLibraryProject } from "@/lib/assignments";

function foldName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Loose check that a Basecamp project belongs to this client.
 *
 * Client Growth OS projects are usually named
 * "<Client> Growth OS - Powered by the Empire Method", so the Growth OS /
 * Powered-by suffix is stripped before comparing.
 */
export function projectLooksLikeClient(
  projectName: string,
  clientName: string
): boolean {
  const project = foldName(clientNameFor(projectName) || projectName);
  const client = foldName(clientName);
  if (!project || !client) return true;
  if (project === client) return true;
  if (project.includes(client) || client.includes(project)) return true;
  // Token overlap: "Cisco Restaurant Bar" vs "CISCo Restaurant + Bar"
  const pTokens = new Set(project.split(" ").filter((t) => t.length > 2));
  const cTokens = client.split(" ").filter((t) => t.length > 2);
  if (!cTokens.length) return true;
  const hits = cTokens.filter((t) => pTokens.has(t)).length;
  return hits >= Math.min(2, cTokens.length);
}

/**
 * Linked Basecamp projects that must never feed the snapshot completed-todo
 * picker — shared libraries, department HQs, and deliverable templates.
 */
export function isNonClientBasecampProject(projectName: string): boolean {
  const name = (projectName || "").trim();
  if (!name) return false;
  return isInternalProject(name) || isTemplateLibraryProject(name);
}

export type CompletedTodoScopeReason =
  | "unknown-client"
  | "not-connected"
  | "no-project"
  | "not-client-project"
  | "project-mismatch"
  | "no-todos"
  | "failed";

/**
 * Decide whether completed to-dos from this linked project may be offered for
 * the given client. Internal / template projects are refused outright so the
 * picker cannot pull Department Library or Deliverable Templates work into a
 * client week.
 */
export function completedTodoScopeReason(
  projectName: string | null | undefined,
  clientName: string
): "not-client-project" | "project-mismatch" | null {
  const name = (projectName || "").trim();
  if (!name) return null;
  if (isNonClientBasecampProject(name)) return "not-client-project";
  if (!projectLooksLikeClient(name, clientName)) return "project-mismatch";
  return null;
}
