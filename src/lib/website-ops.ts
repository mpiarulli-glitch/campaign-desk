// Persistence for the Website Ops desk. Callers pass a draft; this module
// checks it, links a client when asked, and stores the row. It never talks
// to Google Sheets or Basecamp.

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import {
  applyDraftPatch,
  blankDraft,
  canonicalStage,
  deskToday,
  projectToDraft,
  type WebsiteDraft,
  type WebsiteProject,
} from "./website-ops-model";

type ProjectRow = {
  id: string;
  board: string;
  project_group: string;
  name: string;
  client_name: string;
  client_id: string | null;
  tier: string;
  platform: string;
  deliverables: string;
  stage: string;
  disposition: string;
  outsource: string;
  owners: string;
  waiting_on: string;
  priority: string;
  start_on: string;
  target_on: string;
  launch_on: string;
  last_touchpoint: string;
  next_step: string;
  blockers: string;
  basecamp_url: string;
  quarter: string;
  coverage: number;
  coverage_when: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

function rowToProject(row: ProjectRow): WebsiteProject {
  return {
    id: row.id,
    board: row.board === "landing" ? "landing" : "website",
    projectGroup: row.project_group === "custom" ? "custom" : row.project_group === "web" ? "web" : "",
    name: row.name,
    clientName: row.client_name,
    clientId: row.client_id,
    tier: row.tier,
    platform: row.platform,
    deliverables: row.deliverables,
    stage: canonicalStage(row.board === "landing" ? "landing" : "website", row.stage),
    disposition:
      row.disposition === "paused" ||
      row.disposition === "non_responsive" ||
      row.disposition === "launched" ||
      row.disposition === "archived"
        ? row.disposition
        : "active",
    outsource: row.outsource,
    owners: row.owners,
    waitingOn: row.waiting_on,
    priority: row.priority === "high" || row.priority === "low" ? row.priority : "medium",
    startOn: row.start_on,
    targetOn: row.target_on,
    launchOn: row.launch_on,
    lastTouchpoint: row.last_touchpoint,
    nextStep: row.next_step,
    blockers: row.blockers,
    basecampUrl: row.basecamp_url,
    quarter: row.quarter,
    coverage: row.coverage === 1,
    coverageWhen: row.coverage_when,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function listWebsiteProjects(): WebsiteProject[] {
  const rows = getDb()
    .prepare(`SELECT * FROM website_projects ORDER BY name COLLATE NOCASE`)
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getWebsiteProject(id: string): WebsiteProject | null {
  const row = getDb().prepare(`SELECT * FROM website_projects WHERE id = ?`).get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export type WebsiteClientOption = { id: string; name: string };

export function listWebsiteClients(): WebsiteClientOption[] {
  return getDb()
    .prepare(
      `SELECT id, name FROM rev_clients WHERE active = 1 ORDER BY name COLLATE NOCASE`
    )
    .all() as WebsiteClientOption[];
}

function clientNameFor(id: string | null): { ok: true; name: string } | { ok: false; error: string } {
  if (!id) return { ok: true, name: "" };
  const row = getDb().prepare(`SELECT name FROM rev_clients WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  if (!row) return { ok: false, error: "That client is not on Campaign Desk." };
  return { ok: true, name: row.name };
}

function writeRow(
  id: string,
  draft: WebsiteDraft,
  actor: string,
  createdAt: string,
  createdBy: string
): WebsiteProject {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO website_projects (
        id, board, project_group, name, client_name, client_id, tier, platform,
        deliverables, stage, disposition, outsource, owners, waiting_on, priority,
        start_on, target_on, launch_on, last_touchpoint, next_step, blockers,
        basecamp_url, quarter, coverage, coverage_when, created_at, updated_at,
        created_by, updated_by
      ) VALUES (
        @id, @board, @project_group, @name, @client_name, @client_id, @tier, @platform,
        @deliverables, @stage, @disposition, @outsource, @owners, @waiting_on, @priority,
        @start_on, @target_on, @launch_on, @last_touchpoint, @next_step, @blockers,
        @basecamp_url, @quarter, @coverage, @coverage_when, @created_at, @updated_at,
        @created_by, @updated_by
      )
      ON CONFLICT(id) DO UPDATE SET
        board = excluded.board,
        project_group = excluded.project_group,
        name = excluded.name,
        client_name = excluded.client_name,
        client_id = excluded.client_id,
        tier = excluded.tier,
        platform = excluded.platform,
        deliverables = excluded.deliverables,
        stage = excluded.stage,
        disposition = excluded.disposition,
        outsource = excluded.outsource,
        owners = excluded.owners,
        waiting_on = excluded.waiting_on,
        priority = excluded.priority,
        start_on = excluded.start_on,
        target_on = excluded.target_on,
        launch_on = excluded.launch_on,
        last_touchpoint = excluded.last_touchpoint,
        next_step = excluded.next_step,
        blockers = excluded.blockers,
        basecamp_url = excluded.basecamp_url,
        quarter = excluded.quarter,
        coverage = excluded.coverage,
        coverage_when = excluded.coverage_when,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by`
    )
    .run({
      id,
      board: draft.board,
      project_group: draft.projectGroup,
      name: draft.name,
      client_name: draft.clientName,
      client_id: draft.clientId,
      tier: draft.tier,
      platform: draft.platform,
      deliverables: draft.deliverables,
      stage: draft.stage,
      disposition: draft.disposition,
      outsource: draft.outsource,
      owners: draft.owners,
      waiting_on: draft.waitingOn,
      priority: draft.priority,
      start_on: draft.startOn,
      target_on: draft.targetOn,
      launch_on: draft.launchOn,
      last_touchpoint: draft.lastTouchpoint,
      next_step: draft.nextStep,
      blockers: draft.blockers,
      basecamp_url: draft.basecampUrl,
      quarter: draft.quarter,
      coverage: draft.coverage ? 1 : 0,
      coverage_when: draft.coverageWhen,
      created_at: createdAt,
      updated_at: now,
      created_by: createdBy,
      updated_by: actor,
    });
  return getWebsiteProject(id)!;
}

function readyDraft(
  base: WebsiteDraft,
  patch: Partial<WebsiteDraft>,
  today: string
): { ok: true; draft: WebsiteDraft } | { ok: false; error: string } {
  const prepared = applyDraftPatch(base, patch, today);
  if (!prepared.ok) return prepared;
  const linked = clientNameFor(prepared.draft.clientId);
  if (!linked.ok) return linked;
  if (!prepared.draft.clientName && linked.name) prepared.draft.clientName = linked.name;
  return prepared;
}

export function createWebsiteProject(
  patch: Partial<WebsiteDraft>,
  actor: string,
  today = deskToday()
): { ok: true; project: WebsiteProject } | { ok: false; error: string } {
  const prepared = readyDraft(
    blankDraft(patch.board === "landing" ? "landing" : "website"),
    patch,
    today
  );
  if (!prepared.ok) return prepared;
  const project = writeRow(nanoid(), prepared.draft, actor, nowIso(), actor);
  return { ok: true, project };
}

export function updateWebsiteProject(
  id: string,
  patch: Partial<WebsiteDraft>,
  actor: string,
  today = deskToday()
): { ok: true; project: WebsiteProject } | { ok: false; error: string; status: number } {
  const existing = getWebsiteProject(id);
  if (!existing) return { ok: false, error: "That project is gone.", status: 404 };
  const prepared = readyDraft(projectToDraft(existing), patch, today);
  if (!prepared.ok) return { ...prepared, status: 400 };
  const project = writeRow(id, prepared.draft, actor, existing.createdAt, existing.createdBy);
  return { ok: true, project };
}

export function deleteWebsiteProject(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM website_projects WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function websiteProjectIdentity(draft: Pick<WebsiteDraft, "board" | "name" | "clientName">): string {
  return `${draft.board}|${draft.name.trim().toLowerCase()}|${draft.clientName.trim().toLowerCase()}`;
}

export function commitWebsiteImport(
  drafts: WebsiteDraft[],
  actor: string,
  today = deskToday()
): { created: number; skipped: number; errors: string[] } {
  const existing = new Set(listWebsiteProjects().map(websiteProjectIdentity));
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const draft of drafts) {
    const key = websiteProjectIdentity(draft);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    const result = createWebsiteProject(draft, actor, today);
    if (!result.ok) {
      errors.push(`${draft.name}: ${result.error}`);
      continue;
    }
    existing.add(key);
    created += 1;
  }
  return { created, skipped, errors };
}
