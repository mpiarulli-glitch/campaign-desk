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
  type CampaignFlowStep,
} from "./db";
import {
  coerceKind,
  coerceFormat,
  renderAssetDoc,
  type AssetKind,
  type BodyFormat,
} from "./asset-kinds";
import {
  coercePresentation,
  coerceTriggerKind,
  coerceFlowStepType,
  coerceFlowBranch,
  coerceConditionKind,
  type Presentation,
  type TriggerKind,
  type FlowStepType,
  type FlowBranch,
  type ConditionKind,
} from "./automation-map";
import {
  isOperatorCampaignStatus,
  statusAfterMarkRevisionDone,
  statusAfterReviewerComment,
  storedStatusForOperatorChoice,
  type OperatorCampaignStatus,
} from "./campaign-status";

// The campaigns.html_content column is only a convenience thumbnail for list
// views. Keep it in sync with the first asset, rendered the same way the
// preview renders it, so blogs/decks/mock-ups get a sensible thumbnail too.
function syncCampaignPreview(campaignId: string) {
  const db = getDb();
  const first = db
    .prepare(
      `SELECT html_content, kind, body_format, media_url FROM campaign_emails
       WHERE campaign_id = ?
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1`
    )
    .get(campaignId) as
    | {
        html_content: string;
        kind: AssetKind;
        body_format: BodyFormat;
        media_url: string | null;
      }
    | undefined;

  const rendered = first ? renderAssetDoc(first).html : "";

  db.prepare(
    `UPDATE campaigns SET html_content = ?, updated_at = ? WHERE id = ?`
  ).run(rendered, nowIso(), campaignId);
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
  bodyFormat?: BodyFormat;
  mediaUrl?: string | null;
  presentation?: Presentation;
  triggerLabel?: string;
  triggerKind?: TriggerKind;
}): Campaign {
  const db = getDb();
  const id = nanoid(12);
  const magicToken = nanoid(24);
  const externalToken = nanoid(24);
  const ts = nowIso();
  const emailId = nanoid(12);
  const kind = coerceKind(input.kind);
  const bodyFormat = coerceFormat(kind, input.bodyFormat);
  const mediaUrl = (input.mediaUrl || "").trim() || null;
  const presentation = coercePresentation(input.presentation);
  const triggerKind = coerceTriggerKind(input.triggerKind);
  const triggerLabel = (input.triggerLabel || "").trim();

  db.prepare(
    `INSERT INTO campaigns
      (id, title, client_name, client_id, description, audience, html_content, status, magic_token, external_token, presentation, trigger_label, trigger_kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
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
    presentation,
    triggerLabel,
    triggerKind,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, kind, body_format, media_url, delay_ms, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    emailId,
    id,
    (input.emailTitle || "Item 1").trim() || "Item 1",
    input.htmlContent,
    kind,
    bodyFormat,
    mediaUrl,
    ts,
    ts
  );

  db.prepare(
    `INSERT INTO campaign_versions
      (id, campaign_id, email_id, html_content, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nanoid(12), id, emailId, input.htmlContent, "Initial upload", ts);

  syncCampaignPreview(id);
  if (presentation === "automation") {
    insertFlowStepRow({
      campaignId: id,
      stepType: "email",
      emailId,
    });
  }
  return getCampaignById(id)!;
}

export function listCampaigns(includeArchived = false): Campaign[] {
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return getDb()
    .prepare(`SELECT * FROM campaigns ${where} ORDER BY updated_at DESC`)
    .all() as Campaign[];
}

// Campaigns currently awaiting this client's review — the one status where
// the ball is in their court (needs_changes means we're the ones acting on
// their feedback, so it isn't "pending" on them).
export interface PendingApproval {
  id: string;
  title: string;
  external_token: string;
  updated_at: string;
}
export function listPendingApprovalCampaigns(clientId: string): PendingApproval[] {
  return getDb()
    .prepare(
      `SELECT id, title, external_token, updated_at FROM campaigns
       WHERE client_id = ? AND status = 'in_review' AND archived_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all(clientId) as PendingApproval[];
}

export function listArchivedCampaigns(): Campaign[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaigns WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`
    )
    .all() as Campaign[];
}

/**
 * Campaigns holding at least one item of the given asset kind.
 *
 * The kind lives on campaign_emails, not on the campaign, because one review
 * package can mix an email with a blog post. A campaign therefore counts as a
 * blog campaign if any of its items is one. Used to scope the list for the SEO
 * side of the team.
 */
export function listCampaignsWithKind(
  kind: EmailKind,
  opts?: { archived?: boolean }
): Campaign[] {
  const archived = opts?.archived
    ? "c.archived_at IS NOT NULL"
    : "c.archived_at IS NULL";
  const order = opts?.archived ? "c.archived_at DESC" : "c.updated_at DESC";
  return getDb()
    .prepare(
      `SELECT c.* FROM campaigns c
       WHERE ${archived}
         AND EXISTS (
           SELECT 1 FROM campaign_emails e
           WHERE e.campaign_id = c.id AND e.kind = ?
         )
       ORDER BY ${order}`
    )
    .all(kind) as Campaign[];
}

// Does this campaign contain an item of the given kind? Keeps someone scoped to
// blogs from opening a non-blog campaign by pasting its URL.
export function campaignHasKind(campaignId: string, kind: EmailKind): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit FROM campaign_emails WHERE campaign_id = ? AND kind = ? LIMIT 1`
    )
    .get(campaignId, kind) as { hit: number } | undefined;
  return Boolean(row);
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

// Review-link audience → stored approval channel. The internal (boss/team)
// token must never be recorded as a client sign-off.
export function approvalChannelForReview(
  channel: ReviewChannel
): "client" | "internal" {
  return channel === "internal" ? "internal" : "client";
}

// External reviewers can still leave feedback / sign off after a boss
// internal approve. Only a true client channel locks them out.
export function reviewAcceptsViewerAction(
  campaign: Campaign,
  viewer: ReviewChannel
): boolean {
  if (campaign.status !== "approved") return true;
  return viewer === "external" && campaign.approved_channel !== "client";
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
  bodyFormat?: BodyFormat;
  mediaUrl?: string | null;
  delayMs?: number;
  skipFlow?: boolean;
  flowParentId?: string | null;
  flowBranch?: FlowBranch;
}): CampaignEmail | null {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) return null;

  const db = getDb();
  const ts = nowIso();
  const id = nanoid(12);
  const kind = coerceKind(input.kind);
  const bodyFormat = coerceFormat(kind, input.bodyFormat);
  const mediaUrl = (input.mediaUrl || "").trim() || null;
  const delayMs =
    input.delayMs !== undefined
      ? Math.max(0, Math.round(input.delayMs))
      : 0;
  const maxRow = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) as max_order
       FROM campaign_emails WHERE campaign_id = ?`
    )
    .get(input.campaignId) as { max_order: number };

  db.prepare(
    `INSERT INTO campaign_emails
      (id, campaign_id, title, html_content, kind, body_format, media_url, delay_ms, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.campaignId,
    input.title.trim() || `Item ${maxRow.max_order + 2}`,
    input.htmlContent,
    kind,
    bodyFormat,
    mediaUrl,
    delayMs,
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
  if (!input.skipFlow && campaign.presentation === "automation") {
    attachEmailToFlow(input.campaignId, id, {
      parentId: input.flowParentId ?? null,
      branch: coerceFlowBranch(input.flowBranch),
      delayMs,
    });
  }
  return getEmailById(id);
}

export function updateEmail(
  emailId: string,
  updates: {
    title?: string;
    htmlContent?: string;
    purpose?: string;
    versionNote?: string;
    bodyFormat?: BodyFormat;
    mediaUrl?: string | null;
    delayMs?: number;
  }
): CampaignEmail | null {
  const existing = getEmailById(emailId);
  if (!existing) return null;

  const db = getDb();
  const ts = nowIso();
  const title = updates.title?.trim() ?? existing.title;
  const htmlContent = updates.htmlContent ?? existing.html_content;
  const purpose = updates.purpose?.trim() ?? existing.purpose;
  const bodyFormat = updates.bodyFormat
    ? coerceFormat(existing.kind, updates.bodyFormat)
    : existing.body_format;
  const mediaUrl =
    updates.mediaUrl !== undefined
      ? (updates.mediaUrl || "").trim() || null
      : existing.media_url;
  const delayMs =
    updates.delayMs !== undefined
      ? Math.max(0, Math.round(updates.delayMs))
      : existing.delay_ms ?? 0;

  db.prepare(
    `UPDATE campaign_emails
     SET title = ?, html_content = ?, purpose = ?, body_format = ?, media_url = ?, delay_ms = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, htmlContent, purpose, bodyFormat, mediaUrl, delayMs, ts, emailId);

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
    approvedBy?: string | null;
    approvedChannel?: string | null;
    presentation?: Presentation;
    triggerLabel?: string;
    triggerKind?: TriggerKind;
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
  const presentation = coercePresentation(
    updates.presentation ?? existing.presentation
  );
  const triggerLabel =
    updates.triggerLabel !== undefined
      ? updates.triggerLabel.trim()
      : existing.trigger_label || "";
  const triggerKind = coerceTriggerKind(
    updates.triggerKind ?? existing.trigger_kind
  );
  const status = updates.status ?? existing.status;
  const approvedAt =
    updates.approvedAt !== undefined ? updates.approvedAt : existing.approved_at;
  const approvedBy =
    updates.approvedBy !== undefined ? updates.approvedBy : existing.approved_by;
  const approvedChannel =
    updates.approvedChannel !== undefined
      ? updates.approvedChannel
      : existing.approved_channel;
  const clientChanged =
    updates.clientId !== undefined && updates.clientId !== existing.client_id;

  db.prepare(
    `UPDATE campaigns
     SET title = ?, client_name = ?, client_id = ?, description = ?, audience = ?, presentation = ?, trigger_label = ?, trigger_kind = ?, status = ?, approved_at = ?, approved_by = ?, approved_channel = ?,
         basecamp_card_id = CASE WHEN ? THEN NULL ELSE basecamp_card_id END,
         basecamp_card_url = CASE WHEN ? THEN NULL ELSE basecamp_card_url END,
         basecamp_approval_revision = CASE WHEN ? THEN NULL ELSE basecamp_approval_revision END,
         basecamp_approval_sent_at = CASE WHEN ? THEN NULL ELSE basecamp_approval_sent_at END,
         approval_thank_you_due_at = CASE WHEN ? THEN NULL ELSE approval_thank_you_due_at END,
         approval_thank_you_sent_at = CASE WHEN ? THEN NULL ELSE approval_thank_you_sent_at END,
         basecamp_followup_count = CASE WHEN ? THEN 0 ELSE basecamp_followup_count END,
         basecamp_followup_last_at = CASE WHEN ? THEN NULL ELSE basecamp_followup_last_at END,
         updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    clientName,
    clientId,
    description,
    audience,
    presentation,
    triggerLabel,
    triggerKind,
    status,
    approvedAt,
    approvedBy,
    approvedChannel,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    clientChanged ? 1 : 0,
    ts,
    id
  );

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

  if (
    updates.presentation &&
    coercePresentation(updates.presentation) === "automation"
  ) {
    ensureAutomationFlow(id);
  }

  return getCampaignById(id);
}

function touchCampaign(id: string) {
  getDb()
    .prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`)
    .run(nowIso(), id);
}

