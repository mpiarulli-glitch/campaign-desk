// Reconciling client records against Basecamp projects.
//
// Shared by the admin automatch endpoint and the one-time startup backfill, so
// both take exactly the same code path and produce the same report.

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import {
  SERVICE,
  asPerson,
  hasConnection,
  listProjectCatalog,
  listProjects,
  type BcIdentity,
} from "./basecamp";
import { addClientToHub } from "./lifecycle-hub";
import { OWNER_SLUG, PEOPLE } from "./people";
import { currentPeriod } from "./period";
import { createRevClient, getRevClient, listRevClients, updateRevClient } from "./revenue";
import {
  isPersonOrInternalClientName,
  matchUnlinkedClients,
  normalizeClientMatchKey,
} from "./basecamp-client-match";

// Client projects are named "<Client> Growth OS - Powered by the Empire
// Method(tm)", so the suffix has to come off before a project name can be
// compared to a client record. Without this, almost nothing matched.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/growth os.*$/, "")
    .replace(/powered by.*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A readable client name for a project being imported.
export function clientNameFor(projectName: string): string {
  return (projectName || "")
    .replace(/\s*[-–—]?\s*growth os.*$/i, "")
    .replace(/\s*[-–—]?\s*powered by.*$/i, "")
    .trim();
}

// Basecamp projects that are internal MEG workspaces, not client accounts.
// Curated rather than pattern-matched: a pattern like /HQ|Team|Internal/ would
// eventually swallow a real client. Anything here is never imported as a
// rev_client. The forecast picker can reach their todos, but only for people
// who are actually on that project in Basecamp — Leadership HQ stays hidden
// from staff who are not members. Add a new internal workspace by its exact
// Basecamp name.
const INTERNAL_PROJECTS = new Set(
  [
    "Department To-Do's Library",
    "EMPIRE Analytics",
    "Claude",
    "Test Poject",
    "Michael's Hub",
    "EOS EMPIRE",
    "MarTech Stack Recommendations",
    "MEG Marketing HQ",
    "Marketing Empire Group HQ",
    "SOPs & Job Descriptions",
    "MEG HQ Social",
    "SEO HQ",
    "M.E.G Scripts & Prompts",
    "Email/SMS + Automation + Linkedin Department",
    "Social Media and Graphic Design Team",
    "MEG Web HQ",
    "MEG InFrame app",
    "Video Editing Team",
    "Empire Ads Team",
    "Empire Leadership HQ",
    "EMPIRE Sales",
    "Kentina Passport Internal",
    "MY911 Internal Only",
    "Amanda Barkey (EOS Implementer)",
    "Deliverable Templates",
  ].map((n) => n.trim().toLowerCase())
);

export function isInternalProject(name: string): boolean {
  return INTERNAL_PROJECTS.has((name || "").trim().toLowerCase());
}

/** Teammate labels from the roster and from user accounts. */
export function forecastPersonNames(): string[] {
  const names: string[] = PEOPLE.map((person) => person.label);
  try {
    const rows = getDb()
      .prepare(`SELECT label FROM users WHERE active = 1`)
      .all() as Array<{ label: string }>;
    for (const row of rows) {
      if (row.label) names.push(row.label);
    }
  } catch {
    // A partial database may not have users yet. The roster still applies.
  }
  return names;
}

/**
 * A rev_clients row that is really a person or an internal workspace.
 * "Carlos" matches the teammate. "Carlos Cleaning" does not.
 */
export function isNonClientRecord(name: string): boolean {
  return isPersonOrInternalClientName(name, forecastPersonNames(), isInternalProject);
}

// Client projects the forecast todo picker should offer even when they are
// not linked to a revenue client yet. Matched on the name with the Growth OS
// suffix stripped, so "Temecula Limos Growth OS - Powered by…" still hits.
// Membership still applies: only people on the Basecamp project see it.
const FORECAST_EXTRA_PROJECTS = new Set(["temecula limos"]);

export function isForecastExtraProject(name: string): boolean {
  return FORECAST_EXTRA_PROJECTS.has(norm(name));
}

// Forecast display name after stripping the Growth OS suffix, same casing as
// Krak Boba Oceanside / Temecula / Corporate.
export const KRAK_BOBA_PISCATAWAY_CLIENT_NAME = "Krak Boba Piscataway";

// Screenshot title: "Krak Boba Piscataway Growth OS – Powered by th…".
// Matching requires those Growth OS words so Corporate / Oceanside / a
// non-Growth-OS Krak project cannot be chosen.
export const KRAK_BOBA_PISCATAWAY_GROWTH_OS_PREFIX = "Krak Boba Piscataway Growth OS";

function foldProjectTitle(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function isKrakBobaPiscatawayGrowthOsProject(name: string): boolean {
  const folded = foldProjectTitle(name);
  const prefix = foldProjectTitle(KRAK_BOBA_PISCATAWAY_GROWTH_OS_PREFIX);
  // startsWith or contains, so a status emoji or account prefix cannot hide
  // the screenshot title. Growth OS must still be in the name.
  return folded.startsWith(prefix) || folded.includes(prefix);
}

/**
 * The one Basecamp project Forecast should bind: Krak Boba Piscataway Growth OS.
 * Returns null when it is missing or when more than one title matches.
 */
export function pickKrakBobaPiscatawayGrowthOsProject(
  projects: Array<{ id: number | string; name: string }>
): { id: string; name: string } | null {
  const hits = projects
    .filter((p) => isKrakBobaPiscatawayGrowthOsProject(p.name))
    .map((p) => ({ id: String(p.id), name: p.name }));
  if (hits.length !== 1) return null;
  return hits[0];
}

// Screenshot title: "FloorCo Design Growth OS – Powered by the Empire Method™".
// Matching requires those Growth OS words so a FloorCo title without Growth OS
// cannot be chosen. Do not bulk-import other missing Basecamp projects.
export const FLOORCO_DESIGN_CLIENT_NAME = "FloorCo Design";
export const FLOORCO_DESIGN_GROWTH_OS_PREFIX = "FloorCo Design Growth OS";
export const FLOORCO_DESIGN_POC_NAME = "Andy Mohajeri";
export const FLOORCO_DESIGN_POC_EMAIL = "floorcodesignusa@gmail.com";

export function isFloorCoDesignGrowthOsProject(name: string): boolean {
  const folded = foldProjectTitle(name);
  const prefix = foldProjectTitle(FLOORCO_DESIGN_GROWTH_OS_PREFIX);
  return folded.startsWith(prefix) || folded.includes(prefix);
}

/**
 * The one Basecamp project Forecast and Lifecycle should bind: FloorCo Design
 * Growth OS. Returns null when it is missing or when more than one title matches.
 */
export function pickFloorCoDesignGrowthOsProject(
  projects: Array<{ id: number | string; name: string }>
): { id: string; name: string } | null {
  const hits = projects
    .filter((p) => isFloorCoDesignGrowthOsProject(p.name))
    .map((p) => ({ id: String(p.id), name: p.name }));
  if (hits.length !== 1) return null;
  return hits[0];
}

/**
 * Bind one Forecast client to one exact Basecamp project. Creates a row only
 * when no rev_client already has this name or this project id. Never overwrites
 * a project id that is already set, and never imports any other project.
 */
export function bindForecastClientToExactProject(
  project: { id: string; name: string },
  canonicalName: string
): {
  clientId: string;
  clientName: string;
  created: boolean;
  linked: boolean;
} {
  const pid = String(project.id).trim();
  const name = canonicalName.trim();
  const clients = listRevClients(true);
  const byProject = clients.find((c) => (c.basecamp_project_id || "").trim() === pid);
  if (byProject) {
    if (byProject.name.trim() !== name) {
      updateRevClient(byProject.id, { name });
    }
    if (!byProject.active) {
      updateRevClient(byProject.id, { active: true });
    }
    return {
      clientId: byProject.id,
      clientName: name,
      created: false,
      linked: false,
    };
  }
  const byName = clients.find((c) => norm(c.name) === norm(name));
  if (byName) {
    if (!(byName.basecamp_project_id || "").trim()) {
      updateRevClient(byName.id, {
        name,
        basecampProjectId: pid,
        productionEnrolled: false,
        active: true,
      });
      return {
        clientId: byName.id,
        clientName: name,
        created: false,
        linked: true,
      };
    }
    return {
      clientId: byName.id,
      clientName: byName.name,
      created: false,
      linked: false,
    };
  }
  const created = createRevClient({ name, businessModel: "home_service" });
  updateRevClient(created.id, {
    basecampProjectId: pid,
    productionEnrolled: false,
  });
  return {
    clientId: created.id,
    clientName: name,
    created: true,
    linked: true,
  };
}

// Internal Basecamp projects exposed to the forecast todo picker, resolved by
// name against the live project list rather than hardcoded ids so a project
// getting recreated in Basecamp doesn't silently break the link.
export function filterInternalProjects(
  projects: Array<{ id: number | string; name: string }>
): Array<{ id: string; name: string }> {
  return projects
    .filter((p) => isInternalProject(p.name) || isForecastExtraProject(p.name))
    .map((p) => ({ id: String(p.id), name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listInternalProjects(
  identity: BcIdentity
): Promise<Array<{ id: string; name: string }>> {
  return filterInternalProjects(await listProjects(identity));
}

// Kept for callers that still want a membership subset. The Forecast add-task
// picker does not use this: a new client's project was invisible whenever the
// signed-in person had not been added to it in Basecamp.
export function clientsOnAccessibleProjects(
  clients: Array<{ id: string; name: string; basecamp_project_id: string }>,
  accessibleProjectIds: Set<string>
): Array<{ id: string; name: string }> {
  return clients
    .filter((c) => {
      const pid = (c.basecamp_project_id || "").trim();
      if (!pid) return true;
      return accessibleProjectIds.has(pid);
    })
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Picker id for a Basecamp project that has no Campaign Desk client yet. */
export const FORECAST_UNLINKED_PREFIX = "project:";

export const FORECAST_PROJECTS_STALE =
  "Basecamp is limiting requests, so this is the last full project list. Refresh to try again.";

export const FORECAST_PROJECTS_EMPTY =
  "Basecamp didn't return any projects. Saved clients are still listed. Refresh to try again.";

export const FORECAST_PROJECTS_UNAVAILABLE =
  "Couldn't reach Basecamp for the project list. Saved clients are still listed. Refresh to try again.";

export type ForecastPickerClient = {
  id: string;
  name: string;
  unlinked?: boolean;
};

export type ForecastPicker = {
  clients: ForecastPickerClient[];
  internals: Array<{ id: string; name: string }>;
  warning: string | null;
  fromCache: boolean;
  stale: boolean;
};

/**
 * A raw Basecamp project id carried on a picker choice.
 *
 * `internal:` is an MEG workspace and is never turned into a client.
 * `project:` is a client project that is not linked yet. A plain client id
 * returns null so the caller looks the project up on the client row.
 */
export function forecastPickerProjectId(pickerId: string): string | null {
  const raw = (pickerId || "").trim();
  for (const prefix of ["internal:", FORECAST_UNLINKED_PREFIX]) {
    if (!raw.startsWith(prefix)) continue;
    const id = raw.slice(prefix.length).trim();
    return /^\d+$/.test(id) ? id : null;
  }
  return null;
}

type PickerClientRow = {
  id: string;
  name: string;
  basecamp_project_id: string;
  active?: number;
};

/**
 * Everything the add-task picker offers.
 *
 * Active clients come first. Every other project on the account catalog is
 * included, whether or not a client row exists and whether or not the person
 * picking is a member of it in Basecamp. Internal workspaces stay tagged and
 * are not imported as clients. A project an active client already points at is
 * not listed twice.
 */
export function buildForecastPicker(
  clients: PickerClientRow[],
  projects: Array<{ id: number | string; name: string }>
): { clients: ForecastPickerClient[]; internals: Array<{ id: string; name: string }> } {
  const active = clients.filter((c) => c.active !== 0 && (c.name || "").trim());
  const linkedIds = new Set(
    active.map((c) => (c.basecamp_project_id || "").trim()).filter(Boolean)
  );
  const clientOptions: ForecastPickerClient[] = active
    .map((c) => ({ id: c.id, name: c.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const seen = new Set<string>();
  const unlinked: ForecastPickerClient[] = [];
  const internals: Array<{ id: string; name: string }> = [];
  for (const project of projects) {
    const id = String(project.id ?? "").trim();
    const name = (project.name || "").trim();
    if (!id || !name || seen.has(id) || linkedIds.has(id)) continue;
    seen.add(id);
    if (isInternalProject(name)) {
      internals.push({ id, name });
    } else {
      unlinked.push({ id: `${FORECAST_UNLINKED_PREFIX}${id}`, name, unlinked: true });
    }
  }
  unlinked.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  internals.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const names = new Map<string, number>();
  for (const row of [...clientOptions, ...unlinked, ...internals]) {
    names.set(row.name, (names.get(row.name) ?? 0) + 1);
  }
  const label = (row: { id: string; name: string }) => {
    if ((names.get(row.name) ?? 0) < 2) return row.name;
    const projectId = forecastPickerProjectId(row.id) || row.id;
    return `${row.name} (#${projectId})`;
  };
  return {
    clients: [
      ...clientOptions.map((row) => ({ ...row, name: label(row) })),
      ...unlinked.map((row) => ({ ...row, name: label(row) })),
    ],
    internals: internals.map((row) => ({ ...row, name: label(row) })),
  };
}

export type EnsuredForecastProject = {
  clientId: string;
  clientName: string;
  projectId: string;
  internal: boolean;
  created: boolean;
  linked: boolean;
};

/**
 * Make a picked Basecamp project safe to add a forecast task against.
 *
 * An internal workspace is left as a project. A project that already has a
 * client is reused, and an inactive row is turned back on. A blank client whose
 * name matches is linked, the same confident match the weekly auto-link uses.
 * Otherwise one forecasting client is created and kept off the production
 * schedule. A name that already belongs to a different project is not copied
 * into a second client; the task can still name this project.
 */
export function ensureForecastClientForProject(project: {
  id: string | number;
  name: string;
}): EnsuredForecastProject {
  const projectId = String(project.id ?? "").trim();
  const projectName = (project.name || "").trim();
  const empty = (partial: Partial<EnsuredForecastProject>): EnsuredForecastProject => ({
    clientId: "",
    clientName: projectName,
    projectId,
    internal: false,
    created: false,
    linked: false,
    ...partial,
  });
  if (!projectId) return empty({});
  if (isInternalProject(projectName)) {
    return empty({ internal: true, clientName: projectName });
  }

  const all = listRevClients(true);
  const existing = all.find((c) => (c.basecamp_project_id || "").trim() === projectId);
  if (existing) {
    if (!existing.active) updateRevClient(existing.id, { active: true });
    return empty({
      clientId: existing.id,
      clientName: existing.name,
      linked: false,
      created: false,
    });
  }

  const people = forecastPersonNames();
  const plan = matchUnlinkedClients(
    all.map((c) => ({
      id: c.id,
      name: c.name,
      basecampProjectId: (c.basecamp_project_id || "").trim(),
      active: c.active === 1,
      eligible: !isPersonOrInternalClientName(c.name, people, isInternalProject),
    })),
    [{ id: projectId, name: projectName }],
    { aliases: PROJECT_ALIASES, isInternal: isInternalProject }
  );
  const match = plan.matches.find((row) => row.projectId === projectId);
  if (match) {
    const row = getRevClient(match.clientId);
    if (row && !(row.basecamp_project_id || "").trim()) {
      updateRevClient(row.id, { basecampProjectId: projectId, active: true });
      return empty({
        clientId: row.id,
        clientName: row.name,
        linked: true,
      });
    }
  }

  const takenAgain = listRevClients(true).find(
    (c) => (c.basecamp_project_id || "").trim() === projectId
  );
  if (takenAgain) {
    return empty({ clientId: takenAgain.id, clientName: takenAgain.name });
  }

  const display = clientNameFor(projectName) || projectName;
  if (isPersonOrInternalClientName(display, people, isInternalProject)) {
    return empty({ clientName: projectName });
  }
  const key = normalizeClientMatchKey(projectName);
  if (key && all.some((c) => normalizeClientMatchKey(c.name) === key)) {
    return empty({ clientName: display });
  }

  const created = createRevClient({ name: display, businessModel: "home_service" });
  updateRevClient(created.id, {
    basecampProjectId: projectId,
    productionEnrolled: false,
  });
  return empty({
    clientId: created.id,
    clientName: display,
    created: true,
    linked: true,
  });
}

export async function ensureForecastProject(
  rawProjectId: string
): Promise<
  | ({ ok: true } & EnsuredForecastProject)
  | { ok: false; error: string; status: number }
> {
  const projectId = String(rawProjectId || "").trim();
  if (!/^\d+$/.test(projectId)) {
    return { ok: false, error: "Choose a Basecamp project.", status: 400 };
  }
  let projects: Array<{ id: number; name: string }> = [];
  try {
    projects = (await listProjectCatalog(SERVICE)).projects;
  } catch {
    return { ok: false, error: FORECAST_PROJECTS_UNAVAILABLE, status: 502 };
  }
  const project = projects.find((p) => String(p.id) === projectId);
  if (!project) {
    return {
      ok: false,
      error: "That project isn't on the King Kashflow account. Refresh the project list and try again.",
      status: 400,
    };
  }
  return { ok: true, ...ensureForecastClientForProject(project) };
}

/**
 * Add-task picker for anyone who can open this forecast.
 *
 * The list is the King Kashflow account catalog, every page, not the projects
 * the signed-in Basecamp user happens to belong to. `person` is who is asking.
 * It does not filter the catalog.
 */
export async function forecastPickerForPerson(
  person: string,
  opts?: { fresh?: boolean }
): Promise<ForecastPicker> {
  void person;
  let projects: Array<{ id: number; name: string }> = [];
  let fromCache = false;
  let stale = false;
  let warning: string | null = null;
  try {
    const catalog = await listProjectCatalog(SERVICE, { fresh: opts?.fresh === true });
    projects = catalog.projects;
    fromCache = catalog.fromCache;
    stale = catalog.stale;
    if (stale) warning = FORECAST_PROJECTS_STALE;
    else if (!projects.length) warning = FORECAST_PROJECTS_EMPTY;
  } catch {
    warning = FORECAST_PROJECTS_UNAVAILABLE;
  }
  const picker = buildForecastPicker(
    listRevClients(false).map((c) => ({
      id: c.id,
      name: c.name,
      basecamp_project_id: c.basecamp_project_id || "",
      active: c.active,
    })),
    projects
  );
  return { ...picker, warning, fromCache, stale };
}

// Clients whose app name and Basecamp project name differ too much for name
// matching to bridge. Keyed by project id so a rename on either side can't
// silently repoint them.
export const PROJECT_ALIASES: Record<string, string> = {
  "47628800": "Hendos Barrel House",
  "46912240": "House Cleaning by Christina",
  "38899767": "Beyond The Walls Church",
  "39618841": "GenX Cleaning Services",
};

export interface ReconcileReport {
  dryRun: boolean;
  createMissing: boolean;
  projects: number;
  linked: Array<{ client: string; project: string }>;
  created: Array<{ client: string; project: string }>;
  ambiguous: Array<{ client: string; options: string[] }>;
  noProject: string[];
  skippedInternal: string[];
  internals: Array<{ id: string; name: string }>;
}

/**
 * Link clients to their Basecamp project, and optionally import projects that
 * have no client yet.
 *
 * Linking only ever fills a blank basecamp_project_id; it never overwrites one
 * that's already set, so running this repeatedly is safe.
 *
 * Imported clients are created with production_enrolled = 0. They're records for
 * forecasting and todo lookup, not accounts that belong on the production
 * scheduling dashboard, and the column defaults to 1 so it has to be set
 * explicitly.
 */
export async function reconcileClients(opts?: {
  createMissing?: boolean;
  dryRun?: boolean;
}): Promise<ReconcileReport> {
  const createMissing = opts?.createMissing === true;
  const dryRun = opts?.dryRun === true;

  const projects = (await listProjects(SERVICE, { fresh: true })).map((p) => ({
    id: String(p.id),
    name: p.name,
  }));

  const linked: ReconcileReport["linked"] = [];
  const created: ReconcileReport["created"] = [];
  const ambiguous: ReconcileReport["ambiguous"] = [];
  const noProject: string[] = [];
  const skippedInternal: string[] = [];

  if (!projects.length) {
    return {
      dryRun,
      createMissing,
      projects: 0,
      linked,
      created,
      ambiguous,
      noProject,
      skippedInternal,
      internals: [],
    };
  }

  // ---- link pass: fill blank project ids on existing clients
  // Confident names only. A substring such as "NORLO" inside "NORLO Peptides"
  // is left blank so an admin can pick it, instead of guessing.
  const people = forecastPersonNames();
  const plan = matchUnlinkedClients(
    listRevClients(true).map((c) => ({
      id: c.id,
      name: c.name,
      basecampProjectId: (c.basecamp_project_id || "").trim(),
      active: c.active === 1,
      eligible: !isPersonOrInternalClientName(c.name, people, isInternalProject),
    })),
    projects,
    { aliases: PROJECT_ALIASES, isInternal: isInternalProject }
  );
  for (const match of plan.matches) {
    if (!dryRun) updateRevClient(match.clientId, { basecampProjectId: match.projectId });
    linked.push({ client: match.clientName, project: match.projectName });
  }
  for (const row of plan.ambiguous) {
    ambiguous.push({ client: row.clientName, options: row.options });
  }
  for (const row of plan.unmatched) noProject.push(row.clientName);

  // ---- create pass: projects with no client at all
  if (createMissing) {
    // Recomputed after the link pass so newly linked ids count as taken.
    const clients = listRevClients(true);
    const takenIds = new Set(
      clients.map((c) => c.basecamp_project_id).filter(Boolean).map(String)
    );
    const takenNames = new Set(
      clients.map((c) => normalizeClientMatchKey(c.name)).filter(Boolean)
    );

    for (const p of projects) {
      if (takenIds.has(p.id)) continue;
      if (isInternalProject(p.name)) {
        skippedInternal.push(p.name);
        continue;
      }
      // A client with this name already exists but is linked elsewhere (or is a
      // duplicate row) — importing again would only add another duplicate.
      const projectKey = normalizeClientMatchKey(p.name);
      if (projectKey && takenNames.has(projectKey)) continue;

      const name = clientNameFor(p.name);
      if (!name) continue;
      if (!dryRun) {
        const c = createRevClient({ name, businessModel: "home_service" });
        updateRevClient(c.id, {
          basecampProjectId: p.id,
          // Imported for forecasting only — keep them off the production
          // scheduling dashboard.
          productionEnrolled: false,
        });
      }
      takenIds.add(p.id);
      if (projectKey) takenNames.add(projectKey);
      created.push({ client: name, project: p.name });
    }
  }

  return {
    dryRun,
    createMissing,
    projects: projects.length,
    linked,
    created,
    ambiguous,
    noProject,
    skippedInternal,
    internals: filterInternalProjects(projects),
  };
}

/* ------------------------------------------------- one-time startup backfill */

const BACKFILL_KEY = "basecamp_client_backfill_v1";

function backfillDone(): boolean {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BACKFILL_KEY) as { value: string } | undefined;
  return Boolean(row?.value);
}

function markBackfillDone(summary: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(BACKFILL_KEY, summary, nowIso());
}

/**
 * Run the full reconcile once, ever, then record that it happened so later boots
 * skip it. Safe to leave in place: the flag makes repeat runs a no-op, and the
 * reconcile itself never overwrites a project id that's already set.
 *
 * Clients added after this pass are linked by linkMissingBasecampProjects,
 * which an admin runs from Forecast. Do not call that from register(): listing
 * Basecamp at boot can blow Railway's 30 second /api/health limit.
 *
 * Errors are logged and swallowed — a Basecamp outage at boot must not stop the
 * app from starting.
 */
export async function runBasecampClientBackfillOnce(): Promise<void> {
  try {
    if (backfillDone()) return;
    const report = await reconcileClients({ createMissing: true });
    if (!report.projects) {
      // Basecamp unreachable or not connected. Leave the flag unset so the next
      // boot tries again rather than recording a no-op as complete.
      console.log("[basecamp-backfill] no projects returned; will retry next boot");
      return;
    }
    const summary = `linked=${report.linked.length} created=${report.created.length} ambiguous=${report.ambiguous.length} noProject=${report.noProject.length} at=${nowIso()}`;
    markBackfillDone(summary);
    console.log(`[basecamp-backfill] ${summary}`);
    if (report.created.length) {
      console.log(`[basecamp-backfill] created: ${report.created.map((c) => c.client).join(", ")}`);
    }
    if (report.ambiguous.length) {
      console.log(
        `[basecamp-backfill] left ambiguous: ${report.ambiguous.map((a) => a.client).join(", ")}`
      );
    }
  } catch (err) {
    console.error("[basecamp-backfill] failed", (err as Error).message);
  }
}

/* -------------------- Krak Boba Piscataway Growth OS one-shot import */

const PISCATAWAY_GROWTH_OS_KEY = "forecast_client_krak_boba_piscataway_growth_os_v1";

function settingDone(key: string): boolean {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return Boolean(row?.value);
}

function markSetting(key: string, summary: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, summary, nowIso());
}

/**
 * Bind Forecast to the Krak Boba Piscataway Growth OS Basecamp project only.
 * Does not import any other missing projects. Creates a rev_client only when
 * none already exists for that name or that project id.
 */
export async function ensureKrakBobaPiscatawayGrowthOsClient(): Promise<void> {
  try {
    if (settingDone(PISCATAWAY_GROWTH_OS_KEY)) return;
    const identity = hasConnection(OWNER_SLUG) ? asPerson(OWNER_SLUG) : SERVICE;
    const projects = (await listProjects(identity, { fresh: true })).map((p) => ({
      id: String(p.id),
      name: p.name,
    }));
    if (!projects.length) {
      console.log(
        `[forecast-client] no projects returned as ${hasConnection(OWNER_SLUG) ? OWNER_SLUG : "service"}; will retry Krak Boba Piscataway Growth OS next boot`
      );
      return;
    }
    const match = pickKrakBobaPiscatawayGrowthOsProject(projects);
    if (!match) {
      const piscatawayish = projects
        .filter((p) => foldProjectTitle(p.name).includes("piscataway"))
        .map((p) => `${p.id}:${p.name}`);
      console.log(
        `[forecast-client] Krak Boba Piscataway Growth OS project not found uniquely; piscatawayTitles=${JSON.stringify(piscatawayish)}; will retry next boot`
      );
      return;
    }
    const result = bindForecastClientToExactProject(match, KRAK_BOBA_PISCATAWAY_CLIENT_NAME);
    const summary = `client=${result.clientName} id=${result.clientId} project=${match.id} name=${JSON.stringify(match.name)} created=${result.created} linked=${result.linked} at=${nowIso()}`;
    markSetting(PISCATAWAY_GROWTH_OS_KEY, summary);
    console.log(`[forecast-client] ${summary}`);
  } catch (err) {
    console.error(
      "[forecast-client] Krak Boba Piscataway Growth OS import failed",
      (err as Error).message
    );
  }
}

/* -------------------- FloorCo Design Growth OS one-shot import */

const FLOORCO_DESIGN_GROWTH_OS_KEY = "forecast_client_floorco_design_growth_os_v1";

/**
 * Bind Forecast and Lifecycle to the FloorCo Design Growth OS Basecamp project
 * only. Does not import any other missing projects. Creates a rev_client only
 * when none already exists for that name or that project id. Seats the client
 * on the Lifecycle hub with no launch checklist so Michael can run the account.
 */
export async function ensureFloorCoDesignGrowthOsClient(): Promise<void> {
  try {
    if (settingDone(FLOORCO_DESIGN_GROWTH_OS_KEY)) return;
    const identity = hasConnection(OWNER_SLUG) ? asPerson(OWNER_SLUG) : SERVICE;
    const projects = (await listProjects(identity, { fresh: true })).map((p) => ({
      id: String(p.id),
      name: p.name,
    }));
    if (!projects.length) {
      console.log(
        `[forecast-client] no projects returned as ${hasConnection(OWNER_SLUG) ? OWNER_SLUG : "service"}; will retry FloorCo Design Growth OS next boot`
      );
      return;
    }
    const match = pickFloorCoDesignGrowthOsProject(projects);
    if (!match) {
      const floorcoish = projects
        .filter((p) => foldProjectTitle(p.name).includes("floorco"))
        .map((p) => `${p.id}:${p.name}`);
      console.log(
        `[forecast-client] FloorCo Design Growth OS project not found uniquely; floorcoTitles=${JSON.stringify(floorcoish)}; will retry next boot`
      );
      return;
    }
    const result = bindForecastClientToExactProject(match, FLOORCO_DESIGN_CLIENT_NAME);
    updateRevClient(result.clientId, {
      contactName: FLOORCO_DESIGN_POC_NAME,
      contactEmail: FLOORCO_DESIGN_POC_EMAIL,
      poc: FLOORCO_DESIGN_POC_NAME,
      active: true,
    });
    const hub = addClientToHub(result.clientId, null, OWNER_SLUG);
    if (!hub.ok) {
      console.log(
        `[forecast-client] FloorCo Design bound but Lifecycle hub failed (${hub.error}); will retry next boot`
      );
      return;
    }
    const summary = `client=${result.clientName} id=${result.clientId} project=${match.id} name=${JSON.stringify(match.name)} created=${result.created} linked=${result.linked} hub=true at=${nowIso()}`;
    markSetting(FLOORCO_DESIGN_GROWTH_OS_KEY, summary);
    console.log(`[forecast-client] ${summary}`);
  } catch (err) {
    console.error(
      "[forecast-client] FloorCo Design Growth OS import failed",
      (err as Error).message
    );
  }
}

/* -------------------------------------------- Swing Inn Cafe one-shot import */

const SWING_INN_CAFE_KEY = "lifecycle_client_swing_inn_cafe_v1";

// https://3.basecamp.com/5338018/projects/49112019
export const SWING_INN_CAFE_PROJECT_ID = "49112019";
export const SWING_INN_CAFE_CLIENT_NAME = "Swing Inn Cafe";

/**
 * Add Swing Inn Cafe and link Basecamp project 49112019. The project id comes
 * from the Basecamp URL, so this does not wait on a project listing. Creates
 * the client only when that name and project id are both missing, then seats
 * them on the Lifecycle hub with no launch checklist.
 */
export async function ensureSwingInnCafeClient(): Promise<void> {
  try {
    if (settingDone(SWING_INN_CAFE_KEY)) return;

    const project = { id: SWING_INN_CAFE_PROJECT_ID, name: SWING_INN_CAFE_CLIENT_NAME };
    const result = bindForecastClientToExactProject(project, SWING_INN_CAFE_CLIENT_NAME);
    const period = currentPeriod();
    const ts = nowIso();
    getDb()
      .prepare(
        `INSERT INTO lifecycle_board_cards
           (id, client_id, period, column_key, sort_order, notes, dismissed, created_at, updated_at)
         VALUES (?, ?, ?, 'triage', 0, '', 0, ?, ?)
         ON CONFLICT(client_id, period) DO UPDATE SET
           dismissed = 0,
           updated_at = excluded.updated_at`
      )
      .run(nanoid(12), result.clientId, period, ts, ts);

    const summary = `client=${result.clientName} id=${result.clientId} project=${project.id} period=${period} created=${result.created} linked=${result.linked} at=${ts}`;
    markSetting(SWING_INN_CAFE_KEY, summary);
    console.log(`[lifecycle-client] ${summary}`);
  } catch (err) {
    console.error("[lifecycle-client] Swing Inn Cafe import failed", (err as Error).message);
  }
}

/* ----------------------------------------- Coronas De Oro one-shot import */

const CORONAS_DE_ORO_KEY = "forecast_client_coronas_de_oro_v1";

// https://3.basecamp.com/5338018/projects/49308114
export const CORONAS_DE_ORO_PROJECT_ID = "49308114";
export const CORONAS_DE_ORO_CLIENT_NAME = "Coronas De Oro";

/**
 * Add Coronas De Oro and link Basecamp project 49308114. The project id is
 * known, so this does not list Basecamp. The one-time client backfill already
 * ran, and a project created after that stays out of Forecast until someone
 * clicks Sync. This writes one row on boot, fills a blank project id when the
 * name is already a client, and does not overwrite a different project id.
 */
export async function ensureCoronasDeOroClient(): Promise<void> {
  try {
    if (settingDone(CORONAS_DE_ORO_KEY)) return;

    const project = { id: CORONAS_DE_ORO_PROJECT_ID, name: CORONAS_DE_ORO_CLIENT_NAME };
    const result = bindForecastClientToExactProject(project, CORONAS_DE_ORO_CLIENT_NAME);
    const row = listRevClients(true).find((c) => c.id === result.clientId);
    if ((row?.basecamp_project_id || "").trim() !== CORONAS_DE_ORO_PROJECT_ID) {
      console.log(
        `[forecast-client] Coronas De Oro is linked to ${row?.basecamp_project_id || "nothing"}; will retry next boot`
      );
      return;
    }
    const ts = nowIso();
    const summary = `client=${result.clientName} id=${result.clientId} project=${project.id} created=${result.created} linked=${result.linked} at=${ts}`;
    markSetting(CORONAS_DE_ORO_KEY, summary);
    console.log(`[forecast-client] ${summary}`);
  } catch (err) {
    console.error("[forecast-client] Coronas De Oro import failed", (err as Error).message);
  }
}
