import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type Campaign,
  type CampaignEmail,
  type CampaignStatus,
  type Comment,
  type CommentType,
  type CommentAttachment,
  type CommentReply,
  type CampaignVersion,
  type EmailSubject,
  type EmailKind,
  type ReviewChannel,
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
  clientId?: string | null;
  description?: string;
  audience?: string;
  htmlContent: string;
  emailTitle?: string;
  kind?: EmailKind;
}): Campaign {
  const db = getDb();
  const id = nanoid(12);
  const magicToken = nanoid(24);
  const externalToken = nanoid(24);
  const ts = nowIso();
  const emailId = nanoid(12);

  db.prepare(
    `INSERT INTO campaigns
      (id, title, client_name, client_id, description, audience, html_content, status, magic_token, external_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    (input.clientName || "").trim(),
    input.clientId || null,
    (input.description || "").trim(),
    (input.audience || "").trim(),
    input.htmlContent,
    magicToken,
    externalToken,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, kind, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    emailId,
    id,
    (input.emailTitle || "Email 1").trim() || "Email 1",
    input.htmlContent,
    input.kind === "interactive" ? "interactive" : "email",
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

export function listCampaigns(includeArchived = false): Campaign[] {
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return getDb()
    .prepare(`SELECT * FROM campaigns ${where} ORDER BY updated_at DESC`)
    .all() as Campaign[];
}

export function listArchivedCampaigns(): Campaign[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaigns WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`
    )
    .all() as Campaign[];
}