export function listFlowSteps(campaignId: string): CampaignFlowStep[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaign_flow_steps
       WHERE campaign_id = ?
       ORDER BY parent_id IS NOT NULL, branch ASC, sort_order ASC, created_at ASC`
    )
    .all(campaignId) as CampaignFlowStep[];
}

export function getFlowStep(id: string): CampaignFlowStep | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM campaign_flow_steps WHERE id = ?`)
      .get(id) as CampaignFlowStep | undefined) || null
  );
}

function flowChildren(
  campaignId: string,
  parentId: string | null,
  branch: FlowBranch
): CampaignFlowStep[] {
  if (parentId) {
    return getDb()
      .prepare(
        `SELECT * FROM campaign_flow_steps
         WHERE campaign_id = ? AND parent_id = ? AND branch = ?
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all(campaignId, parentId, branch) as CampaignFlowStep[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM campaign_flow_steps
       WHERE campaign_id = ? AND parent_id IS NULL AND branch = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(campaignId, branch) as CampaignFlowStep[];
}

function insertFlowStepRow(input: {
  campaignId: string;
  stepType: FlowStepType;
  parentId?: string | null;
  branch?: FlowBranch;
  delayMs?: number;
  emailId?: string | null;
  conditionKind?: ConditionKind;
  conditionLabel?: string;
  afterStepId?: string | null;
  prepend?: boolean;
}): CampaignFlowStep {
  const db = getDb();
  const ts = nowIso();
  const id = nanoid(12);
  const parentId = input.parentId || null;
  const branch = coerceFlowBranch(input.branch);
  const siblings = flowChildren(input.campaignId, parentId, branch);
  let sortOrder = siblings.length;
  if (input.prepend) {
    sortOrder = 0;
  } else if (input.afterStepId) {
    const after = siblings.find((step) => step.id === input.afterStepId);
    sortOrder = after ? after.sort_order + 1 : siblings.length;
  }
  if (sortOrder < siblings.length) {
    db.prepare(
      `UPDATE campaign_flow_steps
       SET sort_order = sort_order + 1
       WHERE campaign_id = ?
         AND ${parentId ? "parent_id = ?" : "parent_id IS NULL"}
         AND branch = ?
         AND sort_order >= ?`
    ).run(
      ...(parentId
        ? [input.campaignId, parentId, branch, sortOrder]
        : [input.campaignId, branch, sortOrder])
    );
  }
  db.prepare(
    `INSERT INTO campaign_flow_steps
      (id, campaign_id, parent_id, branch, sort_order, step_type, delay_ms, email_id, condition_kind, condition_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.campaignId,
    parentId,
    branch,
    sortOrder,
    input.stepType,
    Math.max(0, Math.round(input.delayMs || 0)),
    input.emailId || null,
    coerceConditionKind(input.conditionKind),
    (input.conditionLabel || "").trim(),
    ts,
    ts
  );
  touchCampaign(input.campaignId);
  return getFlowStep(id)!;
}

function attachEmailToFlow(
  campaignId: string,
  emailId: string,
  input: { parentId: string | null; branch: FlowBranch; delayMs: number }
) {
  const existing = listFlowSteps(campaignId);
  if (existing.length === 0) {
    ensureAutomationFlow(campaignId);
    return;
  }
  if (existing.some((step) => step.email_id === emailId)) return;
  if (input.delayMs > 0) {
    insertFlowStepRow({
      campaignId,
      stepType: "wait",
      parentId: input.parentId,
      branch: input.branch,
      delayMs: input.delayMs,
    });
  }
  insertFlowStepRow({
    campaignId,
    stepType: "email",
    parentId: input.parentId,
    branch: input.branch,
    emailId,
  });
}

export function ensureAutomationFlow(campaignId: string): CampaignFlowStep[] {
  const existing = listFlowSteps(campaignId);
  if (existing.length > 0) return existing;
  const emails = listEmails(campaignId);
  for (const email of emails) {
    if ((email.delay_ms || 0) > 0) {
      insertFlowStepRow({
        campaignId,
        stepType: "wait",
        delayMs: email.delay_ms,
      });
    }
    insertFlowStepRow({
      campaignId,
      stepType: "email",
      emailId: email.id,
    });
  }
  return listFlowSteps(campaignId);
}

export function addFlowStep(input: {
  campaignId: string;
  stepType: FlowStepType;
  parentId?: string | null;
  branch?: FlowBranch;
  delayMs?: number;
  conditionKind?: ConditionKind;
  conditionLabel?: string;
  emailTitle?: string;
  afterStepId?: string | null;
  prepend?: boolean;
}): { step: CampaignFlowStep; email?: CampaignEmail } | null {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) return null;
  ensureAutomationFlow(input.campaignId);

  if (input.stepType === "email") {
    const email = addEmail({
      campaignId: input.campaignId,
      title: input.emailTitle || `Email ${listEmails(input.campaignId).length + 1}`,
      htmlContent: "<p></p>",
      skipFlow: true,
    });
    if (!email) return null;
    const step = insertFlowStepRow({
      campaignId: input.campaignId,
      stepType: "email",
      parentId: input.parentId,
      branch: input.branch,
      emailId: email.id,
      afterStepId: input.afterStepId,
      prepend: input.prepend,
    });
    return { step, email };
  }

  const step = insertFlowStepRow({
    campaignId: input.campaignId,
    stepType: input.stepType,
    parentId: input.parentId,
    branch: input.branch,
    delayMs: input.delayMs ?? (input.stepType === "wait" ? 86_400_000 : 0),
    conditionKind: input.conditionKind,
    conditionLabel: input.conditionLabel,
    afterStepId: input.afterStepId,
    prepend: input.prepend,
  });
  return { step };
}

export function updateFlowStep(
  id: string,
  updates: {
    delayMs?: number;
    conditionKind?: ConditionKind;
    conditionLabel?: string;
  }
): CampaignFlowStep | null {
  const existing = getFlowStep(id);
  if (!existing) return null;
  const delayMs =
    updates.delayMs !== undefined
      ? Math.max(0, Math.round(updates.delayMs))
      : existing.delay_ms;
  const conditionKind = updates.conditionKind
    ? coerceConditionKind(updates.conditionKind)
    : coerceConditionKind(existing.condition_kind);
  const conditionLabel =
    updates.conditionLabel !== undefined
      ? updates.conditionLabel.trim()
      : existing.condition_label;
  getDb()
    .prepare(
      `UPDATE campaign_flow_steps
       SET delay_ms = ?, condition_kind = ?, condition_label = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(delayMs, conditionKind, conditionLabel, nowIso(), id);
  touchCampaign(existing.campaign_id);
  return getFlowStep(id);
}

export function deleteFlowStep(id: string): boolean {
  const existing = getFlowStep(id);
  if (!existing) return false;
  const type = coerceFlowStepType(existing.step_type);
  const parentId = existing.parent_id;
  const branch = coerceFlowBranch(existing.branch);

  if (type === "condition") {
    const yes = flowChildren(existing.campaign_id, existing.id, "yes");
    const no = flowChildren(existing.campaign_id, existing.id, "no");
    const siblings = flowChildren(existing.campaign_id, parentId, branch).filter(
      (step) => step.id !== existing.id
    );
    const insertAt = siblings.filter((step) => step.sort_order < existing.sort_order)
      .length;
    const next = [...siblings];
    next.splice(insertAt, 0, ...yes, ...no);
    const db = getDb();
    const stamp = nowIso();
    const stmt = db.prepare(
      `UPDATE campaign_flow_steps
       SET parent_id = ?, branch = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    );
    next.forEach((step, index) => {
      stmt.run(parentId, branch, index, stamp, step.id);
    });
  }

  getDb().prepare(`DELETE FROM campaign_flow_steps WHERE id = ?`).run(id);
  touchCampaign(existing.campaign_id);
  return true;
}

