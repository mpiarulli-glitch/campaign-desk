import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type Campaign,
  type CampaignEmail,
  type CampaignStatus,
  type Comment,
  type CommentType,
  type CampaignVersion,
} from "./db";

function syncCampaignPreview(campaignId: string) {
  const db = getDb();
  const first = db
    .prepare(
      `SELECT html_content FROM campaign_emails
       WHERE campaign_id = ?
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1`
    )
    .get(campaignId) as { html_content: string } | undefined;

  db.prepare(
    `UPDATE campaigns SET html_content = ?, updated_at = ? WHERE id = ?`
  ).run(first?.html_content || "", nowIso(), campaignId);
}

export function createCampaign(input: {
  title: string;
  clientName?: string;
  description?: string;
  htmlContent: string;
  emailTitle?: string;
}): Campaign {
  const db = getDb();
  const id = nanoid(12);
  const magicToken = nanoid(24);
  const ts = nowIso();
  const emailId = nanoid(12);

  db.prepare(
    `INSERT INTO campaigns
      (id, title, client_name, description, html_content, status, magic_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    (input.clientName || "").trim(),
    (input.description || "").trim(),
    input.htmlContent,
    magicToken,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(
    emailId,
    id,
    (input.emailTitle || "Email 1").trim() || "Email 1",
    input.htmlContent,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_versions
      (id, campaign_id, email_id, html_content, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nanoid(12), id, emailId, input.htmlContent, "Initial upload", ts);

  return getCampaignById(id)!;
}

export function listCampaigns(): Campaign[] {
  return getDb()
    .prepare(`SELECT * FROM campaigns ORDER BY updated_at DESC`)
    .all() as Campaign[];
}

export function getCampaignById(id: string): Campaign | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM campaigns WHERE id = ?`)
      .get(id) as Campaign | undefined) || null
  );
}

export function getCampaignByToken(token: string): Campaign | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM campaigns WHERE magic_token = ?`)
      .get(token) as Campaign | undefined) || null
  );
}

export function listEmails(campaignId: string): CampaignEmail[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaign_emails
       WHERE campaign_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(campaignId) as CampaignEmail[];
}

export function getEmailById(emailId: string): CampaignEmail | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM campaign_emails WHERE id = ?`)
      .get(emailId) as CampaignEmail | undefined) || null
  );
}

export function addEmail(input: {
  campaignId: string;
  title: string;
  htmlContent: string;
}): CampaignEmail | null {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) return null;

  const db = getDb();
  const ts = nowIso();
  const id = nanoid(12);
  const maxRow = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) as max_order
       FROM campaign_emails WHERE campaign_id = ?`
    )
    .get(input.campaignId) as { max_order: number };

  db.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.campaignId,
    input.title.trim() || `Email ${maxRow.max_order + 2}`,
    input.htmlContent,
    maxRow.max_order + 1,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_versions
      (id, campaign_id, email_id, html_content, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nanoid(12), input.campaignId, id, input.htmlContent, "Email added", ts);

  syncCampaignPreview(input.campaignId);
  return getEmailById(id);
}

export function updateEmail(
  emailId: string,
  updates: {
    title?: string;
    htmlContent?: string;
    versionNote?: string;
  }
): CampaignEmail | null {
  const existing = getEmailById(emailId);
  if (!existing) return null;

  const db = getDb();
  const ts = nowIso();
  const title = updates.title?.trim() ?? existing.title;
  const htmlContent = updates.htmlContent ?? existing.html_content;

  db.prepare(
    `UPDATE campaign_emails
     SET title = ?, html_content = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, htmlContent, ts, emailId);

  if (updates.htmlContent && updates.htmlContent !== existing.html_content) {
    db.prepare(
      `INSERT INTO campaign_versions
        (id, campaign_id, email_id, html_content, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      existing.campaign_id,
      emailId,
      updates.htmlContent,
      updates.versionNote || "HTML updated",
      ts
    );
  }

  syncCampaignPreview(existing.campaign_id);
  return getEmailById(emailId);
}

export function deleteEmail(emailId: string): boolean {
  const existing = getEmailById(emailId);
  if (!existing) return false;

  const emails = listEmails(existing.campaign_id);
  if (emails.length <= 1) return false;

  const db = getDb();
  db.prepare(`DELETE FROM comments WHERE email_id = ?`).run(emailId);
  db.prepare(`DELETE FROM campaign_emails WHERE id = ?`).run(emailId);
  syncCampaignPreview(existing.campaign_id);
  return true;
}

export function updateCampaign(
  id: string,
  updates: {
    title?: string;
    clientName?: string;
    description?: string;
    htmlContent?: string;
    status?: CampaignStatus;
    versionNote?: string;
    emailId?: string;
  }
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;

  const db = getDb();
  const ts = nowIso();
  const title = updates.title?.trim() ?? existing.title;
  const clientName = updates.clientName?.trim() ?? existing.client_name;
  const description = updates.description?.trim() ?? existing.description;
  const status = updates.status ?? existing.status;

  db.prepare(
    `UPDATE campaigns
     SET title = ?, client_name = ?, description = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, clientName, description, status, ts, id);

  // Legacy path: htmlContent without emailId updates first email
  if (updates.htmlContent) {
    const emails = listEmails(id);
    const target =
      (updates.emailId && emails.find((e) => e.id === updates.emailId)) ||
      emails[0];
    if (target) {
      updateEmail(target.id, {
        htmlContent: updates.htmlContent,
        versionNote: updates.versionNote,
      });
    }
  }

  return getCampaignById(id);
}

