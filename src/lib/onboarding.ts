// The New Client Onboarding board — copied from the Basecamp card table of
// the same name in Empire Leadership HQ: same columns, same colors, same
// order. Cards are prospects pulled from GHL's "🚀 Empire Launch Pipeline"
// (see lib/ghl-opportunities.ts), not app clients — most of these never
// become a RevClient row until (if ever) they graduate off this board.
//
// The checklist is the same 15 steps as the board's "New Client Template"
// card, plus 5 that actually DO the thing instead of just tracking it: create
// the Basecamp project, send the welcome email, add the client to Basecamp,
// notify the team, and request the strategy review meeting. Those five are
// "action" steps — checking them runs a real side effect (see
// ACTION_HANDLERS below) — everything else is a plain checkbox.
import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type OnboardingProspect,
  type OnboardingStep,
  type OnboardingStepKind,
} from "./db";
import {
  createProjectFromTemplate,
  findPersonByEmail,
  grantProjectAccess,
  postProjectCampfireLine,
} from "./basecamp";
import { recordFailure, clearFailure } from "./failures";
import { getAppUrl } from "./auth";
import { sendEmail } from "./email";
import type { GhlOpportunity } from "./ghl-opportunities";

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

export type ActionKey =
  | "create_basecamp_project"
  | "send_welcome_email"
  | "add_client_to_basecamp"
  | "notify_team_researching"
  | "request_strategy_meeting";

interface TemplateStep {
  title: string;
  kind: OnboardingStepKind;
  actionKey?: ActionKey;
}

// The board's checklist template — the original 15 steps from Basecamp's
// "New Client Template" card, with 4 new action steps inserted right after
// signing and the old "Strategy Review Meeting Scheduled" step repurposed
// into the 5th action.
export const TEMPLATE_STEPS: TemplateStep[] = [
  { title: "Agreement Signed", kind: "auto" },
  { title: "Create Basecamp project", kind: "action", actionKey: "create_basecamp_project" },
  { title: "Send welcome email", kind: "action", actionKey: "send_welcome_email" },
  { title: "Add client to Basecamp", kind: "action", actionKey: "add_client_to_basecamp" },
  {
    title: "Notify team — researching, will schedule a meeting soon",
    kind: "action",
    actionKey: "notify_team_researching",
  },
  { title: "Initial Call (Schedule Strategy Development + Strategy Review Meeting)", kind: "manual" },
  { title: "Questionnaire Completed", kind: "manual" },
  { title: "Internal Client Brief Meeting Scheduled", kind: "manual" },
  { title: "Platform Access Meeting Scheduled", kind: "manual" },
  { title: "Strategy Development Activated", kind: "manual" },
  { title: "Internal Strategy Review", kind: "manual" },
  { title: "Request strategy review meeting", kind: "action", actionKey: "request_strategy_meeting" },
  { title: "Strategy Launched", kind: "manual" },
  { title: "Internal Strategy Brief", kind: "manual" },
  { title: "Brief team on next steps", kind: "manual" },
  { title: "Editorial Calendar Finalized Internally", kind: "manual" },
  { title: "Editorial Calendar Approved", kind: "manual" },
  { title: "First Content Batch Delivered", kind: "manual" },
  { title: "Ads Launched", kind: "manual" },
];

// The client-project template in Basecamp ("Full-Service Template [Client
// Name] Growth OS — Powered by the Empire Method™"), confirmed by its
// description pattern matching real client projects like 12 Volt Power.
const BASECAMP_PROJECT_TEMPLATE_ID =
  process.env.BASECAMP_CLIENT_TEMPLATE_ID || "27496813";

// Empire Leadership HQ — the internal, team-wide project. Its Campfire is
// where onboarding-research notifications go, same convention as
// BASECAMP_VIDEO_EDITING_PROJECT_ID for production requests.
const BASECAMP_LEADERSHIP_PROJECT_ID =
  process.env.BASECAMP_LEADERSHIP_PROJECT_ID || "28110364";

export interface OnboardingCard {
  prospect: OnboardingProspect;
  steps: OnboardingStep[];
}

export function listOnboardingProspects(): OnboardingCard[] {
  const db = getDb();
  const prospects = db
    .prepare(`SELECT * FROM onboarding_prospects ORDER BY created_at ASC`)
    .all() as OnboardingProspect[];
  if (!prospects.length) return [];
  const steps = db
    .prepare(
      `SELECT * FROM onboarding_steps WHERE prospect_id IN (${prospects.map(() => "?").join(",")}) ORDER BY sort_order ASC`
    )
    .all(...prospects.map((p) => p.id)) as OnboardingStep[];
  const byProspect = new Map<string, OnboardingStep[]>();
  for (const s of steps) {
    const list = byProspect.get(s.prospect_id) || [];
    list.push(s);
    byProspect.set(s.prospect_id, list);
  }
  return prospects.map((prospect) => ({
    prospect,
    steps: byProspect.get(prospect.id) || [],
  }));
}