export function recordBasecampApproval(
  id: string,
  input: {
    cardId: string;
    cardUrl: string;
    revision: string;
    // Omitted when the send did not touch the due date, which keeps whatever
    // was stored from the previous send.
    dueOn?: string | null;
  }
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;
  const ts = nowIso();
  const dueOn =
    input.dueOn === undefined ? existing.basecamp_due_on : input.dueOn || null;
  getDb()
    .prepare(
      `UPDATE campaigns
       SET status = 'in_review',
           basecamp_card_id = ?,
           basecamp_card_url = ?,
           basecamp_approval_revision = ?,
           basecamp_approval_sent_at = ?,
           basecamp_due_on = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(input.cardId, input.cardUrl, input.revision, ts, dueOn, ts, id);
  return getCampaignById(id);
}

export function recordInternalReviewTodo(
  id: string,
  input: { todoId?: string | null; todoUrl?: string | null }
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;
  const todoId = (input.todoId || "").trim() || null;
  const todoUrl = (input.todoUrl || "").trim() || null;
  getDb()
    .prepare(
      `UPDATE campaigns
       SET internal_review_todo_id = ?,
           internal_review_todo_url = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(todoId, todoUrl, nowIso(), id);
  return getCampaignById(id);
}

export function rememberBasecampApprovalCard(
  id: string,
  cardId: string,
  cardUrl: string
): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE campaigns
       SET basecamp_card_id = ?, basecamp_card_url = ?
       WHERE id = ?`
    )
    .run(cardId, cardUrl, id);
  return getCampaignById(id);
}

export function recordBasecampFollowUp(id: string): Campaign | null {
  const existing = getCampaignById(id);
  if (!existing) return null;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE campaigns
       SET basecamp_followup_count = COALESCE(basecamp_followup_count, 0) + 1,
           basecamp_followup_last_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(ts, ts, id);
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
  quoteText?: string | null;
  quoteOrdinal?: number | null;
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

  const quoteText =
    input.type === "inline" && typeof input.quoteText === "string"
      ? input.quoteText.trim() || null
      : null;
  const quoteOrdinal =
    quoteText && typeof input.quoteOrdinal === "number" && input.quoteOrdinal >= 0
      ? Math.floor(input.quoteOrdinal)
      : quoteText
        ? 0
        : null;

  db.prepare(
    `INSERT INTO comments
      (id, campaign_id, email_id, author_name, body, type, pin_x, pin_y, quote_text, quote_ordinal, resolved, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    input.campaignId,
    emailId,
    (input.authorName || "Reviewer").trim() || "Reviewer",
    input.body.trim(),
    input.type,
    input.type === "inline" ? (input.pinX ?? null) : null,
    input.type === "inline" ? (input.pinY ?? null) : null,
    quoteText,
    quoteOrdinal,
    input.channel || "internal",
    ts
  );

  const campaign = getCampaignById(input.campaignId);
  const nextStatus = campaign
    ? statusAfterReviewerComment(
        campaign.status,
        input.channel || "internal"
      )
    : null;
  if (nextStatus && nextStatus !== campaign?.status) {
    updateCampaign(input.campaignId, { status: nextStatus as CampaignStatus });
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
  const next = statusAfterMarkRevisionDone(existing.status) as CampaignStatus;
  return updateCampaign(campaignId, { status: next });
}

/** Default delay before Michael's thank-you posts on the approval card. */
export const APPROVAL_THANK_YOU_DELAY_MS = 3 * 60 * 1000;

export function scheduleApprovalThankYou(campaignId: string): void {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return;
  if (campaign.approved_channel !== "client") return;
  if (!campaign.basecamp_card_id) return;
  if (campaign.approval_thank_you_sent_at) return;

  const dueAt = new Date(Date.now() + APPROVAL_THANK_YOU_DELAY_MS).toISOString();
  getDb()
    .prepare(
      `UPDATE campaigns SET approval_thank_you_due_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(dueAt, nowIso(), campaignId);
}

export function cancelPendingApprovalThankYou(campaignId: string): void {
  getDb()
    .prepare(
      `UPDATE campaigns SET approval_thank_you_due_at = NULL, updated_at = ? WHERE id = ?`
    )
    .run(nowIso(), campaignId);
}

export function clearApprovalThankYou(campaignId: string): void {
  getDb()
    .prepare(
      `UPDATE campaigns
       SET approval_thank_you_due_at = NULL,
           approval_thank_you_sent_at = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), campaignId);
}

