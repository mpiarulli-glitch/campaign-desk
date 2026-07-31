import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConnected, listProjects } from "@/lib/basecamp";
import {
  createRevClient,
  getRevClient,
  listRevClients,
  updateRevClient,
} from "@/lib/revenue";

// Client projects are named "<Client> Growth OS - Powered by the Empire
// Method(tm)", so the suffix has to come off before a name can be compared to a
// client record. Without this, almost nothing matched.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/growth os.*$/, "")
    .replace(/powered by.*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A readable client name for a project we're importing.
function clientNameFor(projectName: string): string {
  return (projectName || "")
    .replace(/\s*[-–—]?\s*growth os.*$/i, "")
    .replace(/\s*[-–—]?\s*powered by.*$/i, "")
    .trim();
}

// Basecamp projects that are internal MEG workspaces, not client accounts.
// Curated rather than pattern-matched: a pattern like /HQ|Team|Internal/ would
// eventually swallow a real client. Anything here is never imported as a client.
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

// Clients whose app name and Basecamp project name differ enough that name
// matching can't bridge them. Keyed by Basecamp project id so a rename on
// either side can't silently repoint these.
const PROJECT_ALIASES: Record<string, string> = {
  "47628800": "Hendos Barrel House",
  "46912240": "House Cleaning by Christina",
  "38899767": "Beyond The Walls Church",
  "39618841": "GenX Cleaning Services",
};

/**
 * Reconcile clients against Basecamp projects.
 *
 * Always links: any active client with no basecamp_project_id gets one if a
 * project matches by name (exact normalized, then unique substring), or via
 * PROJECT_ALIASES. Never overwrites a project id that's already set.
 *
 * With `{ createMissing: true }`, also creates a client for every project that
 * has no client yet and isn't in INTERNAL_PROJECTS.
 *
 * Pass `{ dryRun: true }` to get the same report without writing anything.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const createMissing = body?.createMissing === true;
  const dryRun = body?.dryRun === true;

  const projects = (await listProjects()).map((p) => ({
    id: String(p.id),
    name: p.name,
    n: norm(p.name),
  }));
  if (!projects.length) {
    return NextResponse.json({ error: "No Basecamp projects returned." }, { status: 502 });
  }

  const linked: Array<{ client: string; project: string }> = [];
  const created: Array<{ client: string; project: string }> = [];
  const ambiguous: Array<{ client: string; options: string[] }> = [];
  const noProject: string[] = [];
  const skippedInternal: string[] = [];

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
      // duplicate row) — importing again would just add another duplicate.
      if (takenNames.has(p.n)) continue;

      const name = clientNameFor(p.name);
      if (!name) continue;
      if (!dryRun) {
        const c = createRevClient({ name, businessModel: "home_service" });
        updateRevClient(c.id, { basecampProjectId: p.id });
        if (!getRevClient(c.id)) continue;
      }
      takenIds.add(p.id);
      takenNames.add(p.n);
      created.push({ client: name, project: p.name });
    }
  }

  return NextResponse.json({
    dryRun,
    createMissing,
    projects: projects.length,
    linked,
    created,
    ambiguous,
    noProject,
    skippedInternal,
    // Kept so the existing production-page button's message still renders.
    matched: linked,
    unmatched: noProject,
  });
}
