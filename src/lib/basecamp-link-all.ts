// Link every active Basecamp project to a Campaign Desk client.
//
// Confident name matches fill a blank basecamp_project_id, using the same
// normalizer as the weekly Forecast auto-link. Anything else that is not an
// internal workspace or a person gets one forecasting-only client. An id that
// is already set is never overwritten. Ambiguous names are reported and left
// alone. This does not create or edit Forecast tasks.

import { SERVICE, listProjectCatalog } from "./basecamp";
import {
  clientNameFor,
  forecastPersonNames,
  isInternalProject,
  PROJECT_ALIASES,
} from "./basecamp-clients";
import { assignBasecampProjectIfBlank } from "./basecamp-client-links";
import {
  isPersonOrInternalClientName,
  matchUnlinkedClients,
  normalizeClientMatchKey,
  type MatchProject,
} from "./basecamp-client-match";
import { getDb, nowIso } from "./db";
import { createRevClient, listRevClients, updateRevClient } from "./revenue";

export const LINK_ALL_REPORT_KEY = "basecamp_link_all_report";

export const LINK_ALL_NO_PROJECTS =
  "Basecamp didn't return any active projects, so nothing was linked.";

export const LINK_ALL_UNAVAILABLE =
  "Couldn't reach Basecamp for the project list, so nothing was linked.";

export type LinkAllName = {
  clientId: string;
  client: string;
  projectId: string;
  project: string;
};

export type LinkAllAmbiguous = {
  /** several-clients: one project, two clients. several-projects: one client, two projects. name-already-linked: the name belongs to a client that already has a different project. */
  kind: "several-clients" | "several-projects" | "name-already-linked";
  clients: string[];
  projects: string[];
};

export type LinkAllStale = {
  clientId: string;
  client: string;
  projectId: string;
  /** archived: on Basecamp's archived index. missing: not active and not archived (trashed, deleted, or the archived index could not be loaded). */
  status: "archived" | "missing";
  project: string | null;
};

export type LinkAllReport = {
  ok: boolean;
  dryRun: boolean;
  /** True when there was nothing to link or create. Existing links were not touched. */
  skipped: boolean;
  error: string | null;
  /** The active catalog used for this run was the previous complete list. */
  catalogStale: boolean;
  /** Whether GET /projects.json?status=archived succeeded. */
  archivedCatalog: "ok" | "unavailable";
  activeProjects: number;
  linked: LinkAllName[];
  created: LinkAllName[];
  ambiguous: LinkAllAmbiguous[];
  skippedInternal: string[];
  skippedPeople: string[];
  clientsWithoutProject: Array<{ clientId: string; client: string }>;
  staleProjectLinks: LinkAllStale[];
  summary: string;
  at: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  basecampProjectId: string;
  active: boolean;
};

type Plan = {
  toLink: LinkAllName[];
  toCreate: Array<{ projectId: string; project: string; client: string }>;
  ambiguous: LinkAllAmbiguous[];
  skippedInternal: string[];
  skippedPeople: string[];
  clientsWithoutProject: Array<{ clientId: string; client: string }>;
  staleProjectLinks: LinkAllStale[];
};

function projectLabel(project: { id: string; name: string }): string {
  const name = (project.name || "").trim() || "Untitled project";
  return `${name} (#${project.id})`;
}