export function markApprovalThankYouSent(campaignId: string): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE campaigns
       SET approval_thank_you_sent_at = ?,
           approval_thank_you_due_at = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(ts, ts, campaignId);
}

export function listDueApprovalThankYous(asOfIso?: string): Campaign[] {
  const asOf = asOfIso || nowIso();
  return getDb()
    .prepare(
      `SELECT * FROM campaigns
       WHERE status = 'approved'
         AND approved_channel = 'client'
         AND approval_thank_you_due_at IS NOT NULL
         AND approval_thank_you_due_at <= ?
         AND approval_thank_you_sent_at IS NULL
         AND basecamp_card_id IS NOT NULL`
    )
    .all(asOf) as Campaign[];
}

// approvedBy is the name attached to the approval: the client's own typed
// full name on a client approval, or the acting admin's label on an internal
// one. approvedChannel records which of those it was, so the two can never
// be confused with each other when read back later.
export function markApproved(
  campaignId: string,
  approvedBy?: string | null,
  approvedChannel: "client" | "internal" = "client"
): Campaign | null {
  const existing = getCampaignById(campaignId);
  if (!existing) return null;

  resolveAllComments(campaignId);
  // Stamp every email approved so per-email state matches the whole-package
  // approval.
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE campaign_emails SET approved_at = ?, approved_by = ?, approved_channel = ? WHERE campaign_id = ?`
    )
    .run(ts, approvedBy ?? null, approvedChannel, campaignId);
  const updated = updateCampaign(campaignId, {
    status: "approved",
    approvedAt: ts,
    approvedBy: approvedBy ?? null,
    approvedChannel,
  });
  if (updated && approvedChannel === "client") {
    scheduleApprovalThankYou(campaignId);
  } else if (updated && approvedChannel === "internal") {
    cancelPendingApprovalThankYou(campaignId);
  }
  return updated;
}

// Status dropdown / PATCH. "approved_internally" is stored as status approved
// + approved_channel internal so it stays distinct from client "Approved"
// without introducing a new DB status.
export function applyOperatorCampaignStatus(
  campaignId: string,
  next: string,
  approverLabel?: string | null
): Campaign | null {
  if (!isOperatorCampaignStatus(next)) return null;
  const existing = getCampaignById(campaignId);
  if (!existing) return null;

  const choice: OperatorCampaignStatus = next;
  if (choice === "approved_internally") {
    return markApproved(
      campaignId,
      approverLabel?.trim() || existing.approved_by || "Admin",
      "internal"
    );
  }

  if (choice === "approved") {
    return updateCampaign(campaignId, {
      status: "approved",
      approvedAt: existing.approved_at || nowIso(),
      approvedBy: existing.approved_by,
      approvedChannel: "client",
    });
  }

  // Scheduled needs a send datetime. scheduleCampaign() is the only writer.
  if (choice === "scheduled") {
    return null;
  }

  const leavingApproved = existing.status === "approved";
  if (leavingApproved) {
    clearApprovalThankYou(campaignId);
  }
  const updated = updateCampaign(campaignId, {
    status: storedStatusForOperatorChoice(choice),
    approvedAt: leavingApproved ? null : undefined,
    approvedBy: leavingApproved ? null : undefined,
    approvedChannel: leavingApproved ? null : undefined,
  });
  // Drop the send instant when leaving the scheduled/sent path so a later
  // cron tick cannot revive a draft from a leftover timestamp.
  if (
    updated &&
    existing.status === "scheduled" &&
    updated.status !== "sent" &&
    updated.status !== "scheduled"
  ) {
    getDb()
      .prepare(
        `UPDATE campaigns
         SET scheduled_send_at = NULL, scheduled_send_id = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), campaignId);
    return getCampaignById(campaignId);
  }
  return updated;
}