export function getProspect(id: string): OnboardingProspect | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM onboarding_prospects WHERE id = ?`)
      .get(id) as OnboardingProspect | undefined) || null
  );
}

export function getProspectByOpportunity(ghlOpportunityId: string): OnboardingProspect | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM onboarding_prospects WHERE ghl_opportunity_id = ?`)
      .get(ghlOpportunityId) as OnboardingProspect | undefined) || null
  );
}

export function getProspectByStrategyMeetingToken(token: string): OnboardingProspect | null {
  if (!token) return null;
  return (
    (getDb()
      .prepare(`SELECT * FROM onboarding_prospects WHERE strategy_meeting_token = ?`)
      .get(token) as OnboardingProspect | undefined) || null
  );
}

function createTemplateSteps(prospectId: string) {
  const db = getDb();
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO onboarding_steps (id, prospect_id, title, kind, action_key, completed, completed_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const run = db.transaction(() => {
    TEMPLATE_STEPS.forEach((step, i) => {
      const isAuto = step.kind === "auto";
      insert.run(
        nanoid(12),
        prospectId,
        step.title,
        step.kind,
        step.actionKey || "",
        isAuto ? 1 : 0,
        isAuto ? ts : null,
        i,
        ts,
        ts
      );
    });
  });
  run();
}

// Pulls a signed opportunity onto the board. Only opportunities already past
// signing belong in this pipeline, so "added to the board" and "agreement
// signed" are the same moment — the first checklist step is stamped done
// automatically rather than requiring a click.
export function createProspectFromOpportunity(
  opportunity: GhlOpportunity,
  createdBy: string
): OnboardingProspect {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO onboarding_prospects
      (id, ghl_opportunity_id, ghl_contact_id, name, contact_name, contact_email, contact_phone,
       monetary_value, stage, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opportunity.id,
    opportunity.contactId,
    opportunity.name,
    opportunity.contactName,
    opportunity.contactEmail,
    opportunity.contactPhone,
    opportunity.monetaryValue,
    "agreement_signed",
    createdBy,
    ts,
    ts
  );
  createTemplateSteps(id);
  return getProspect(id)!;
}

export function moveProspectStage(id: string, stage: string): void {
  getDb()
    .prepare(`UPDATE onboarding_prospects SET stage = ?, updated_at = ? WHERE id = ?`)
    .run(stage, nowIso(), id);
}

// Prospects only exist for this board — unlike a client, there's no other
// record of them, so removing means deleting, not clearing a stage. Steps
// cascade with them.
export function removeProspect(id: string): void {
  getDb().prepare(`DELETE FROM onboarding_prospects WHERE id = ?`).run(id);
}

export function toggleStep(stepId: string, completed: boolean): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE onboarding_steps SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(completed ? 1 : 0, completed ? ts : null, ts, stepId);
}

function markStepDoneByAction(prospectId: string, actionKey: ActionKey) {
  toggleStepByAction(prospectId, actionKey, true);
}