export function setCampaignArchived(
  id: string,
  archived: boolean
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;
  getDb()
    .prepare(`UPDATE campaigns SET archived_at = ? WHERE id = ?`)
    .run(archived ? nowIso() : null, id);
  return getCampaignById(id);
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

// Internal (magic_token) links see every comment. External (external_token)
// links only see comments left through the external link itself, so the
// client never sees internal team/boss feedback.
export function getCampaignByAnyToken(
  token: string
): { campaign: Campaign; channel: ReviewChannel } | null {
  const internal = getCampaignByToken(token);
  if (internal) return { campaign: internal, channel: "internal" };

  const external = getDb()
    .prepare(`SELECT * FROM campaigns WHERE external_token = ?`)
    .get(token) as Campaign | undefined;
  if (external) return { campaign: external, channel: "external" };

  return null;
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

export interface EmailWithSubjects extends CampaignEmail {
  subjects: EmailSubject[];
}

// All subject options for a campaign, grouped by email id.
function subjectsForCampaign(campaignId: string): Map<string, EmailSubject[]> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM email_subjects WHERE campaign_id = ? ORDER BY sort_order ASC, created_at ASC`
    )
    .all(campaignId) as EmailSubject[];
  const map = new Map<string, EmailSubject[]>();
  for (const row of rows) {
    const arr = map.get(row.email_id) || [];
    arr.push(row);
    map.set(row.email_id, arr);
  }
  return map;
}

export function listEmailsWithSubjects(campaignId: string): EmailWithSubjects[] {
  const emails = listEmails(campaignId);
  const map = subjectsForCampaign(campaignId);
  return emails.map((e) => ({ ...e, subjects: map.get(e.id) || [] }));
}

// Replace all subject options for an email. Empty rows are dropped. If the
// currently-chosen option no longer exists, the choice is cleared.
export function setEmailSubjects(
  emailId: string,
  campaignId: string,
  options: Array<{ subject: string; preview: string }>
): EmailSubject[] {
  const db = getDb();
  const cleaned = options
    .map((o) => ({
      subject: (o.subject || "").trim(),
      preview: (o.preview || "").trim(),
    }))
    .filter((o) => o.subject || o.preview);

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM email_subjects WHERE email_id = ?`).run(emailId);
    const insert = db.prepare(
      `INSERT INTO email_subjects
        (id, email_id, campaign_id, subject, preview_text, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const ts = nowIso();
    cleaned.forEach((o, i) => {
      insert.run(nanoid(12), emailId, campaignId, o.subject, o.preview, i, ts);
    });
    // Clear a chosen option that no longer exists.
    const chosen = getEmailById(emailId)?.chosen_subject_id;
    if (chosen) {
      const stillThere = db
        .prepare(`SELECT 1 FROM email_subjects WHERE id = ?`)
        .get(chosen);
      if (!stillThere) {
        db.prepare(
          `UPDATE campaign_emails SET chosen_subject_id = NULL WHERE id = ?`
        ).run(emailId);
      }
    }
  });
  tx();

  return subjectsForCampaign(campaignId).get(emailId) || [];
}

// Client picks one subject option (or clears with null).
export function setChosenSubject(
  emailId: string,
  subjectId: string | null
): CampaignEmail | null {
  getDb()
    .prepare(`UPDATE campaign_emails SET chosen_subject_id = ? WHERE id = ?`)
    .run(subjectId, emailId);
  return getEmailById(emailId);
}

export function addEmail(input: {
  campaignId: string;
  title: string;
  htmlContent: string;
  kind?: EmailKind;
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
      (id, campaign_id, title, html_content, kind, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.campaignId,
    input.title.trim() || `Email ${maxRow.max_order + 2}`,
    input.htmlContent,
    input.kind === "interactive" ? "interactive" : "email",
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
    purpose?: string;
    versionNote?: string;
  }
): CampaignEmail | null {
  const existing = getEmailById(emailId);
  if (!existing) return null;

  const db = getDb();
  const ts = nowIso();
  const title = updates.title?.trim() ?? existing.title;
  const htmlContent = updates.htmlContent ?? existing.html_content;
  const purpose = updates.purpose?.trim() ?? existing.purpose;

  db.prepare(
    `UPDATE campaign_emails
     SET title = ?, html_content = ?, purpose = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, htmlContent, purpose, ts, emailId);

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
    clientId?: string | null;
    description?: string;
    audience?: string;
    htmlContent?: string;
    status?: CampaignStatus;
    versionNote?: string;
    emailId?: string;
    approvedAt?: string | null;
  }
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;

  const db = getDb();
  const ts = nowIso();
  const title = updates.title?.trim() ?? existing.title;
  const clientName = updates.clientName?.trim() ?? existing.client_name;
  const clientId = updates.clientId !== undefined ? updates.clientId : existing.client_id;
  const description = updates.description?.trim() ?? existing.description;
  const audience = updates.audience?.trim() ?? existing.audience;
  const status = updates.status ?? existing.status;
  const approvedAt =
    updates.approvedAt !== undefined ? updates.approvedAt : existing.approved_at;

  db.prepare(
    `UPDATE campaigns
     SET title = ?, client_name = ?, client_id = ?, description = ?, audience = ?, status = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, clientName, clientId, description, audience, status, approvedAt, ts, id);

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

// channel filters to comments left on that link only. Omit it (as every
// admin-facing call site does) to get comments from both channels.
export function listComments(
  campaignId: string,
  emailId?: string,
  channel?: ReviewChannel
): Comment[] {
  const conditions = ["campaign_id = ?"];
  const params: string[] = [campaignId];
  if (emailId) {
    conditions.push("email_id = ?");
    params.push(emailId);
  }
  if (channel) {
    conditions.push("channel = ?");
    params.push(channel);
  }

  return getDb()
    .prepare(
      `SELECT * FROM comments WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`
    )
    .all(...params) as Comment[];
}

export function addComment(input: {
  campaignId: string;
  emailId?: string | null;
  authorName?: string;
  body: string;
  type: "general" | "inline";
  pinX?: number | null;
  pinY?: number | null;
  channel?: ReviewChannel;
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
      (id, campaign_id, email_id, author_name, body, type, pin_x, pin_y, resolved, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    input.campaignId,
    emailId,
    (input.authorName || "Reviewer").trim() || "Reviewer",
    input.body.trim(),
    input.type,
    input.type === "inline" ? (input.pinX ?? null) : null,
    input.type === "inline" ? (input.pinY ?? null) : null,
    input.channel || "internal",
    ts
  );

  const campaign = getCampaignById(input.campaignId);
  if (campaign && (campaign.status === "in_review" || campaign.status === "draft")) {
    updateCampaign(input.campaignId, { status: "needs_changes" });
  }

  return getDb().prepare(`SELECT * FROM comments WHERE id = ?`).get(id) as Comment;
}

// Attachment metadata (no image bytes) safe to embed in list responses.
export interface AttachmentMeta {
  id: string;
  comment_id: string;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface CommentWithAttachments extends Comment {
  attachments: AttachmentMeta[];
  replies: CommentReply[];
}

export function addReply(input: {
  commentId: string;
  campaignId: string;
  authorName?: string;
  body: string;
  isAdmin: boolean;
}): CommentReply {
  const id = nanoid(12);
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO comment_replies
        (id, comment_id, campaign_id, author_name, body, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.commentId,
      input.campaignId,
      (input.authorName || "Reviewer").trim() || "Reviewer",
      input.body.trim(),
      input.isAdmin ? 1 : 0,
      ts
    );
  return getDb()
    .prepare(`SELECT * FROM comment_replies WHERE id = ?`)
    .get(id) as CommentReply;
}

function repliesForCampaign(campaignId: string): Map<string, CommentReply[]> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM comment_replies WHERE campaign_id = ? ORDER BY created_at ASC`
    )
    .all(campaignId) as CommentReply[];
  const map = new Map<string, CommentReply[]>();
  for (const row of rows) {
    const arr = map.get(row.comment_id) || [];
    arr.push(row);
    map.set(row.comment_id, arr);
  }
  return map;
}

export function addCommentAttachment(input: {
  commentId: string;
  campaignId: string;
  mime: string;
  data: string; // base64, no data: prefix
  width?: number | null;
  height?: number | null;
}): string {
  const id = nanoid(16);
  getDb()
    .prepare(
      `INSERT INTO comment_attachments
        (id, comment_id, campaign_id, mime, data, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.commentId,
      input.campaignId,
      input.mime,
      input.data,
      input.width ?? null,
      input.height ?? null,
      nowIso()
    );
  return id;
}

// Returns the full row including image bytes. Used only by the serving route.
export function getAttachment(id: string): CommentAttachment | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM comment_attachments WHERE id = ?`)
      .get(id) as CommentAttachment | undefined) || null
  );
}

