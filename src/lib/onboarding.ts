// The New Client Onboarding board — copied from the Basecamp card table of
// the same name in Empire Leadership HQ: same columns, same colors, same
// order, and the same 15-step checklist as its "New Client Template" card.
//
// A client only appears on this board once added (onboarding_stage != "").
// Existing long-running clients never show up here unless someone puts them
// on it; onboarding_stage is unrelated to production_enrolled or active.
import { nanoid } from "nanoid";
import { getDb, nowIso, type OnboardingStep, type RevClient } from "./db";

export interface OnboardingStage {
  key: string;
  label: string;
  color: string; // "" = no color, matching the Basecamp column
}

// Order matches the board's column position exactly. "triage" and "not_now"
// are Basecamp's special Kanban::Triage/NotNowColumn; "first_batch_delivered"
// is its Kanban::DoneColumn.
export const ONBOARDING_STAGES: OnboardingStage[] = [
  { key: "triage", label: "Triage", color: "" },
  { key: "agreement_signed", label: "Agreement Signed", color: "white" },
  { key: "questionnaire_completed", label: "Questionnaire Completed", color: "yellow" },
  { key: "brief_client_questionnaire", label: "Brief - Client Questionnaire", color: "" },
  { key: "strategy_in_development", label: "Strategy In Development", color: "orange" },
  { key: "platform_access_received", label: "Platform Access Received", color: "red" },
  { key: "internal_strategy_review", label: "Internal Strategy Review", color: "brown" },
  { key: "strategy_meeting_scheduled", label: "Strategy Meeting Scheduled", color: "pink" },
  { key: "strategy_launched", label: "Strategy Launched", color: "purple" },
  { key: "team_kickoff_brief", label: "Team Kick-Off Brief", color: "" },
  { key: "editorial_calendar_approved", label: "Editorial Calendar Approved", color: "blue" },
  { key: "first_batch_delivered", label: "First Batch Delivered", color: "" },
];

// A side column for deprioritized clients, same as Basecamp's "Not now" —
// kept separate from the main sequence since it isn't a step forward.
export const NOT_NOW_STAGE: OnboardingStage = { key: "not_now", label: "Not now", color: "" };

export const ALL_STAGES: OnboardingStage[] = [...ONBOARDING_STAGES, NOT_NOW_STAGE];

const STAGE_KEYS = new Set(ALL_STAGES.map((s) => s.key));

export function isValidStage(key: string): boolean {
  return STAGE_KEYS.has(key);
}

// The checklist every new card gets, copied verbatim from the "New Client
// Template" card's steps in Basecamp.
export const TEMPLATE_STEPS: string[] = [
  "Agreement Signed",
  "Initial Call (Schedule Strategy Development + Strategy Review Meeting)",
  "Questionnaire Completed",
  "Internal Client Brief Meeting Scheduled",
  "Platform Access Meeting Scheduled",
  "Strategy Development Activated",
  "Internal Strategy Review",
  "Strategy Review Meeting Scheduled",
  "Strategy Launched",
  "Internal Strategy Brief",
  "Brief team on next steps",
  "Editorial Calendar Finalized Internally",
  "Editorial Calendar Approved",
  "First Content Batch Delivered",
  "Ads Launched",
];

export interface OnboardingClient {
  client: RevClient;
  steps: OnboardingStep[];
}

// Every client currently on the board, grouped by nothing — the caller
// buckets by client.onboarding_stage. Ordered by when they joined the board,
// oldest first, so a column reads top-to-bottom in the order cards arrived.
export function listOnboardingClients(): OnboardingClient[] {
  const db = getDb();
  const clients = db
    .prepare(`SELECT * FROM rev_clients WHERE onboarding_stage != '' ORDER BY updated_at ASC`)
    .all() as RevClient[];
  if (!clients.length) return [];
  const steps = db
    .prepare(
      `SELECT * FROM onboarding_steps WHERE client_id IN (${clients.map(() => "?").join(",")}) ORDER BY sort_order ASC`
    )
    .all(...clients.map((c) => c.id)) as OnboardingStep[];
  const byClient = new Map<string, OnboardingStep[]>();
  for (const s of steps) {
    const list = byClient.get(s.client_id) || [];
    list.push(s);
    byClient.set(s.client_id, list);
  }
  return clients.map((client) => ({ client, steps: byClient.get(client.id) || [] }));
}

// Clients not currently on the board — the picker when adding one.
export function listClientsOffBoard(): RevClient[] {
  return getDb()
    .prepare(`SELECT * FROM rev_clients WHERE onboarding_stage = '' ORDER BY name COLLATE NOCASE ASC`)
    .all() as RevClient[];
}

function createTemplateSteps(clientId: string) {
  const db = getDb();
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO onboarding_steps (id, client_id, title, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const run = db.transaction(() => {
    TEMPLATE_STEPS.forEach((title, i) => {
      insert.run(nanoid(12), clientId, title, i, ts, ts);
    });
  });
  run();
}

// Puts a client on the board at "triage" (or a specific stage), creating
// their checklist the first time — a client already on the board just moves,
// it never gets a second copy of the steps.
export function addClientToOnboarding(
  clientId: string,
  stage: string = "triage"
): void {
  const db = getDb();
  const existing = db
    .prepare(`SELECT onboarding_stage FROM rev_clients WHERE id = ?`)
    .get(clientId) as { onboarding_stage: string } | undefined;
  if (!existing) return;
  db.prepare(`UPDATE rev_clients SET onboarding_stage = ?, updated_at = ? WHERE id = ?`).run(
    stage,
    nowIso(),
    clientId
  );
  const hasSteps = db
    .prepare(`SELECT 1 FROM onboarding_steps WHERE client_id = ? LIMIT 1`)
    .get(clientId);
  if (!hasSteps) createTemplateSteps(clientId);
}

export function moveClientStage(clientId: string, stage: string): void {
  getDb()
    .prepare(`UPDATE rev_clients SET onboarding_stage = ?, updated_at = ? WHERE id = ?`)
    .run(stage, nowIso(), clientId);
}

// Takes a client off the board entirely (graduated, or added by mistake).
// Their checklist history stays — re-adding them later just resumes it.
export function removeFromOnboarding(clientId: string): void {
  getDb()
    .prepare(`UPDATE rev_clients SET onboarding_stage = '', updated_at = ? WHERE id = ?`)
    .run(nowIso(), clientId);
}

export function toggleStep(stepId: string, completed: boolean): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE onboarding_steps SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(completed ? 1 : 0, completed ? ts : null, ts, stepId);
}