function optionProjectId(label: string): string {
  const match = label.match(/\(#([^)]+)\)\s*$/);
  return match ? match[1].trim() : "";
}

/**
 * Decide what link-all would do. No database writes and no network.
 * `clients` may include inactive rows: they still reserve a project id.
 */
export function planBasecampLinkAll(input: {
  clients: ClientRow[];
  projects: MatchProject[];
  archived: MatchProject[];
  archivedCatalog: "ok" | "unavailable";
  personNames?: readonly string[];
  isInternal?: (name: string) => boolean;
  aliases?: Record<string, string>;
  nameFor?: (projectName: string) => string;
}): Plan {
  const personNames = input.personNames ?? [];
  const isInternal = input.isInternal ?? (() => false);
  const aliases = input.aliases ?? {};
  const nameFor = input.nameFor ?? ((name: string) => name.trim());

  const projects = input.projects
    .map((p) => ({ id: String(p.id ?? "").trim(), name: (p.name || "").trim() }))
    .filter((p) => p.id);
  const archived = input.archived
    .map((p) => ({ id: String(p.id ?? "").trim(), name: (p.name || "").trim() }))
    .filter((p) => p.id);

  const clients = input.clients.map((c) => ({
    id: c.id,
    name: (c.name || "").trim(),
    basecampProjectId: (c.basecampProjectId || "").trim(),
    active: c.active !== false,
  }));

  const eligible = (client: ClientRow) =>
    client.active &&
    Boolean(client.name) &&
    !isPersonOrInternalClientName(client.name, personNames, isInternal);

  const match = matchUnlinkedClients(
    clients.map((c) => ({
      id: c.id,
      name: c.name,
      basecampProjectId: c.basecampProjectId,
      active: c.active,
      eligible: eligible(c),
    })),
    projects,
    { aliases, isInternal }
  );

  const taken = new Set(clients.map((c) => c.basecampProjectId).filter(Boolean));
  const byKey = new Map<string, MatchProject[]>();
  for (const project of projects) {
    if (isInternal(project.name)) continue;
    const key = normalizeClientMatchKey(project.name);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) group.push(project);
    else byKey.set(key, [project]);
  }

  const toLink: LinkAllName[] = match.matches.map((row) => ({
    clientId: row.clientId,
    client: row.clientName,
    projectId: row.projectId,
    project: row.projectName,
  }));
  const linkedProjectIds = new Set(toLink.map((row) => row.projectId));

  const ambiguous: LinkAllAmbiguous[] = [];
  const blocked = new Set<string>();

  const severalProjects = match.ambiguous.filter((row) => row.options.length > 1);
  const oneProject = match.ambiguous.filter((row) => row.options.length <= 1);
  for (const row of severalProjects) {
    const ids = row.options.map(optionProjectId).filter(Boolean);
    for (const id of ids) blocked.add(id);
    ambiguous.push({
      kind: "several-projects",
      clients: [row.clientName],
      projects: row.options,
    });
  }
  const byOption = new Map<string, typeof oneProject>();
  for (const row of oneProject) {
    const label = row.options[0] || "";
    const id = optionProjectId(label);
    if (id) blocked.add(id);
    const group = byOption.get(label);
    if (group) group.push(row);
    else byOption.set(label, [row]);
  }
  for (const [label, group] of byOption) {
    ambiguous.push({
      kind: "several-clients",
      clients: group.map((row) => row.clientName),
      projects: label ? [label] : [],
    });
  }

  const clientsWithoutProject: Array<{ clientId: string; client: string }> = [];
  for (const row of match.unmatched) {
    const key = normalizeClientMatchKey(row.clientName);
    const hits = key ? byKey.get(key) ?? [] : [];
    const open = hits.filter((project) => !taken.has(project.id) && !linkedProjectIds.has(project.id));
    if (hits.length > 0 && open.length === 0) {
      for (const project of hits) blocked.add(project.id);
      ambiguous.push({
        kind: "name-already-linked",
        clients: [row.clientName],
        projects: hits.map(projectLabel),
      });
      continue;
    }
    clientsWithoutProject.push({ clientId: row.clientId, client: row.clientName });
  }

  const claimed = new Set<string>([...taken, ...linkedProjectIds, ...blocked]);
  const toCreate: Plan["toCreate"] = [];
  const skippedInternal: string[] = [];
  const skippedPeople: string[] = [];
  const clientKeys = new Map<string, string[]>();
  for (const client of clients) {
    const key = normalizeClientMatchKey(client.name);
    if (!key) continue;
    const names = clientKeys.get(key);
    if (names) names.push(client.name);
    else clientKeys.set(key, [client.name]);
  }

  for (const project of projects) {
    if (claimed.has(project.id)) continue;
    if (isInternal(project.name)) {
      skippedInternal.push(project.name);
      continue;
    }
    const display = nameFor(project.name) || project.name;
    if (isPersonOrInternalClientName(display, personNames, isInternal)) {
      skippedPeople.push(project.name);
      continue;
    }
    const key = normalizeClientMatchKey(project.name);
    const sameName = key ? clientKeys.get(key) : undefined;
    if (sameName && sameName.length) {
      blocked.add(project.id);
      ambiguous.push({
        kind: "name-already-linked",
        clients: [...sameName],
        projects: [projectLabel(project)],
      });
      continue;
    }
    if (!display.trim()) continue;
    toCreate.push({ projectId: project.id, project: project.name, client: display });
    claimed.add(project.id);
    if (key) clientKeys.set(key, [display]);
  }

  const activeIds = new Set(projects.map((project) => project.id));
  const archivedById = new Map(archived.map((project) => [project.id, project]));
  const staleProjectLinks: LinkAllStale[] = [];
  for (const client of clients) {
    const projectId = client.basecampProjectId;
    if (!projectId || activeIds.has(projectId)) continue;
    const archivedProject =
      input.archivedCatalog === "ok" ? archivedById.get(projectId) : undefined;
    staleProjectLinks.push({
      clientId: client.id,
      client: client.name,
      projectId,
      status: archivedProject ? "archived" : "missing",
      project: archivedProject ? archivedProject.name || null : null,
    });
  }

  const byName = (a: { client: string }, b: { client: string }) =>
    a.client.localeCompare(b.client, undefined, { sensitivity: "base" });
  toLink.sort(byName);
  toCreate.sort((a, b) => a.client.localeCompare(b.client, undefined, { sensitivity: "base" }));
  clientsWithoutProject.sort(byName);
  staleProjectLinks.sort(byName);
  skippedInternal.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  skippedPeople.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return {
    toLink,
    toCreate,
    ambiguous,
    skippedInternal,
    skippedPeople,
    clientsWithoutProject,
    staleProjectLinks,
  };
}

export function summarizeLinkAll(
  report: Pick<
    LinkAllReport,
    | "ok"
    | "dryRun"
    | "skipped"
    | "error"
    | "catalogStale"
    | "archivedCatalog"
    | "linked"
    | "created"
    | "ambiguous"
    | "clientsWithoutProject"
    | "staleProjectLinks"
  >
): string {
  if (!report.ok) return report.error || LINK_ALL_UNAVAILABLE;
  const parts: string[] = [];
  if (report.dryRun) parts.push("Dry run.");
  if (report.catalogStale) {
    parts.push("Using the last complete project list because Basecamp didn't return a fresh one.");
  }
  if (report.skipped) parts.push("Nothing new to link.");
  else parts.push(`Linked ${report.linked.length}. Created ${report.created.length}.`);

  if (report.ambiguous.length) {
    const lines = report.ambiguous.map((row) => {
      const clients = row.clients.join(", ");
      const projects = row.projects.join(", ");
      if (row.kind === "several-projects") {
        return `${clients} matches several projects (${projects})`;
      }
      if (row.kind === "several-clients") {
        return `${projects} matches several clients (${clients})`;
      }
      return `${projects} matches ${clients}, which is already linked to a project`;
    });
    parts.push(`Ambiguous: ${lines.join("; ")}.`);
  }
  if (report.clientsWithoutProject.length) {
    parts.push(
      `No Basecamp project: ${report.clientsWithoutProject.map((row) => row.client).join(", ")}.`
    );
  }
  const archived = report.staleProjectLinks.filter((row) => row.status === "archived");
  const missing = report.staleProjectLinks.filter((row) => row.status === "missing");
  if (archived.length) {
    parts.push(
      `Archived project: ${archived.map((row) => `${row.client} (#${row.projectId})`).join(", ")}.`
    );
  }
  if (missing.length) {
    const suffix =
      report.archivedCatalog === "unavailable"
        ? " The archived list could not be loaded, so these may be archived or deleted."
        : "";
    parts.push(
      `Project not on the account: ${missing.map((row) => `${row.client} (#${row.projectId})`).join(", ")}.${suffix}`
    );
  }
  return parts.join(" ");
}

function emptyReport(partial: Partial<LinkAllReport> & Pick<LinkAllReport, "ok" | "dryRun">): LinkAllReport {
  const report: LinkAllReport = {
    ok: partial.ok,
    dryRun: partial.dryRun,
    skipped: partial.skipped ?? true,
    error: partial.error ?? null,
    catalogStale: partial.catalogStale ?? false,
    archivedCatalog: partial.archivedCatalog ?? "unavailable",
    activeProjects: partial.activeProjects ?? 0,
    linked: partial.linked ?? [],
    created: partial.created ?? [],
    ambiguous: partial.ambiguous ?? [],
    skippedInternal: partial.skippedInternal ?? [],
    skippedPeople: partial.skippedPeople ?? [],
    clientsWithoutProject: partial.clientsWithoutProject ?? [],
    staleProjectLinks: partial.staleProjectLinks ?? [],
    summary: "",
    at: partial.at ?? null,
  };
  report.summary = summarizeLinkAll(report);
  return report;
}

function readClients(): ClientRow[] {
  return listRevClients(true).map((client) => ({
    id: client.id,
    name: client.name,
    basecampProjectId: (client.basecamp_project_id || "").trim(),
    active: client.active === 1,
  }));
}

function normalizeListed(
  projects: Array<{ id: string | number; name: string }>
): MatchProject[] {
  return projects
    .map((project) => ({ id: String(project.id ?? "").trim(), name: project.name || "" }))
    .filter((project) => project.id);
}

let linkAllInflight: Promise<LinkAllReport> | null = null;

function saveLinkAllReport(report: LinkAllReport) {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(LINK_ALL_REPORT_KEY, JSON.stringify(report), nowIso());
}

export function readLinkAllReport(): LinkAllReport | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(LINK_ALL_REPORT_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as LinkAllReport;
    if (!parsed || typeof parsed !== "object" || typeof parsed.summary !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Link or create a client for every active project that does not already
 * have one. Pass `projects` to reuse a catalog the caller just fetched.
 * Dry-run returns the same report and writes nothing.
 */
export async function linkAllBasecampProjects(opts?: {
  dryRun?: boolean;
  fresh?: boolean;
  projects?: Array<{ id: string | number; name: string }>;
  archived?: Array<{ id: string | number; name: string }>;
  archivedCatalog?: "ok" | "unavailable";
  /** Share one in-flight network run. Injected catalogs do not join it. */
  share?: boolean;
}): Promise<LinkAllReport> {
  if (opts?.share && !opts.projects && linkAllInflight) return linkAllInflight;
  if (opts?.share && !opts.projects) {
    const shared = runLinkAll(opts).finally(() => {
      if (linkAllInflight === shared) linkAllInflight = null;
    });
    linkAllInflight = shared;
    return shared;
  }
  return runLinkAll(opts);
}

async function runLinkAll(opts?: {
  dryRun?: boolean;
  fresh?: boolean;
  projects?: Array<{ id: string | number; name: string }>;
  archived?: Array<{ id: string | number; name: string }>;
  archivedCatalog?: "ok" | "unavailable";
}): Promise<LinkAllReport> {
  const dryRun = opts?.dryRun === true;
  const fresh = opts?.fresh !== false;
  let catalogStale = false;
  let projects: MatchProject[];
  if (opts?.projects) {
    projects = normalizeListed(opts.projects);
  } else {
    try {
      const catalog = await listProjectCatalog(SERVICE, { fresh });
      projects = normalizeListed(catalog.projects);
      catalogStale = catalog.stale;
    } catch {
      return emptyReport({ ok: false, dryRun, error: LINK_ALL_UNAVAILABLE });
    }
  }
  if (!projects.length) {
    return emptyReport({
      ok: false,
      dryRun,
      error: LINK_ALL_NO_PROJECTS,
      catalogStale,
    });
  }

  let archived: MatchProject[] = [];
  let archivedCatalog: "ok" | "unavailable" = "unavailable";
  if (opts?.archived) {
    archived = normalizeListed(opts.archived);
    archivedCatalog = opts.archivedCatalog ?? "ok";
  } else if (opts?.archivedCatalog === "unavailable") {
    archivedCatalog = "unavailable";
  } else {
    try {
      const catalog = await listProjectCatalog(SERVICE, { fresh, status: "archived" });
      archived = normalizeListed(catalog.projects);
      archivedCatalog = "ok";
    } catch {
      archivedCatalog = "unavailable";
    }
  }

  const plan = planBasecampLinkAll({
    clients: readClients(),
    projects,
    archived,
    archivedCatalog,
    personNames: forecastPersonNames(),
    isInternal: isInternalProject,
    aliases: PROJECT_ALIASES,
    nameFor: clientNameFor,
  });

  const linked: LinkAllName[] = [];
  const created: LinkAllName[] = [];
  const db = getDb();

  for (const row of plan.toLink) {
    if (dryRun) {
      linked.push(row);
      continue;
    }
    if (!assignBasecampProjectIfBlank(row.clientId, row.projectId)) continue;
    linked.push(row);
  }

  for (const row of plan.toCreate) {
    if (dryRun) {
      created.push({
        clientId: "",
        client: row.client,
        projectId: row.projectId,
        project: row.project,
      });
      continue;
    }
    const clientId = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id FROM rev_clients WHERE TRIM(IFNULL(basecamp_project_id, '')) = ? LIMIT 1`
        )
        .get(row.projectId) as { id: string } | undefined;
      if (existing) return "";
      const createdRow = createRevClient({ name: row.client, businessModel: "home_service" });
      updateRevClient(createdRow.id, {
        basecampProjectId: row.projectId,
        productionEnrolled: false,
      });
      return createdRow.id;
    })();
    if (!clientId) continue;
    created.push({
      clientId,
      client: row.client,
      projectId: row.projectId,
      project: row.project,
    });
  }

  const report = emptyReport({
    ok: true,
    dryRun,
    skipped: linked.length === 0 && created.length === 0,
    catalogStale,
    archivedCatalog,
    activeProjects: projects.length,
    linked,
    created,
    ambiguous: plan.ambiguous,
    skippedInternal: plan.skippedInternal,
    skippedPeople: plan.skippedPeople,
    clientsWithoutProject: plan.clientsWithoutProject,
    staleProjectLinks: plan.staleProjectLinks,
    at: nowIso(),
  });
  if (!dryRun) saveLinkAllReport(report);
  return report;
}

/**
 * Once per process, after the server is up. Does not block startup. Writes
 * only when a project still has no client. A Basecamp outage is logged and
 * does not stop the app.
 */
export function linkAllBasecampProjectsOnStartup(): void {
  void linkAllBasecampProjects({ fresh: true, share: true })
    .then((report) => {
      if (!report.ok) {
        console.log(`[link-all] ${report.error}`);
        return;
      }
      console.log(`[link-all] ${report.summary}`);
    })
    .catch((err) => {
      console.error("[link-all] failed", err instanceof Error ? err.message : err);
    });
}