function attachmentMetaForCampaign(campaignId: string): Map<string, AttachmentMeta[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, comment_id, mime, width, height
       FROM comment_attachments
       WHERE campaign_id = ?
       ORDER BY created_at ASC`
    )
    .all(campaignId) as AttachmentMeta[];

  const map = new Map<string, AttachmentMeta[]>();
  for (const row of rows) {
    const arr = map.get(row.comment_id) || [];
    arr.push(row);
    map.set(row.comment_id, arr);
  }
  return map;
}

// Comments with their attachment metadata (no bytes) merged in.
export function listCommentsWithAttachments(
  campaignId: string,
  emailId?: string,
  channel?: ReviewChannel
): CommentWithAttachments[] {
  const comments = listComments(campaignId, emailId, channel);
  const attMap = attachmentMetaForCampaign(campaignId);
  const replyMap = repliesForCampaign(campaignId);
  return comments.map((c) => ({
    ...c,
    attachments: attMap.get(c.id) || [],
    replies: replyMap.get(c.id) || [],
  }));
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
  // Stamp every email approved so per-email state matches the whole-package
  // approval.
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE campaign_emails SET approved_at = ? WHERE campaign_id = ? AND approved_at IS NULL`
    )
    .run(ts, campaignId);
  return updateCampaign(campaignId, { status: "approved", approvedAt: ts });
}

// Move a campaign back out of "approved" (e.g. a single email got
// un-approved). Clears approved_at so it drops out of the approvals
// folders until it's approved again.
export function unapproveCampaign(campaignId: string): Campaign | null {
  return updateCampaign(campaignId, {
    status: "in_review",
    approvedAt: null,
  });
}

// Approve (or un-approve) a single email. Returns whether every email in the
// campaign is now approved.
export function setEmailApproved(
  emailId: string,
  approved: boolean
): { email: CampaignEmail | null; allApproved: boolean; campaignId: string } {
  const email = getEmailById(emailId);
  if (!email) return { email: null, allApproved: false, campaignId: "" };

  getDb()
    .prepare(`UPDATE campaign_emails SET approved_at = ? WHERE id = ?`)
    .run(approved ? nowIso() : null, emailId);

  const rows = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN approved_at IS NOT NULL THEN 1 ELSE 0 END) AS approved
       FROM campaign_emails WHERE campaign_id = ?`
    )
    .get(email.campaign_id) as { total: number; approved: number };

  const allApproved = rows.total > 0 && rows.approved === rows.total;
  return {
    email: getEmailById(emailId),
    allApproved,
    campaignId: email.campaign_id,
  };
}

export function listVersions(campaignId: string): CampaignVersion[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaign_versions WHERE campaign_id = ? ORDER BY created_at DESC`
    )
    .all(campaignId) as CampaignVersion[];
}

export function countOpenComments(
  campaignId: string,
  emailId?: string,
  channel?: ReviewChannel
): number {
  const conditions = ["campaign_id = ?", "resolved = 0"];
  const params: string[] = [campaignId];
  if (emailId) {
    conditions.push("email_id = ?");
    params.push(emailId);
  }
  if (channel) {
    conditions.push("channel = ?");
    params.push(channel);
  }

  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM comments WHERE ${conditions.join(" AND ")}`)
    .get(...params) as { count: number };
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
  client_id: string | null;
  actor: string | null;
  body: string | null;
  comment_type: CommentType | null;
  email_title: string | null;
  resolved: number | null;
  star_rating: number | null;
  attachment_count: number;
  at: string;
}

// A unified, reverse-chronological feed of client activity across every
// campaign: feedback left on the review link, and campaigns the client
// approved. Derived from existing data so it always reflects full history.
export function listActivity(limit = 100, clientId?: string): ActivityItem[] {
  const where = clientId ? `WHERE client_id = ?` : "";
  const args = clientId ? [clientId, limit] : [limit];
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT
           'feedback' AS kind,
           c.id AS id,
           c.campaign_id AS campaign_id,
           cam.title AS campaign_title,
           cam.client_name AS client_name,
           cam.client_id AS client_id,
           c.author_name AS actor,
           c.body AS body,
           c.type AS comment_type,
           e.title AS email_title,
           c.resolved AS resolved,
           NULL AS star_rating,
           (SELECT COUNT(*) FROM comment_attachments a WHERE a.comment_id = c.id) AS attachment_count,
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
           cam.client_id AS client_id,
           NULL AS actor,
           NULL AS body,
           NULL AS comment_type,
           NULL AS email_title,
           NULL AS resolved,
           cam.star_rating AS star_rating,
           0 AS attachment_count,
           cam.updated_at AS at
         FROM campaigns cam
         WHERE cam.status = 'approved'
       )
       ${where}
       ORDER BY at DESC
       LIMIT ?`
    )
    .all(...args) as ActivityItem[];
}
