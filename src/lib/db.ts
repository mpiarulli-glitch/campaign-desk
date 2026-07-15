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

export interface RevClient {
  id: string;
  name: string;
  business_model: BusinessModel;
  ghl_location_id: string;
  klaviyo_account: string;
  retainer: number;
  monthly_cost: number;
  ltv: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export type SendStatus = "planned" | "scheduled" | "sent";

// A single email send plotted on the campaign calendar. client_id is optional
// (soft link to rev_clients); client_name is always kept as a display fallback.
export interface ScheduledSend {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  send_date: string; // YYYY-MM-DD
  status: SendStatus;
  platform: string;
  note: string;
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
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sends_date ON scheduled_sends(send_date);
    CREATE INDEX IF NOT EXISTS idx_sends_client ON scheduled_sends(client_id);

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