function toggleStepByAction(prospectId: string, actionKey: ActionKey, completed: boolean) {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE onboarding_steps SET completed = ?, completed_at = ?, updated_at = ?
       WHERE prospect_id = ? AND action_key = ?`
    )
    .run(completed ? 1 : 0, completed ? ts : null, ts, prospectId, actionKey);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function runCreateBasecampProject(prospect: OnboardingProspect): Promise<ActionResult> {
  if (prospect.basecamp_project_id) {
    return { ok: false, error: "This prospect already has a Basecamp project." };
  }
  const result = await createProjectFromTemplate(
    BASECAMP_PROJECT_TEMPLATE_ID,
    prospect.name,
    `POC: ${prospect.contact_name}${prospect.contact_email ? ` - ${prospect.contact_email}` : ""}`
  );
  if (!result.ok || !result.projectId) {
    recordFailure({
      kind: "basecamp_project",
      subject: prospect.name,
      detail: `Could not create the Basecamp project. ${result.error || ""}`,
      hint:
        "The connected Basecamp identity (King Kashflow) needs admin/owner rights to create projects from a template. Check its role in Basecamp account settings.",
    });
    return { ok: false, error: result.error || "Could not create the project." };
  }
  clearFailure("basecamp_project", prospect.name);
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE onboarding_prospects SET basecamp_project_id = ?, basecamp_project_created_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(result.projectId, ts, ts, prospect.id);
  markStepDoneByAction(prospect.id, "create_basecamp_project");
  return { ok: true };
}

async function runSendWelcomeEmail(prospect: OnboardingProspect): Promise<ActionResult> {
  // Stubbed on purpose: there's no welcome-email copy configured yet. Once
  // there is, this becomes a sendEmail() call to prospect.contact_email like
  // the rest of the app's client emails, keyed off real WELCOME_EMAIL_*
  // content rather than hardcoded here.
  void prospect;
  return {
    ok: false,
    error:
      "The welcome email copy hasn't been set up yet. Once it is, this button will send it automatically.",
  };
}

async function runAddClientToBasecamp(prospect: OnboardingProspect): Promise<ActionResult> {
  if (!prospect.basecamp_project_id) {
    return { ok: false, error: "Create the Basecamp project first." };
  }
  if (!prospect.contact_email) {
    return { ok: false, error: "This prospect has no contact email on file." };
  }
  const person = await findPersonByEmail(prospect.contact_email);
  if (!person) {
    recordFailure({
      kind: "basecamp_project",
      subject: prospect.name,
      detail: `No Basecamp person matches ${prospect.contact_email}.`,
      hint: "Invite them from Basecamp's People settings first, then click this again.",
    });
    return {
      ok: false,
      error: `${prospect.contact_email} isn't in Basecamp yet. Invite them from People settings, then try again.`,
    };
  }
  const grant = await grantProjectAccess(prospect.basecamp_project_id, person.id);
  if (!grant.ok) {
    return { ok: false, error: grant.error || "Could not grant project access." };
  }
  clearFailure("basecamp_project", prospect.name);
  getDb()
    .prepare(`UPDATE onboarding_prospects SET basecamp_client_added_at = ?, updated_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), prospect.id);
  markStepDoneByAction(prospect.id, "add_client_to_basecamp");
  return { ok: true };
}

async function runNotifyTeamResearching(prospect: OnboardingProspect): Promise<ActionResult> {
  const content =
    `<strong>${escapeHtml(prospect.name)}</strong> just signed — we're doing research on ` +
    `the account now and will get a strategy meeting on the calendar soon.` +
    (prospect.contact_name ? `<br>Contact: ${escapeHtml(prospect.contact_name)}` : "");
  const result = await postProjectCampfireLine(BASECAMP_LEADERSHIP_PROJECT_ID, content);
  if (!result.ok) {
    recordFailure({
      kind: "basecamp_campfire",
      subject: `${prospect.name}: onboarding research notice`,
      detail: `Could not post to the leadership Campfire. ${result.error || ""}`,
      hint: "Check King Kashflow is still on the Empire Leadership HQ project.",
    });
    return { ok: false, error: result.error || "Could not post to Campfire." };
  }
  clearFailure("basecamp_campfire", `${prospect.name}: onboarding research notice`);
  getDb()
    .prepare(`UPDATE onboarding_prospects SET team_notified_at = ?, updated_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), prospect.id);
  markStepDoneByAction(prospect.id, "notify_team_researching");
  return { ok: true };
}

function escapeHtml(text: string): string {
  return (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function strategyMeetingUrl(token: string): string {
  return `${getAppUrl()}/strategy-meeting/${token}`;
}

async function runRequestStrategyMeeting(prospect: OnboardingProspect): Promise<ActionResult> {
  if (!prospect.contact_email) {
    return { ok: false, error: "This prospect has no contact email on file." };
  }
  let token = prospect.strategy_meeting_token;
  if (!token) {
    token = nanoid(24);
    getDb()
      .prepare(`UPDATE onboarding_prospects SET strategy_meeting_token = ? WHERE id = ?`)
      .run(token, prospect.id);
  }
  const url = strategyMeetingUrl(token);
  const name = prospect.contact_name?.trim();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const html = `<p>${greeting}</p><p>Let's get your strategy review meeting on the calendar. Pick a day and time here:</p><p><a href="${url}">${url}</a></p><p>Thanks!</p>`;
  const text = `${greeting}\n\nLet's get your strategy review meeting on the calendar. Pick a day and time here:\n${url}\n\nThanks!`;
  const ok = await sendEmail({
    to: prospect.contact_email,
    subject: "Let's schedule your strategy review meeting",
    html,
    text,
  });
  if (!ok) {
    return { ok: false, error: "Could not send the email. Check RESEND_API_KEY is set." };
  }
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE onboarding_prospects SET strategy_meeting_requested_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(ts, ts, prospect.id);
  markStepDoneByAction(prospect.id, "request_strategy_meeting");
  return { ok: true };
}

const ACTION_HANDLERS: Record<ActionKey, (prospect: OnboardingProspect) => Promise<ActionResult>> = {
  create_basecamp_project: runCreateBasecampProject,
  send_welcome_email: runSendWelcomeEmail,
  add_client_to_basecamp: runAddClientToBasecamp,
  notify_team_researching: runNotifyTeamResearching,
  request_strategy_meeting: runRequestStrategyMeeting,
};

export async function runProspectAction(
  prospectId: string,
  actionKey: string
): Promise<ActionResult> {
  const prospect = getProspect(prospectId);
  if (!prospect) return { ok: false, error: "Prospect not found." };
  const handler = ACTION_HANDLERS[actionKey as ActionKey];
  if (!handler) return { ok: false, error: "Not a real action." };
  return handler(prospect);
}

export async function bookStrategyMeeting(
  token: string,
  when: string
): Promise<OnboardingProspect | null> {
  const prospect = getProspectByStrategyMeetingToken(token);
  if (!prospect) return null;
  getDb()
    .prepare(`UPDATE onboarding_prospects SET strategy_meeting_at = ?, updated_at = ? WHERE id = ?`)
    .run(when, nowIso(), prospect.id);
  void postProjectCampfireLine(
    BASECAMP_LEADERSHIP_PROJECT_ID,
    `<strong>${escapeHtml(prospect.name)}</strong> just booked their strategy review meeting for ${escapeHtml(when)}.`
  );
  return getProspect(prospect.id);
}