// Move a campaign back out of "approved" (e.g. a single email got
// un-approved). Clears approved_at so it drops out of the approvals
// folders until it's approved again.
export function unapproveCampaign(campaignId: string): Campaign | null {
  clearApprovalThankYou(campaignId);
  return updateCampaign(campaignId, {
    status: "in_review",
    approvedAt: null,
    approvedBy: null,
    approvedChannel: null,
  });
}

// Approve (or un-approve) a single email. Returns whether every email in the
// campaign is now approved. approvedBy/approvedChannel work as in
// markApproved above.
export function setEmailApproved(
  emailId: string,
  approved: boolean,
  approvedBy?: string | null,
  approvedChannel: "client" | "internal" = "client"
): { email: CampaignEmail | null; allApproved: boolean; campaignId: string } {
  const email = getEmailById(emailId);
  if (!email) return { email: null, allApproved: false, campaignId: "" };

  getDb()
    .prepare(
      `UPDATE campaign_emails SET approved_at = ?, approved_by = ?, approved_channel = ? WHERE id = ?`
    )
    .run(
      approved ? nowIso() : null,
      approved ? approvedBy ?? null : null,
      approved ? approvedChannel : null,
      emailId
    );

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
  quote_text: string | null;
  email_title: string | null;
  resolved: number | null;
  star_rating: number | null;
  attachment_count: number;
  approved_channel: string | null;
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
           c.quote_text AS quote_text,
           e.title AS email_title,
           c.resolved AS resolved,
           NULL AS star_rating,
           (SELECT COUNT(*) FROM comment_attachments a WHERE a.comment_id = c.id) AS attachment_count,
           NULL AS approved_channel,
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
           cam.approved_by AS actor,
           NULL AS body,
           NULL AS comment_type,
           NULL AS quote_text,
           NULL AS email_title,
           NULL AS resolved,
           cam.star_rating AS star_rating,
           0 AS attachment_count,
           cam.approved_channel AS approved_channel,
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
