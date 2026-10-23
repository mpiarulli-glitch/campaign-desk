// Fill blank rev_clients.basecamp_project_id values from the King Kashflow
// service connection.
//
// This is not a startup task. Railway's /api/health check has 30 seconds, and
// listing Basecamp projects is a network walk. Call it from the admin action
// or from the Forecast page after the server is already serving. It only fills
// blanks, so running it again is safe. A short in-memory cache keeps a second
// page view from listing Basecamp again, and still links a client created
// since the last listing.

import { basecampConnected, extractProjectId, listProjects, SERVICE } from "./basecamp";
import {
  forecastPersonNames,
  isInternalProject,
  PROJECT_ALIASES,
} from "./basecamp-clients";
import {
  basecampProjectChoices,
  isPersonOrInternalClientName,
  matchUnlinkedClients,
  type MatchProject,
} from "./basecamp-client-match";
import { getDb, nowIso } from "./db";
import { getRevClient, listRevClients } from "./revenue";

export const BASECAMP_DISCONNECTED_MESSAGE =
  "Basecamp isn't connected. Reconnect the King Kashflow service account, then try again.";

export const BASECAMP_UNREACHABLE_MESSAGE =
  "Couldn't reach Basecamp. The King Kashflow connection may need to be reconnected.";

export const BASECAMP_NO_PROJECTS_MESSAGE =
  "Basecamp didn't return any projects. The King Kashflow connection may need to be reconnected.";

export const BASECAMP_PROJECT_CACHE_MS = 10 * 60 * 1000;

export type ForecastClientRef = { id: string; name: string };

export type LinkedClientProject = {
  client: string;
  project: string;
  clientId: string;
  projectId: string;
};

export type LinkMissingReport = {
  ok: boolean;
  dryRun: boolean;
  fromCache: boolean;
  /** True when a silent Forecast load skipped Basecamp because one just ran. */
  skipped?: boolean;
  error: string | null;
  linked: LinkedClientProject[];
  ambiguous: Array<{ client: string; options: string[] }>;
  noProject: string[];
  missing: ForecastClientRef[];
  projects: Array<{ id: string; name: string }>;
};

type ProjectSource = Array<{ id: number | string; name: string }>;

type LinkDeps = {
  dryRun?: boolean;
  /** Bypass the in-memory project cache and list Basecamp again. */
  force?: boolean;
  /** Forecast page load. Uses the cache, and will not call Basecamp again inside the throttle window. */
  silent?: boolean;
  now?: () => number;
  connected?: () => boolean;
  loadProjects?: () => Promise<ProjectSource>;
};

let projectCache: { at: number; projects: MatchProject[] } | null = null;
let lastSilentNetworkAt = 0;

export function resetBasecampProjectCacheForTests(): void {
  projectCache = null;
  lastSilentNetworkAt = 0;
}

