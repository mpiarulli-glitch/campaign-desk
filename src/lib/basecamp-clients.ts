// Reconciling client records against Basecamp projects.
//
// Shared by the admin automatch endpoint and the one-time startup backfill, so
// both take exactly the same code path and produce the same report.

import { getDb, nowIso } from "./db";
import { asPerson, hasConnection, listProjects, type BcIdentity } from "./basecamp";
import { createRevClient, listRevClients, updateRevClient } from "./revenue";

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

// Client projects the forecast todo picker should offer even when they are
// not linked to a revenue client yet. Matched on the name with the Growth OS
// suffix stripped, so "Temecula Limos Growth OS - Powered by…" still hits.
// Membership still applies: only people on the Basecamp project see it.
const FORECAST_EXTRA_PROJECTS = new Set(["temecula limos"]);

export function isForecastExtraProject(name: string): boolean {
  return FORECAST_EXTRA_PROJECTS.has(norm(name));
}

// Canonical Forecast / revenue-client name. Location splits follow
// "Krak Boba Oceanside" / "Krak Boba Temecula" / "Krak Boba Corporate".
export const KRAK_BOBA_PISCATAWAY_CLIENT_NAME = "Krak Boba Piscataway";

/**
 * Pick the Basecamp project that should become this Forecast client.
 *
 * Exact match on the Growth-OS-stripped name wins. A single project whose
 * stripped name contains the client name is accepted so "Krak Boba Piscataway
 * Growth OS - Powered by…" still hits. Containing the other way
 * ("Krak Boba" inside "Krak Boba Piscataway") is not enough — that would
 * steal a location project for the generic brand row.
 */
export function pickBasecampProjectForClient(
  projects: Array<{ id: number | string; name: string }>,
  clientName: string
): { id: string; name: string } | null {
  const wanted = norm(clientName);
  if (!wanted) return null;
  const mapped = projects.map((p) => ({
    id: String(p.id),
    name: p.name,
    n: norm(p.name),
  }));
  const exact = mapped.filter((p) => p.n === wanted);
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
  if (exact.length > 1) return null;
  const contains = mapped.filter((p) => p.n.includes(wanted));
  if (contains.length === 1) return { id: contains[0].id, name: contains[0].name };
  return null;
}

/**
 * Create or link a Forecast client for one Basecamp project the same way
 * reconcileClients({ createMissing: true }) does: home_service, off the
 * production schedule, project id filled only when blank.
 */
export function upsertForecastClientForProject(
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

// Clients whose Basecamp project this person can actually open. Unlinked
// clients (no project id) stay visible so a task can still be typed against
// the name; a linked project they are not a member of does not.
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

// Forecast add-task picker for one person: revenue clients they can open in
// Basecamp, plus internal MEG workspaces they belong to. Listed as them, never
// as the shared service account, so Leadership HQ and other private projects
// cannot leak to staff who are not members.
export async function forecastPickerForPerson(person: string): Promise<{
  clients: Array<{ id: string; name: string }>;
  internals: Array<{ id: string; name: string }>;
}> {
  const allClients = () =>
    listRevClients(false)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

  // Without their own connection we cannot tell what they can see, so internals
  // stay empty (the leak we are preventing) and the client list stays the
  // registry they already had.
  if (!hasConnection(person)) {
    return { clients: allClients(), internals: [] };
  }

  const projects = await listProjects(asPerson(person));
  const ids = new Set(projects.map((p) => String(p.id)));
  const clients = listRevClients(false);
  const linkedIds = new Set(
    clients.map((c) => (c.basecamp_project_id || "").trim()).filter((id) => ids.has(id))
  );
  return {
    clients: clientsOnAccessibleProjects(clients, ids),
    // A linked client is already in the client list. Keep the extra project
    // only when there is no client row pointing at that Basecamp project.
    internals: filterInternalProjects(projects).filter((p) => !linkedIds.has(p.id)),
  };
}

// Clients whose app name and Basecamp project name differ too much for name
// matching to bridge. Keyed by project id so a rename on either side can't
// silently repoint them.
const PROJECT_ALIASES: Record<string, string> = {
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

  const projects = (await listProjects()).map((p) => ({
    id: String(p.id),
    name: p.name,
    n: norm(p.name),
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
  for (const c of listRevClients(true)) {
    if (c.basecamp_project_id) continue;
    const cn = norm(c.name);
    if (!cn) {
      noProject.push(c.name);
      continue;
    }

    const aliasId = Object.keys(PROJECT_ALIASES).find(
      (pid) => PROJECT_ALIASES[pid].toLowerCase() === c.name.trim().toLowerCase()
    );
    let match = aliasId ? projects.find((p) => p.id === aliasId) : undefined;

    if (!match) match = projects.find((p) => p.n === cn);
    if (!match) {
      const cands = projects.filter((p) => p.n.includes(cn) || cn.includes(p.n));
      if (cands.length === 1) {
        match = cands[0];
      } else if (cands.length > 1) {
        ambiguous.push({ client: c.name, options: cands.map((p) => `${p.name} #${p.id}`) });
        continue;
      }
    }

    if (!match) {
      noProject.push(c.name);
      continue;
    }
    if (!dryRun) updateRevClient(c.id, { basecampProjectId: match.id });
    linked.push({ client: c.name, project: match.name });
  }

  // ---- create pass: projects with no client at all
  if (createMissing) {
    // Recomputed after the link pass so newly linked ids count as taken.
    const clients = listRevClients(true);
    const takenIds = new Set(
      clients.map((c) => c.basecamp_project_id).filter(Boolean).map(String)
    );
    const takenNames = new Set(clients.map((c) => norm(c.name)).filter(Boolean));

    for (const p of projects) {
      if (takenIds.has(p.id)) continue;
      if (isInternalProject(p.name)) {
        skippedInternal.push(p.name);
        continue;
      }
      // A client with this name already exists but is linked elsewhere (or is a
      // duplicate row) — importing again would only add another duplicate.
      if (takenNames.has(p.n)) continue;

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
      takenNames.add(p.n);
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

/* -------------------------------- Krak Boba Piscataway one-shot import */

const PISCATAWAY_KEY = "forecast_client_krak_boba_piscataway_v1";

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
 * Import Krak Boba Piscataway as a Forecast client after the original
 * Basecamp backfill already ran. Same create/link path as automatch
 * `{ createMissing: true }`. Retries on later boots if Basecamp is down or
 * the project is not in the list yet.
 */
export async function ensureKrakBobaPiscatawayForecastClient(): Promise<void> {
  try {
    if (settingDone(PISCATAWAY_KEY)) return;
    const projects = (await listProjects()).map((p) => ({
      id: String(p.id),
      name: p.name,
    }));
    if (!projects.length) {
      console.log(
        "[forecast-client] no projects returned; will retry Krak Boba Piscataway next boot"
      );
      return;
    }
    const match = pickBasecampProjectForClient(projects, KRAK_BOBA_PISCATAWAY_CLIENT_NAME);
    if (!match) {
      console.log(
        "[forecast-client] Krak Boba Piscataway Basecamp project not found; will retry next boot"
      );
      return;
    }
    const result = upsertForecastClientForProject(match, KRAK_BOBA_PISCATAWAY_CLIENT_NAME);
    const summary = `client=${result.clientName} id=${result.clientId} project=${match.id} created=${result.created} linked=${result.linked} at=${nowIso()}`;
    markSetting(PISCATAWAY_KEY, summary);
    console.log(`[forecast-client] ${summary}`);
  } catch (err) {
    console.error("[forecast-client] Krak Boba Piscataway import failed", (err as Error).message);
  }
}
