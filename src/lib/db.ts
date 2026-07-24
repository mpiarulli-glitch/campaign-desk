import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";

export type CampaignStatus =
  | "draft"
  | "in_review"
  | "needs_changes"
  | "approved";

export type CommentType = "general" | "inline";
export type ReviewChannel = "internal" | "external";
// "email" = static HTML email (scripts stripped in preview).
// "interactive" = form/quiz whose JS runs in a sandboxed iframe so reviewers
// can actually click through it.
export type EmailKind = "email" | "interactive";

export interface Campaign {
  id: string;
  title: string;
  client_name: string;
  // Soft link to rev_clients — backfilled by name match, set directly by the
  // client picker going forward. client_name stays the display fallback.
  client_id: string | null;
  description: string;
  audience: string;
  html_content: string;
  status: CampaignStatus;
  magic_token: string;
  external_token: string;
  star_rating: number | null;
  approved_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignEmail {
  id: string;
  campaign_id: string;
  title: string;
  html_content: string;
  kind: EmailKind;
  purpose: string;
  sort_order: number;
  approved_at: string | null;
  chosen_subject_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSubject {
  id: string;
  email_id: string;
  campaign_id: string;
  subject: string;
  preview_text: string;
  sort_order: number;
  created_at: string;
}

export interface Comment {
  id: string;
  campaign_id: string;
  email_id: string | null;
  author_name: string;
  body: string;
  type: CommentType;
  pin_x: number | null;
  pin_y: number | null;
  resolved: number;
  channel: ReviewChannel;
  created_at: string;
}

export interface CampaignVersion {
  id: string;
  campaign_id: string;
  email_id: string | null;
  html_content: string;
  note: string;
  created_at: string;
}

export interface CommentAttachment {
  id: string;
  comment_id: string;
  campaign_id: string;
  mime: string;
  data: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface CommentReply {
  id: string;
  comment_id: string;
  campaign_id: string;
  author_name: string;
  body: string;
  is_admin: number;
  created_at: string;
}

export type BusinessModel = "ecomm" | "b2b" | "home_service";
export type MetricSource = "manual" | "ghl" | "klaviyo" | "mixed";

export type ColorWeek = "purple" | "red" | "blue" | "green" | "";
export type ProductionCadence = "monthly" | "bi_monthly" | "quarterly" | "";

export interface RevClient {
  id: string;
  name: string;
  business_model: BusinessModel;
  ghl_location_id: string;
  klaviyo_account: string;
  retainer: number;
  monthly_cost: number;
  ltv: number | null;
  snapshot_token: string | null;
  // Share token for the client-facing editorial-plan approval page.
  calendar_token: string | null;
  // When/who last approved the shared editorial calendar (client side).
  calendar_approved_at: string | null;
  calendar_approved_by: string | null;
  active: number;
  color_week: ColorWeek;
  production_cadence: ProductionCadence;
  last_production_date: string | null;
  schedule_token: string | null;
  // Share token for the client-facing unified dashboard (production status,
  // snapshot link, account data, activity, campaign calendar). Internal-only
  // data (OKRs) is never returned through this token — see src/lib/dashboard.ts.
  dashboard_token: string | null;
  contract_start: string | null;
  contract_end: string | null;
  blackout_dates: string;
  contact_name: string;
  contact_email: string;
  // Point of contact tagged on the Basecamp scheduling card (email or name,
  // matched against the project's Basecamp people).
  poc: string;
  // Account manager reaching out, tagged on the Basecamp scheduling card
  // (email or name, matched against the project's Basecamp people).
  account_manager: string;
  // Manually-set account tier: ""|standard|premium|vip.
  tier: string;
  // 1 = shown on the production scheduler, 0 = removed from it (client and all
  // other data are kept; they just don't get productions).
  production_enrolled: number;
  // Basecamp project (bucket) id where the "time to schedule" card is created.
  basecamp_project_id: string;
  // Videographer assigned to this account (one production/day per videographer).
  videographer_id: string;
  created_at: string;
  updated_at: string;
}

export interface Videographer {
  id: string;
  name: string;
  active: number;
  created_at: string;
  updated_at: string;
}

// urgent = can't be moved; important = reschedulable if truly needed;
// flexible = can be rescheduled but still needs to happen this week.
export type ForecastPriority = "urgent" | "important" | "flexible";

export interface ForecastTask {
  id: string;
  person: string;
  task_date: string; // YYYY-MM-DD
  client: string;
  notes: string;
  hours: number;
  completed: number;
  priority: ForecastPriority;
  created_at: string;
  updated_at: string;
}

// One freeform note per person per week (Monday-keyed) — general context for
// the week, separate from individual task notes.
export interface ForecastNote {
  id: string;
  person: string;
  week_start: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export type SnapshotStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "shared"
  | "approved";

export type DeliverableKind = "recurring" | "one_time";

// How often a recurring deliverable's status resets. Drives which
// snapshot_entries row (keyed by period start) a given date maps to.
// Meaningless for kind = "one_time" (stored but ignored).
export type CadenceUnit = "weekly" | "monthly" | "quarterly";

export interface SnapshotDeliverable {
  id: string;
  client_id: string;
  category: string;
  name: string;
  cadence: string;
  // "one_time" deliverables are setup work that completes once, then sinks to
  // the bottom of the client view as done.
  kind: DeliverableKind;
  cadence_unit: CadenceUnit;
  // One-time items only: an optional manually-set deadline, used to flag it
  // overdue on the behind report. Recurring items get an implicit due date
  // from their cadence period instead (see periodStartFor in lib/snapshot.ts).
  due_date: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface SnapshotWin {
  id: string;
  client_id: string;
  body: string;
  happened_on: string;
  sort_order: number;
  created_at: string;
}

export interface SnapshotMetric {
  id: string;
  client_id: string;
  metric: string;
  period: string; // e.g. 2026-04
  value: number;
  unit: string; // e.g. "$", "%", ""
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// One row per deliverable per week (week_start = Monday, YYYY-MM-DD).
export interface SnapshotEntry {
  id: string;
  deliverable_id: string;
  client_id: string;
  week_start: string;
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// One note per scheduled send left by the client on the shared editorial plan.
export interface CalendarFeedback {
  id: string;
  send_id: string;
  client_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export type SendStatus = "requested" | "planned" | "scheduled" | "sent";

export type AssetType =
  | "social_post"
  | "social_video_carousel"
  | "email_campaign"
  | "crm_automation"
  | "blog_post";

// A single email send plotted on the campaign calendar. client_id is optional
// (soft link to rev_clients); client_name is always kept as a display fallback.
export interface ScheduledSend {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  send_date: string; // YYYY-MM-DD
  send_time: string; // HH:MM (24h), "" if not time-slotted
  // Production length: "half" = 4 hours, "full" = full day (9:00 AM). All
  // productions end at 5:30 PM regardless.
  duration: string;
  status: SendStatus;
  platform: string;
  asset_type: AssetType | "";
  note: string;
  audience: string;
  purpose: string;
  offer: string; // offers being tested
  subject: string;
  preview_text: string;
  // JSON string of the client's production intake brief, "" if none.
  production_brief: string;
  // Monday (YYYY-MM-DD) of the cadence window this send fulfills, if any.
  cadence_window_start: string | null;
  requested_by_client: number;
  // Set once the day-before "your crew arrives tomorrow" email has gone out.
  shoot_reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

// One row per client per production window that has entered its reminder
// period. Tracks the last day we emailed the client so follow-ups fire at most
// once per day and stop when they book.
export interface ScheduleReminder {
  id: string;
  client_id: string;
  window_start: string; // Monday of the window being reminded about
  last_sent: string; // YYYY-MM-DD of the last reminder email
  count: number;
  bc_card_at: string | null; // when the Basecamp card was created for this window
  created_at: string;
  updated_at: string;
}

// One row per client per month. Revenue/orders are typically manual (or from
// Klaviyo for ecomm); recipients/opens/clicks/appointments/leads come from GHL.
export interface RevMetric {
  id: string;
  client_id: string;
  month: string; // YYYY-MM
  revenue: number;
  orders: number;
  appointments: number;
  leads: number;
  recipients: number;
  campaigns_sent: number;
  opens: number;
  clicks: number;
  revenue_source: MetricSource;
  activity_source: MetricSource;
  note: string;
  created_at: string;
  updated_at: string;
}

export type OkrStatus = "on_track" | "at_risk" | "off_track" | "achieved";

export interface OkrKeyResult {
  id: string;
  description: string;
  target: number;
  current: number;
  unit: string; // e.g. "$", "%", ""
}

// A long-term goal we're tracking internally for an account — never exposed
// through the client-facing dashboard token.
export interface ClientOkr {
  id: string;
  client_id: string;
  objective: string;
  key_results: string; // JSON string of OkrKeyResult[]
  target_date: string | null; // YYYY-MM-DD
  status: OkrStatus;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "campaign-desk.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      html_content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      magic_token TEXT NOT NULL UNIQUE,
      external_token TEXT UNIQUE,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_emails (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      html_content TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'email',
      purpose TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Reviewer',
      body TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      pin_x REAL,
      pin_y REAL,
      resolved INTEGER NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'internal',
      created_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS campaign_versions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      html_content TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comment_attachments (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_subjects (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      preview_text TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (email_id) REFERENCES campaign_emails(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comment_replies (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Reviewer',
      body TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rev_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_model TEXT NOT NULL DEFAULT 'home_service',
      ghl_location_id TEXT NOT NULL DEFAULT '',
      klaviyo_account TEXT NOT NULL DEFAULT '',
      retainer REAL NOT NULL DEFAULT 0,
      monthly_cost REAL NOT NULL DEFAULT 0,
      ltv REAL,
      snapshot_token TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rev_metrics (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      month TEXT NOT NULL,
      revenue REAL NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      appointments INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      recipients INTEGER NOT NULL DEFAULT 0,
      campaigns_sent INTEGER NOT NULL DEFAULT 0,
      opens INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      revenue_source TEXT NOT NULL DEFAULT 'manual',
      activity_source TEXT NOT NULL DEFAULT 'manual',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (client_id, month),
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_revmetrics_client ON rev_metrics(client_id);
    CREATE INDEX IF NOT EXISTS idx_revmetrics_month ON rev_metrics(month);

    CREATE TABLE IF NOT EXISTS scheduled_sends (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      client_name TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      send_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      platform TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      preview_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sends_date ON scheduled_sends(send_date);
    CREATE INDEX IF NOT EXISTS idx_sends_client ON scheduled_sends(client_id);

    CREATE TABLE IF NOT EXISTS calendar_feedback (
      id TEXT PRIMARY KEY,
      send_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (send_id),
      FOREIGN KEY (send_id) REFERENCES scheduled_sends(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_calfeedback_client ON calendar_feedback(client_id);

    CREATE TABLE IF NOT EXISTS schedule_reminders (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      window_start TEXT NOT NULL,
      last_sent TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (client_id, window_start),
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_client ON schedule_reminders(client_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videographers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshot_deliverables (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'recurring',
      cadence_unit TEXT NOT NULL DEFAULT 'monthly',
      due_date TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshot_entries (
      id TEXT PRIMARY KEY,
      deliverable_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      work_done TEXT NOT NULL DEFAULT '',
      next_steps TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (deliverable_id, week_start),
      FOREIGN KEY (deliverable_id) REFERENCES snapshot_deliverables(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_snapdeliv_client ON snapshot_deliverables(client_id);
    CREATE INDEX IF NOT EXISTS idx_snapentry_deliv ON snapshot_entries(deliverable_id);
    CREATE INDEX IF NOT EXISTS idx_snapentry_week ON snapshot_entries(client_id, week_start);

    CREATE TABLE IF NOT EXISTS snapshot_wins (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      body TEXT NOT NULL,
      happened_on TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshot_metrics (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      period TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (client_id, metric, period),
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_snapwins_client ON snapshot_wins(client_id);
    CREATE INDEX IF NOT EXISTS idx_snapmetrics_client ON snapshot_metrics(client_id);

    CREATE TABLE IF NOT EXISTS forecast_tasks (
      id TEXT PRIMARY KEY,
      person TEXT NOT NULL,
      task_date TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      hours REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_forecast_person_date ON forecast_tasks(person, task_date);

    CREATE TABLE IF NOT EXISTS forecast_notes (
      id TEXT PRIMARY KEY,
      person TEXT NOT NULL,
      week_start TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (person, week_start)
    );

    CREATE TABLE IF NOT EXISTS client_okrs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      key_results TEXT NOT NULL DEFAULT '[]',
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'on_track',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_okrs_client ON client_okrs(client_id);

    CREATE INDEX IF NOT EXISTS idx_comments_campaign ON comments(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_versions_campaign ON campaign_versions(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_token ON campaigns(magic_token);
    CREATE INDEX IF NOT EXISTS idx_emails_campaign ON campaign_emails(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_comment ON comment_attachments(comment_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_campaign ON comment_attachments(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_replies_comment ON comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_replies_campaign ON comment_replies(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_email ON email_subjects(email_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_campaign ON email_subjects(campaign_id);
  `);

  migrate(db);

  return db;
}

function tableColumns(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function migrate(database: Database.Database) {
  const campaignCols = tableColumns(database, "campaigns");
  if (!campaignCols.includes("star_rating")) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN star_rating INTEGER`);
  }
  if (!campaignCols.includes("archived_at")) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN archived_at TEXT`);
  }
  if (!campaignCols.includes("audience")) {
    database.exec(
      `ALTER TABLE campaigns ADD COLUMN audience TEXT NOT NULL DEFAULT ''`
    );
  }
  if (!campaignCols.includes("approved_at")) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN approved_at TEXT`);
    // Backfill from updated_at for campaigns that are already approved, so
    // pre-existing approvals still land in a sensible month folder.
    database.exec(
      `UPDATE campaigns SET approved_at = updated_at WHERE status = 'approved' AND approved_at IS NULL`
    );
  }
  if (!campaignCols.includes("external_token")) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN external_token TEXT`);
  }
  const campaignsMissingExternalToken = database
    .prepare(`SELECT id FROM campaigns WHERE external_token IS NULL`)
    .all() as Array<{ id: string }>;
  if (campaignsMissingExternalToken.length) {
    const setExternalToken = database.prepare(
      `UPDATE campaigns SET external_token = ? WHERE id = ?`
    );
    for (const row of campaignsMissingExternalToken) {
      setExternalToken.run(nanoid(24), row.id);
    }
  }

  if (!campaignCols.includes("client_id")) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN client_id TEXT`);
  }
  // Best-effort backfill by exact name match — only fills rows still unset,
  // so it's safe to run on every boot and never clobbers a manually-set link.
  database.exec(
    `UPDATE campaigns SET client_id = (
       SELECT id FROM rev_clients WHERE rev_clients.name = campaigns.client_name
     )
     WHERE client_id IS NULL AND client_name IS NOT NULL AND client_name != ''
       AND EXISTS (SELECT 1 FROM rev_clients WHERE rev_clients.name = campaigns.client_name)`
  );
  database.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id)`);

  const commentCols = tableColumns(database, "comments");
  if (!commentCols.includes("email_id")) {
    database.exec(`ALTER TABLE comments ADD COLUMN email_id TEXT`);
  }
  if (!commentCols.includes("channel")) {
    database.exec(
      `ALTER TABLE comments ADD COLUMN channel TEXT NOT NULL DEFAULT 'internal'`
    );
  }

  const versionCols = tableColumns(database, "campaign_versions");
  if (!versionCols.includes("email_id")) {
    database.exec(`ALTER TABLE campaign_versions ADD COLUMN email_id TEXT`);
  }

  const emailCols = tableColumns(database, "campaign_emails");
  if (!emailCols.includes("approved_at")) {
    database.exec(`ALTER TABLE campaign_emails ADD COLUMN approved_at TEXT`);
  }
  if (!emailCols.includes("kind")) {
    database.exec(
      `ALTER TABLE campaign_emails ADD COLUMN kind TEXT NOT NULL DEFAULT 'email'`
    );
  }
  if (!emailCols.includes("chosen_subject_id")) {
    database.exec(`ALTER TABLE campaign_emails ADD COLUMN chosen_subject_id TEXT`);
  }
  if (!emailCols.includes("purpose")) {
    database.exec(
      `ALTER TABLE campaign_emails ADD COLUMN purpose TEXT NOT NULL DEFAULT ''`
    );
  }

  const revClientCols = tableColumns(database, "rev_clients");
  if (revClientCols.length && !revClientCols.includes("snapshot_token")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN snapshot_token TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("color_week")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN color_week TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("production_cadence")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN production_cadence TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("last_production_date")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN last_production_date TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("schedule_token")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN schedule_token TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("dashboard_token")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN dashboard_token TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("tier")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN tier TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("calendar_token")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN calendar_token TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("calendar_approved_at")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN calendar_approved_at TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("calendar_approved_by")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN calendar_approved_by TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("contract_start")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN contract_start TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("contract_end")) {
    database.exec(`ALTER TABLE rev_clients ADD COLUMN contract_end TEXT`);
  }
  if (revClientCols.length && !revClientCols.includes("blackout_dates")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN blackout_dates TEXT NOT NULL DEFAULT '[]'`
    );
  }
  if (revClientCols.length && !revClientCols.includes("contact_name")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN contact_name TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("contact_email")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN contact_email TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("production_enrolled")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN production_enrolled INTEGER NOT NULL DEFAULT 1`
    );
    // Start with only clients that have a color week + cadence enrolled, so the
    // scheduler doesn't show revenue-only accounts.
    database.exec(
      `UPDATE rev_clients SET production_enrolled = 0 WHERE color_week = '' OR production_cadence = ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("poc")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN poc TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("account_manager")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN account_manager TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("basecamp_project_id")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN basecamp_project_id TEXT NOT NULL DEFAULT ''`
    );
  }
  if (revClientCols.length && !revClientCols.includes("videographer_id")) {
    database.exec(
      `ALTER TABLE rev_clients ADD COLUMN videographer_id TEXT NOT NULL DEFAULT ''`
    );
  }

  // Track the Basecamp "time to schedule" card per reminder window (dedupe).
  const reminderCols = tableColumns(database, "schedule_reminders");
  if (reminderCols.length && !reminderCols.includes("bc_card_at")) {
    database.exec(`ALTER TABLE schedule_reminders ADD COLUMN bc_card_at TEXT`);
  }

  // scheduled_sends planning fields (added after the table shipped).
  const sendCols = tableColumns(database, "scheduled_sends");
  for (const col of ["audience", "purpose", "offer", "subject", "preview_text"]) {
    if (sendCols.length && !sendCols.includes(col)) {
      database.exec(
        `ALTER TABLE scheduled_sends ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`
      );
    }
  }
  if (sendCols.length && !sendCols.includes("cadence_window_start")) {
    database.exec(`ALTER TABLE scheduled_sends ADD COLUMN cadence_window_start TEXT`);
  }
  if (sendCols.length && !sendCols.includes("send_time")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN send_time TEXT NOT NULL DEFAULT ''`
    );
  }
  if (sendCols.length && !sendCols.includes("production_brief")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN production_brief TEXT NOT NULL DEFAULT ''`
    );
  }
  if (sendCols.length && !sendCols.includes("duration")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN duration TEXT NOT NULL DEFAULT 'half'`
    );
  }
  if (sendCols.length && !sendCols.includes("requested_by_client")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN requested_by_client INTEGER NOT NULL DEFAULT 0`
    );
  }
  // Dedupe flag for the day-before "your crew arrives tomorrow" email.
  if (sendCols.length && !sendCols.includes("shoot_reminder_sent_at")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN shoot_reminder_sent_at TEXT`
    );
  }
  if (sendCols.length && !sendCols.includes("asset_type")) {
    database.exec(
      `ALTER TABLE scheduled_sends ADD COLUMN asset_type TEXT NOT NULL DEFAULT ''`
    );
  }

  // Deliverable kind (recurring vs one-time setup), added after the table shipped.
  const snapDelivCols = tableColumns(database, "snapshot_deliverables");
  if (snapDelivCols.length && !snapDelivCols.includes("kind")) {
    database.exec(
      `ALTER TABLE snapshot_deliverables ADD COLUMN kind TEXT NOT NULL DEFAULT 'recurring'`
    );
  }
  // Structured cadence unit (weekly/monthly/quarterly), added so a deliverable's
  // status can reset on its own real-world period instead of every calendar
  // week regardless of how often it's actually due. Default 'monthly' is the
  // least punishing guess for existing rows with vague/blank free-text
  // cadence; best-effort backfill from that text for the explicit cases.
  if (snapDelivCols.length && !snapDelivCols.includes("cadence_unit")) {
    database.exec(
      `ALTER TABLE snapshot_deliverables ADD COLUMN cadence_unit TEXT NOT NULL DEFAULT 'monthly'`
    );
    database.exec(
      `UPDATE snapshot_deliverables SET cadence_unit = 'quarterly' WHERE lower(cadence) LIKE 'quarter%'`
    );
    database.exec(
      `UPDATE snapshot_deliverables SET cadence_unit = 'weekly' WHERE lower(cadence) LIKE 'week%'`
    );
  }
  // Optional due date for one-time deliverables (recurring items get an
  // implicit due date from their cadence period instead).
  if (snapDelivCols.length && !snapDelivCols.includes("due_date")) {
    database.exec(`ALTER TABLE snapshot_deliverables ADD COLUMN due_date TEXT`);
  }

  const forecastCols = tableColumns(database, "forecast_tasks");
  if (forecastCols.length && !forecastCols.includes("completed")) {
    database.exec(
      `ALTER TABLE forecast_tasks ADD COLUMN completed INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (forecastCols.length && !forecastCols.includes("priority")) {
    database.exec(
      `ALTER TABLE forecast_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'flexible'`
    );
  }

  // Move legacy single-html campaigns into campaign_emails
  const campaigns = database
    .prepare(`SELECT id, title, html_content, created_at, updated_at FROM campaigns`)
    .all() as Array<{
    id: string;
    title: string;
    html_content: string;
    created_at: string;
    updated_at: string;
  }>;

  const insertEmail = database.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  );
  const countEmails = database.prepare(
    `SELECT COUNT(*) as count FROM campaign_emails WHERE campaign_id = ?`
  );
  const updateCommentEmail = database.prepare(
    `UPDATE comments SET email_id = ? WHERE campaign_id = ? AND (email_id IS NULL OR email_id = '')`
  );

  for (const campaign of campaigns) {
    const row = countEmails.get(campaign.id) as { count: number };
    if (row.count > 0) {
      // Ensure orphan comments point at first email
      const first = database
        .prepare(
          `SELECT id FROM campaign_emails WHERE campaign_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1`
        )
        .get(campaign.id) as { id: string } | undefined;
      if (first) updateCommentEmail.run(first.id, campaign.id);
      continue;
    }

    if (!campaign.html_content?.trim()) continue;

    const emailId = `mig_${campaign.id.slice(0, 8)}_${Date.now().toString(36)}`;
    insertEmail.run(
      emailId,
      campaign.id,
      campaign.title || "Email 1",
      campaign.html_content,
      campaign.created_at,
      campaign.updated_at
    );
    updateCommentEmail.run(emailId, campaign.id);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