/** Active Forecast clients with no Basecamp project. People and internal rows are left out. */
export function listForecastClientsMissingBasecamp(): ForecastClientRef[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name FROM rev_clients
        WHERE active = 1 AND TRIM(IFNULL(basecamp_project_id, '')) = ''
        ORDER BY name COLLATE NOCASE`
    )
    .all() as ForecastClientRef[];
  const people = forecastPersonNames();
  return rows.filter(
    (row) =>
      row.name.trim() && !isPersonOrInternalClientName(row.name, people, isInternalProject)
  );
}

/** Set the project only while the column is still blank. Returns false if it was already set. */
export function assignBasecampProjectIfBlank(clientId: string, projectId: string): boolean {
  const id = projectId.trim();
  if (!clientId || !id) return false;
  const result = getDb()
    .prepare(
      `UPDATE rev_clients
          SET basecamp_project_id = ?, updated_at = ?
        WHERE id = ?
          AND TRIM(IFNULL(basecamp_project_id, '')) = ''`
    )
    .run(id, nowIso(), clientId);
  return result.changes > 0;
}

function skippedReport(): LinkMissingReport {
  return {
    ok: true,
    dryRun: false,
    fromCache: false,
    skipped: true,
    error: null,
    linked: [],
    ambiguous: [],
    noProject: [],
    missing: [],
    projects: [],
  };
}

function failure(error: string, dryRun: boolean): LinkMissingReport {
  const missing = safeMissing();
  return {
    ok: false,
    dryRun,
    fromCache: false,
    skipped: false,
    error,
    linked: [],
    ambiguous: [],
    noProject: missing.map((c) => c.name),
    missing,
    projects: [],
  };
}

function safeMissing(): ForecastClientRef[] {
  try {
    return listForecastClientsMissingBasecamp();
  } catch {
    return [];
  }
}

function connectionMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/not connected/i.test(message)) return BASECAMP_DISCONNECTED_MESSAGE;
  return BASECAMP_UNREACHABLE_MESSAGE;
}

async function serviceProjects(deps: LinkDeps): Promise<
  | { ok: true; projects: MatchProject[]; fromCache: boolean }
  | { ok: false; error: string }
> {
  const now = deps.now?.() ?? Date.now();
  const force = deps.force === true;
  if (!force && projectCache && now - projectCache.at < BASECAMP_PROJECT_CACHE_MS) {
    return { ok: true, projects: projectCache.projects, fromCache: true };
  }
  const connected = deps.connected?.() ?? basecampConnected();
  if (!connected) return { ok: false, error: BASECAMP_DISCONNECTED_MESSAGE };
  try {
    const listed = await (
      deps.loadProjects ?? (() => listProjects(SERVICE, force ? { fresh: true } : undefined))
    )();
    const projects = (listed || [])
      .map((p) => ({ id: String(p.id ?? "").trim(), name: p.name || "" }))
      .filter((p) => p.id);
    if (!projects.length) return { ok: false, error: BASECAMP_NO_PROJECTS_MESSAGE };
    projectCache = { at: now, projects };
    return { ok: true, projects, fromCache: false };
  } catch (err) {
    return { ok: false, error: connectionMessage(err) };
  }
}

function planFrom(projects: MatchProject[]) {
  const people = forecastPersonNames();
  const clients = listRevClients(true).map((c) => ({
    id: c.id,
    name: c.name,
    basecampProjectId: (c.basecamp_project_id || "").trim(),
    active: c.active === 1,
    eligible: !isPersonOrInternalClientName(c.name, people, isInternalProject),
  }));
  return matchUnlinkedClients(clients, projects, {
    aliases: PROJECT_ALIASES,
    isInternal: isInternalProject,
  });
}

/**
 * Link active Forecast clients to King Kashflow's Basecamp projects when the
 * name match is confident. Never overwrites a project id that is already set.
 */
export async function linkMissingBasecampProjects(deps?: LinkDeps): Promise<LinkMissingReport> {
  const dryRun = deps?.dryRun === true;
  const silent = deps?.silent === true;
  const now = deps?.now?.() ?? Date.now();
  // A Forecast page load must not walk Basecamp on every visit. A fresh cache
  // still links a client created since the last listing. A failed attempt
  // waits out the same window instead of retrying on the next click.
  if (silent && deps?.force !== true) {
    const cacheFresh = Boolean(
      projectCache && now - projectCache.at < BASECAMP_PROJECT_CACHE_MS
    );
    const throttled = lastSilentNetworkAt > 0 && now - lastSilentNetworkAt < BASECAMP_PROJECT_CACHE_MS;
    if (!cacheFresh && throttled) return skippedReport();
    if (!cacheFresh) lastSilentNetworkAt = now;
  }
  const loaded = await serviceProjects(silent ? { ...deps, force: false } : deps ?? {});
  if (!loaded.ok) return failure(loaded.error, dryRun);

  let plan;
  try {
    plan = planFrom(loaded.projects);
  } catch (err) {
    return failure(connectionMessage(err), dryRun);
  }

  const linked: LinkedClientProject[] = [];
  for (const match of plan.matches) {
    if (dryRun) {
      linked.push({
        client: match.clientName,
        project: match.projectName,
        clientId: match.clientId,
        projectId: match.projectId,
      });
      continue;
    }
    if (!assignBasecampProjectIfBlank(match.clientId, match.projectId)) continue;
    linked.push({
      client: match.clientName,
      project: match.projectName,
      clientId: match.clientId,
      projectId: match.projectId,
    });
  }

  const missing = safeMissing();
  return {
    ok: true,
    dryRun,
    fromCache: loaded.fromCache,
    skipped: false,
    error: null,
    linked,
    ambiguous: plan.ambiguous.map((a) => ({ client: a.clientName, options: a.options })),
    noProject: missing.map((c) => c.name),
    missing,
    projects: basecampProjectChoices(loaded.projects, isInternalProject),
  };
}

export async function linkClientToBasecampProject(
  clientId: string,
  rawProjectId: string,
  deps?: LinkDeps
): Promise<{ ok: true; clientId: string; projectId: string } | { ok: false; error: string; status: number }> {
  const client = getRevClient((clientId || "").trim());
  if (!client) return { ok: false, error: "Client not found.", status: 404 };
  const projectId = extractProjectId(rawProjectId || "");
  if (!projectId) return { ok: false, error: "Choose a Basecamp project.", status: 400 };

  const existing = (client.basecamp_project_id || "").trim();
  if (existing) {
    if (existing === projectId) return { ok: true, clientId: client.id, projectId };
    return { ok: false, error: "This client already has a Basecamp project.", status: 400 };
  }

  const loaded = await serviceProjects({ ...deps, force: deps?.force === true });
  if (!loaded.ok) return { ok: false, error: loaded.error, status: 400 };
  const choices = basecampProjectChoices(loaded.projects, isInternalProject);
  if (!choices.some((p) => p.id === projectId)) {
    return {
      ok: false,
      error: "That project isn't on the King Kashflow account.",
      status: 400,
    };
  }
  if (!assignBasecampProjectIfBlank(client.id, projectId)) {
    const again = getRevClient(client.id);
    if ((again?.basecamp_project_id || "").trim() === projectId) {
      return { ok: true, clientId: client.id, projectId };
    }
    return { ok: false, error: "This client already has a Basecamp project.", status: 400 };
  }
  return { ok: true, clientId: client.id, projectId };
}