export function deleteCampaign(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM campaigns WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listComments(campaignId: string, emailId?: string): Comment[] {
  if (emailId) {
    return getDb()
      .prepare(
        `SELECT * FROM comments
         WHERE campaign_id = ? AND email_id = ?
         ORDER BY created_at ASC`
      )
      .all(campaignId, emailId) as Comment[];
  }

  return getDb()
    .prepare(
      `SELECT * FROM comments WHERE campaign_id = ? ORDER BY created_at ASC`
    )
    .all(campaignId) as Comment[];
}

export function addComment(input: {
  campaignId: string;
  emailId?: string | null;
  authorName?: string;
  body: string;
  type: "general" | "inline";
  pinX?: number | null;
  pinY?: number | null;
}): Comment {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();

  let emailId = input.emailId || null;
  if (!emailId) {
    const first = listEmails(input.campaignId)[0];
    emailId = first?.id || null;
  }

  db.prepare(
    `INSERT INTO comments
      (id, campaign_id, email_id, author_name, body, type, pin_x, pin_y, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    input.campaignId,
    emailId,
    (input.authorName || "Reviewer").trim() || "Reviewer",
    input.body.trim(),
    input.type,
    input.type === "inline" ? (input.pinX ?? null) : null,
    input.type === "inline" ? (input.pinY ?? null) : null,
    ts
  );

  const campaign = getCampaignById(input.campaignId);
  if (campaign && (campaign.status === "in_review" || campaign.status === "draft")) {
    updateCampaign(input.campaignId, { status: "needs_changes" });
  }

  return getDb().prepare(`SELECT * FROM comments WHERE id = ?`).get(id) as Comment;
}

export function setCommentResolved(
  commentId: string,
  resolved: boolean
): Comment | null {
  const db = getDb();
  db.prepare(`UPDATE comments SET resolved = ? WHERE id = ?`).run(
    resolved ? 1 : 0,
    commentId
  );
  return (
    (db
      .prepare(`SELECT * FROM comments WHERE id = ?`)
      .get(commentId) as Comment | undefined) || null
  );
}

export function resolveAllComments(campaignId: string): number {
  const result = getDb()
    .prepare(
      `UPDATE comments SET resolved = 1 WHERE campaign_id = ? AND resolved = 0`
    )
    .run(campaignId);
  return result.changes;
}

export function markRevisionDone(campaignId: string): Campaign | null {
  const existing = getCampaignById(campaignId);
  if (!existing) return null;

  resolveAllComments(campaignId);
  return updateCampaign(campaignId, { status: "in_review" });
}

export function markApproved(campaignId: string): Campaign | null {
  const existing = getCampaignById(campaignId);
  if (!existing) return null;

  resolveAllComments(campaignId);
  return updateCampaign(campaignId, { status: "approved" });
}

export function listVersions(campaignId: string): CampaignVersion[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaign_versions WHERE campaign_id = ? ORDER BY created_at DESC`
    )
    .all(campaignId) as CampaignVersion[];
}

export function countOpenComments(campaignId: string, emailId?: string): number {
  if (emailId) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM comments
         WHERE campaign_id = ? AND email_id = ? AND resolved = 0`
      )
      .get(campaignId, emailId) as { count: number };
    return row.count;
  }

  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM comments WHERE campaign_id = ? AND resolved = 0`
    )
    .get(campaignId) as { count: number };
  return row.count;
}

export function countEmails(campaignId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM campaign_emails WHERE campaign_id = ?`
    )
    .get(campaignId) as { count: number };
  return row.count;
}

export type ActivityKind = "feedback" | "approved";

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  campaign_id: string;
  campaign_title: string;
  client_name: string;
  actor: string | null;
  body: string | null;
  comment_type: CommentType | null;
  email_title: string | null;
  resolved: number | null;
  star_rating: number | null;
  at: string;
}

// A unified, reverse-chronological feed of client activity across every
// campaign: feedback left on the review link, and campaigns the client
// approved. Derived from existing data so it always reflects full history.
export function listActivity(limit = 100): ActivityItem[] {
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT
           'feedback' AS kind,
           c.id AS id,
           c.campaign_id AS campaign_id,
           cam.title AS campaign_title,
           cam.client_name AS client_name,
           c.author_name AS actor,
           c.body AS body,
           c.type AS comment_type,
           e.title AS email_title,
           c.resolved AS resolved,
           NULL AS star_rating,
           c.created_at AS at
         FROM comments c
         JOIN campaigns cam ON cam.id = c.campaign_id
         LEFT JOIN campaign_emails e ON e.id = c.email_id

         UNION ALL

         SELECT
           'approved' AS kind,
           cam.id AS id,
           cam.id AS campaign_id,
           cam.title AS campaign_title,
           cam.client_name AS client_name,
           NULL AS actor,
           NULL AS body,
           NULL AS comment_type,
           NULL AS email_title,
           NULL AS resolved,
           cam.star_rating AS star_rating,
           cam.updated_at AS at
         FROM campaigns cam
         WHERE cam.status = 'approved'
       )
       ORDER BY at DESC
       LIMIT ?`
    )
    .all(limit) as ActivityItem[];
}
