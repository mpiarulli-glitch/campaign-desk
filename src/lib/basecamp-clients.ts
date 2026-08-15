// Reconciling client records against Basecamp projects.
//
// Shared by the admin automatch endpoint and the one-time startup backfill, so
// both take exactly the same code path and produce the same report.

import { getDb, nowIso } from "./db";
import { listProjects, type BcIdentity } from "./basecamp";
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
// rev_client, but a subset is still readable via listInternalProjects() below
// so things like the forecast todo picker can reach their todos without
// turning them into billing clients.
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

// Internal projects whose todos are still worth reaching from the forecast
// picker (leadership, ops work someone forecasts hours against), without
// making them selectable anywhere revenue or production cares about. Add a
// project here by its exact Basecamp name; it still has to appear in
// INTERNAL_PROJECTS above to stay out of the rev_client import pass.
const FORECAST_VISIBLE_INTERNAL_PROJECTS = new Set(
  [
    "Empire Leadership HQ",
    "Video Editing Team",
    "Social Media and Graphic Design Team",
    "Email/SMS + Automation + Linkedin Department",
    "MEG Web HQ",
    "SEO HQ",
    "MEG HQ Social",
    "Empire Ads Team",
  ].map((n) => n.trim().toLowerCase())
);

// Internal Basecamp projects exposed to the forecast todo picker, resolved by
// name against the live project list rather than hardcoded ids so a project
// getting recreated in Basecamp doesn't silently break the link.
export async function listInternalProjects(
  identity?: BcIdentity
): Promise<Array<{ id: string; name: string }>> {
  const projects = await listProjects(identity);
  return projects
    .filter((p) => FORECAST_VISIBLE_INTERNAL_PROJECTS.has(p.name.trim().toLowerCase()))
    .map((p) => ({ id: String(p.id), name: p.name }));
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
    return { dryRun, createMissing, projects: 0, linked, created, ambiguous, noProject, skippedInternal };
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
      if (INTERNAL_PROJECTS.has(p.name.trim().toLowerCase())) {
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

  return { dryRun, createMissing, projects: projects.length, linked, created, ambiguous, noProject, skippedInternal };
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
