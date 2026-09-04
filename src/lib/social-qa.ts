import { nanoid } from "nanoid";
import {
  SERVICE,
  SOCIAL_QA_TODOLIST_NAME,
  basecampConnected,
  commentOnCard,
  completeTodoStep,
  createAssignedTodo,
  createTodoStep,
  getProjectPeopleForMention,
  resolveSylviaMention,
  type BcIdentity,
  type BcPerson,
} from "./basecamp";
import {
  getDb,
  nowIso,
  type SocialBatch,
  type SocialBatchStatus,
  type SocialPost,
  type SocialQaReview,
} from "./db";
import { recordFailure } from "./failures";
import {
  INTERNAL_REVIEW_MESSAGE_MAX_CHARS,
  internalReviewMention,
  internalReviewTodoHtmlFromText,
  parseInternalReviewDueOn,
  pickDefaultInternalReviewer,
  type InternalReviewPerson,
} from "./internal-review";
import { pickAssigneeOnRoster } from "./assign-todo";
import { adminSocialBatchUrl } from "./auth";
import {
  defaultSocialQaAssignee,
  isValidPerson,
  personLabel,
  socialQaAssigneeOptions,
} from "./people";
import { getRevClient, listRevClients } from "./revenue";
import {
  SOCIAL_QA_CHECKLIST,
  isSocialBatchStatus,
  isSocialIssueTag,
  issueTagLabel,
  socialQaChecklistComplete,
} from "./social-qa-meta";
import { createTodo } from "./todos";

export {
  SOCIAL_QA_STATUSES,
  SOCIAL_QA_STATUS_LABELS,
  SOCIAL_QA_CHECKLIST,
  SOCIAL_CHANNELS,
  SOCIAL_ISSUE_TAGS,
  isSocialBatchStatus,
  isSocialIssueTag,
  issueTagLabel,
  socialQaChecklistComplete,
  emptySocialQaChecklist,
} from "./social-qa-meta";
export type { SocialIssueTag, SocialQaChecklistState } from "./social-qa-meta";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return DATE_RE.test(value) ? value : null;
}

function clientNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function resolveClient(batch: Pick<SocialBatch, "client_id" | "client_name">) {
  if (batch.client_id) {
    const linked = getRevClient(batch.client_id);
    if (linked) return linked;
  }
  const name = clientNameKey(batch.client_name);
  if (!name) return null;
  return listRevClients(true).find((c) => clientNameKey(c.name) === name) || null;
}

export type SocialBatchRow = SocialBatch;

export function listSocialBatches(archived = false): SocialBatchRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM social_batches
        WHERE ${archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"}
        ORDER BY updated_at DESC`
    )
    .all() as SocialBatchRow[];
}

export function getSocialBatch(id: string): SocialBatch | null {
  return (
    (getDb().prepare(`SELECT * FROM social_batches WHERE id = ?`).get(id) as
      | SocialBatch
      | undefined) || null
  );
}

export function listSocialPosts(batchId: string): SocialPost[] {
  return getDb()
    .prepare(
      `SELECT * FROM social_posts WHERE batch_id = ? ORDER BY sort_order ASC, created_at ASC`
    )
    .all(batchId) as SocialPost[];
}

export function getSocialPost(id: string): SocialPost | null {
  return (
    (getDb().prepare(`SELECT * FROM social_posts WHERE id = ?`).get(id) as
      | SocialPost
      | undefined) || null
  );
}

export function createSocialBatch(input: {
  title: string;
  clientName?: string;
  clientId?: string | null;
  sproutUrl?: string;
  notes?: string;
  createdBy: string;
}): SocialBatch {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const clientId = input.clientId || null;
  const linked = clientId ? getRevClient(clientId) : null;
  db.prepare(
    `INSERT INTO social_batches
      (id, title, client_name, client_id, sprout_url, notes, status, created_by,
       qa_assignee, issue_tag, issue_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '', '', '', ?, ?)`
  ).run(
    id,
    input.title.trim(),
    (linked?.name || input.clientName || "").trim(),
    linked?.id || clientId,
    (input.sproutUrl || "").trim(),
    (input.notes || "").trim(),
    input.createdBy,
    ts,
    ts
  );
  return getSocialBatch(id)!;
}

export function updateSocialBatch(
  id: string,
  patch: {
    title?: string;
    clientName?: string;
    clientId?: string | null;
    sproutUrl?: string;
    notes?: string;
    status?: SocialBatchStatus;
    archived?: boolean;
    issueTag?: string;
    issueNote?: string;
    qaBy?: string | null;
    clearQa?: boolean;
  }
): SocialBatch | null {
  const current = getSocialBatch(id);
  if (!current) return null;
  const db = getDb();
  const ts = nowIso();
  let clientId = patch.clientId === undefined ? current.client_id : patch.clientId;
  let clientName =
    patch.clientName === undefined ? current.client_name : patch.clientName.trim();
  if (patch.clientId !== undefined) {
    const linked = patch.clientId ? getRevClient(patch.clientId) : null;
    if (linked) {
      clientId = linked.id;
      if (patch.clientName === undefined) clientName = linked.name;
    }
  }
  const archivedAt =
    patch.archived === undefined
      ? current.archived_at
      : patch.archived
        ? current.archived_at || ts
        : null;
  const issueTag =
    patch.issueTag === undefined
      ? current.issue_tag
      : patch.issueTag === "" || isSocialIssueTag(patch.issueTag)
        ? patch.issueTag
        : current.issue_tag;
  let status =
    patch.status && isSocialBatchStatus(patch.status) ? patch.status : current.status;
  if (patch.issueTag !== undefined && issueTag && status === "in_qa") {
    status = "needs_revisions";
  }
  if (patch.issueTag === "" && status === "needs_revisions") {
    status = "in_qa";
  }
  let qaBy = current.qa_by;
  let qaAt = current.qa_at;
  if (patch.clearQa) {
    qaBy = null;
    qaAt = null;
  } else if (patch.qaBy) {
    qaBy = patch.qaBy;
    qaAt = ts;
  }
  db.prepare(
    `UPDATE social_batches
        SET title = ?, client_name = ?, client_id = ?, sprout_url = ?, notes = ?,
            status = ?, archived_at = ?, issue_tag = ?, issue_note = ?,
            qa_by = ?, qa_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    patch.title !== undefined ? patch.title.trim() : current.title,
    clientName,
    clientId,
    patch.sproutUrl !== undefined ? patch.sproutUrl.trim() : current.sprout_url,
    patch.notes !== undefined ? patch.notes.trim() : current.notes,
    status,
    archivedAt,
    issueTag,
    patch.issueNote !== undefined ? patch.issueNote.trim() : current.issue_note,
    qaBy,
    qaAt,
    ts,
    id
  );
  return getSocialBatch(id);
}

export function deleteSocialBatch(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM social_batches WHERE id = ?`).run(id);
  return result.changes > 0;
}

function insertPost(
  batchId: string,
  input: {
    title: string;
    channel: string;
    goLiveOn: string | null;
    createdBy: string;
    sortOrder: number;
  }
): SocialPost {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO social_posts
      (id, batch_id, title, channel, go_live_on, created_by, issue_tag, issue_note,
       sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?, ?)`
  ).run(
    id,
    batchId,
    input.title.trim(),
    input.channel.trim(),
    coerceDate(input.goLiveOn),
    input.createdBy,
    input.sortOrder,
    ts,
    ts
  );
  getDb()
    .prepare(`UPDATE social_batches SET updated_at = ? WHERE id = ?`)
    .run(ts, batchId);
  return getSocialPost(id)!;
}

export function addSocialPost(
  batchId: string,
  input: {
    title: string;
    channel?: string;
    goLiveOn?: string | null;
    createdBy: string;
  }
): SocialPost | null {
  if (!getSocialBatch(batchId)) return null;
  const max = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM social_posts WHERE batch_id = ?`)
    .get(batchId) as { n: number };
  return insertPost(batchId, {
    title: input.title,
    channel: input.channel || "",
    goLiveOn: input.goLiveOn ?? null,
    createdBy: input.createdBy,
    sortOrder: max.n + 1,
  });
}

export function updateSocialPost(
  id: string,
  patch: {
    title?: string;
    channel?: string;
    goLiveOn?: string | null;
    createdBy?: string;
    issueTag?: string;
    issueNote?: string;
    qaBy?: string | null;
    clearQa?: boolean;
  }
): SocialPost | null {
  const current = getSocialPost(id);
  if (!current) return null;
  const ts = nowIso();
  let qaBy = current.qa_by;
  let qaAt = current.qa_at;
  if (patch.clearQa) {
    qaBy = null;
    qaAt = null;
  } else if (patch.qaBy) {
    qaBy = patch.qaBy;
    qaAt = ts;
  }
  const issueTag =
    patch.issueTag === undefined
      ? current.issue_tag
      : patch.issueTag === "" || isSocialIssueTag(patch.issueTag)
        ? patch.issueTag
        : current.issue_tag;
  getDb()
    .prepare(
      `UPDATE social_posts
          SET title = ?, channel = ?, go_live_on = ?, created_by = ?,
              qa_by = ?, qa_at = ?, issue_tag = ?, issue_note = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      patch.title !== undefined ? patch.title.trim() : current.title,
      patch.channel !== undefined ? patch.channel.trim() : current.channel,
      patch.goLiveOn !== undefined ? coerceDate(patch.goLiveOn) : current.go_live_on,
      patch.createdBy !== undefined ? patch.createdBy : current.created_by,
      qaBy,
      qaAt,
      issueTag,
      patch.issueNote !== undefined ? patch.issueNote.trim() : current.issue_note,
      ts,
      id
    );
  getDb()
    .prepare(`UPDATE social_batches SET updated_at = ? WHERE id = ?`)
    .run(ts, current.batch_id);
  const next = getSocialPost(id)!;
  if (issueTag && getSocialBatch(current.batch_id)?.status === "in_qa") {
    updateSocialBatch(current.batch_id, { status: "needs_revisions" });
  }
  return next;
}

export function deleteSocialPost(id: string): boolean {
  const current = getSocialPost(id);
  if (!current) return false;
  getDb().prepare(`DELETE FROM social_posts WHERE id = ?`).run(id);
  getDb()
    .prepare(`UPDATE social_batches SET updated_at = ? WHERE id = ?`)
    .run(nowIso(), current.batch_id);
  return true;
}

export type SocialIssueStat = {
  tag: string;
  label: string;
  created_by: string;
  client_name: string;
  batch_id: string;
  batch_title: string;
  updated_at: string;
};

export function listSocialIssueRows(): SocialIssueStat[] {
  const rows = getDb()
    .prepare(
      `SELECT issue_tag AS tag, created_by, client_name, id AS batch_id,
              title AS batch_title, updated_at
         FROM social_batches
        WHERE issue_tag != ''
        ORDER BY updated_at DESC`
    )
    .all() as Array<Omit<SocialIssueStat, "label">>;
  return rows.map((row) => ({ ...row, label: issueTagLabel(row.tag) }));
}

export function socialIssueCounts(): Array<{ tag: string; label: string; count: number }> {
  const rows = getDb()
    .prepare(
      `SELECT issue_tag AS tag, COUNT(*) AS count
         FROM social_batches
        WHERE issue_tag != ''
        GROUP BY issue_tag
        ORDER BY count DESC, issue_tag ASC`
    )
    .all() as Array<{ tag: string; count: number }>;
  return rows.map((row) => ({ ...row, label: issueTagLabel(row.tag) }));
}

export function pickDefaultSocialQaReviewer(
  people: InternalReviewPerson[],
  createdBySlug: string
): InternalReviewPerson | null {
  const other =
    createdBySlug === "randi" ? "Lana" : createdBySlug === "lana" ? "Randi" : "";
  if (other) {
    const hit = pickDefaultInternalReviewer(people, other);
    if (hit) return hit;
  }
  return (
    pickDefaultInternalReviewer(people, "Randi") ||
    pickDefaultInternalReviewer(people, "Lana") ||
    people[0] ||
    null
  );
}

export function socialQaTodoMessageText(input: {
  reviewerName?: string;
  deskUrl: string;
  sproutUrl?: string;
}): string {
  const first = (input.reviewerName || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `@${first}` : "Hey";
  const sprout = (input.sproutUrl || "").trim();
  return [
    `${greeting}, please QA this batch of social posts and sign it off in Campaign Desk.`,
    "",
    "Check for typos, wrong dates, off-brand creative, and caption mismatches.",
    "Open the batch in Campaign Desk, check the Sprout queue, and type your name to approve when it is clean.",
    "",
    "Campaign Desk:",
    input.deskUrl,
    ...(sprout ? ["", "Sprout:", sprout] : []),
  ].join("\n");
}

export async function socialQaState(batchId: string): Promise<
  | {
      ready: boolean;
      missing: string[];
      clientName: string;
      assignees: Array<{ slug: string; label: string }>;
      defaultReviewerSlug: string;
      peopleReason: string;
      todoUrl: string | null;
      todoId: string | null;
      message: string;
    }
  | null
> {
  const batch = getSocialBatch(batchId);
  if (!batch) return null;
  const client = resolveClient(batch);
  const missing: string[] = [];
  if (!client) missing.push("linked client account");
  if (client && !client.basecamp_project_id) missing.push("Basecamp project");
  if (!basecampConnected()) missing.push("Basecamp connection");
  if (!batch.sprout_url.trim()) missing.push("Sprout Social link");

  let peopleReason = "";
  if (client && !client.basecamp_project_id) {
    peopleReason = "This client needs a Basecamp project before a review to-do can be assigned.";
  }

  const defaultReviewerSlug = defaultSocialQaAssignee(batch.created_by);
  const reviewerName = personLabel(defaultReviewerSlug);
  return {
    ready: missing.length === 0,
    missing,
    clientName: client?.name || batch.client_name || "",
    assignees: socialQaAssigneeOptions(),
    defaultReviewerSlug,
    peopleReason,
    todoUrl: batch.qa_todo_url,
    todoId: batch.qa_todo_id,
    message: socialQaTodoMessageText({
      reviewerName,
      deskUrl: adminSocialBatchUrl(batch.id),
      sproutUrl: batch.sprout_url,
    }),
  };
}

export async function sendSocialBatchForQa(input: {
  batchId: string;
  reviewerSlug: string;
  dueOn?: string | null;
  identity?: BcIdentity;
  message?: string | null;
}): Promise<
  | {
      ok: true;
      reviewerName: string;
      todoId: string;
      todoUrl: string;
      status: SocialBatchStatus;
      dueOn: string | null;
    }
  | { ok: false; error: string; status: number }
> {
  const batch = getSocialBatch(input.batchId);
  if (!batch) return { ok: false, error: "Not found", status: 404 };
  const reviewerSlug = input.reviewerSlug.trim();
  if (!isValidPerson(reviewerSlug)) {
    return { ok: false, error: "Pick the teammate who should review this batch.", status: 400 };
  }
  const dueOn = parseInternalReviewDueOn(input.dueOn);
  if (!dueOn) {
    return { ok: false, error: "Pick a due date for the review to-do.", status: 400 };
  }
  if (!basecampConnected()) {
    return {
      ok: false,
      error: "Basecamp isn't connected. Connect it before assigning a review to-do.",
      status: 400,
    };
  }
  const client = resolveClient(batch);
  if (!client?.basecamp_project_id) {
    return {
      ok: false,
      error: "This batch needs a linked client with a Basecamp project.",
      status: 400,
    };
  }
  if (!batch.sprout_url.trim()) {
    return { ok: false, error: "Add the Sprout Social link before sending for review.", status: 400 };
  }

  const identity = input.identity ?? SERVICE;
  let roster: BcPerson[] = [];
  try {
    roster = await getProjectPeopleForMention(client.basecamp_project_id, identity);
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || "Could not load the Basecamp project roster.",
      status: 502,
    };
  }
  const reviewer = pickAssigneeOnRoster(roster, reviewerSlug);
  if (!reviewer) {
    return {
      ok: false,
      error: `${personLabel(reviewerSlug)} isn't on this client's Basecamp project, so the to-do can't be assigned.`,
      status: 400,
    };
  }
  const reviewerPerson = roster.find((person) => person.id === reviewer.id);
  const deskUrl = adminSocialBatchUrl(batch.id);
  const text =
    (input.message || "").replace(/\r\n/g, "\n").trim() ||
    socialQaTodoMessageText({
      reviewerName: reviewer.name,
      deskUrl,
      sproutUrl: batch.sprout_url,
    });
  const mention = internalReviewMention(
    reviewerPerson || {
      id: reviewer.id,
      name: reviewer.name,
    }
  );
  const who = (batch.client_name || client.name).trim();
  const title = `Review social: ${who ? `${who} — ` : ""}${batch.title}`.slice(0, 999);
  const created = await createAssignedTodo({
    projectId: client.basecamp_project_id,
    title,
    description: internalReviewTodoHtmlFromText(
      text,
      mention,
      await resolveSylviaMention(roster, identity)
    ),
    assigneeIds: [reviewer.id],
    dueOn,
    identity,
    listName: SOCIAL_QA_TODOLIST_NAME,
  });
  if (!created.ok) {
    return { ok: false, error: created.error, status: 502 };
  }

  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE social_batches
          SET status = 'in_qa', qa_assignee = ?, qa_todo_id = ?, qa_todo_url = ?,
              qa_project_id = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      personLabel(reviewerSlug),
      created.todoId,
      created.todoUrl,
      client.basecamp_project_id,
      ts,
      batch.id
    );

  createTodo({
    title,
    notes: ["Social QA", deskUrl, created.todoUrl].join("\n"),
    clientId: batch.client_id || client.id,
    assignee: reviewerSlug,
    dueDate: dueOn,
    source: "social_qa",
    listName: SOCIAL_QA_TODOLIST_NAME,
  });

  return {
    ok: true,
    reviewerName: personLabel(reviewerSlug),
    todoId: created.todoId,
    todoUrl: created.todoUrl,
    status: "in_qa",
    dueOn,
  };
}

export function listSocialQaReviews(batchId: string): SocialQaReview[] {
  return getDb()
    .prepare(
      `SELECT * FROM social_qa_reviews WHERE batch_id = ? ORDER BY created_at ASC`
    )
    .all(batchId) as SocialQaReview[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function checklistFromInput(
  raw: unknown
): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const item of SOCIAL_QA_CHECKLIST) {
    out[item.key] = (raw as Record<string, unknown>)[item.key] === true;
  }
  return out;
}

export function socialQaApproveCommentHtml(input: {
  name: string;
  checklist: Record<string, boolean>;
}): string {
  const items = SOCIAL_QA_CHECKLIST.map(
    (item) => `<li>${escapeHtml(item.label)}</li>`
  ).join("");
  return (
    `<p>I have reviewed and approved this work from a QA standpoint.</p>` +
    `<p>${escapeHtml(input.name)} completed:</p>` +
    `<ul>${items}</ul>`
  );
}

export function socialQaRejectCommentHtml(input: {
  name: string;
  feedback: string;
}): string {
  const feedback = escapeHtml(input.feedback).replace(/\n/g, "<br>");
  return (
    `<p>I have reviewed this batch and it is not approved yet.</p>` +
    `<p>${escapeHtml(input.name)} left this feedback:</p>` +
    `<p>${feedback}</p>`
  );
}

async function postQaReviewComment(input: {
  batch: SocialBatch;
  html: string;
  identity: BcIdentity;
}): Promise<{ url: string | null; warning?: string }> {
  const projectId = (input.batch.qa_project_id || "").trim();
  const todoId = (input.batch.qa_todo_id || "").trim();
  if (!projectId || !todoId) {
    return {
      url: null,
      warning: "Saved in Campaign Desk. There is no Social QA to-do to comment on yet.",
    };
  }
  const posted = await commentOnCard(projectId, todoId, input.html, input.identity);
  if (!posted.ok) {
    return {
      url: null,
      warning: "Saved in Campaign Desk, but Basecamp did not get the review note.",
    };
  }
  return { url: posted.url || null };
}

function insertQaReview(input: {
  batchId: string;
  decision: "approved" | "rejected";
  authorSlug: string;
  authorName: string;
  feedback: string;
  checklist: Record<string, boolean>;
  bcCommentUrl: string | null;
}): SocialQaReview {
  const id = nanoid(12);
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO social_qa_reviews
        (id, batch_id, decision, author_slug, author_name, feedback, checklist_json,
         bc_comment_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.batchId,
      input.decision,
      input.authorSlug,
      input.authorName,
      input.feedback,
      JSON.stringify(input.checklist),
      input.bcCommentUrl,
      ts
    );
  return getDb().prepare(`SELECT * FROM social_qa_reviews WHERE id = ?`).get(id) as SocialQaReview;
}

export async function signOffSocialBatch(input: {
  batchId: string;
  approvedBy: string;
  actorSlug: string;
  identity?: BcIdentity;
  checklist?: Record<string, boolean> | unknown;
}): Promise<
  | { ok: true; batch: SocialBatch; warning?: string }
  | { ok: false; error: string; status: number }
> {
  return reviewSocialBatch({
    batchId: input.batchId,
    approved: true,
    reviewedBy: input.approvedBy,
    actorSlug: input.actorSlug,
    identity: input.identity,
    checklist: input.checklist,
  });
}

export async function reviewSocialBatch(input: {
  batchId: string;
  approved: boolean;
  reviewedBy: string;
  actorSlug: string;
  identity?: BcIdentity;
  checklist?: Record<string, boolean> | unknown;
  feedback?: string | null;
}): Promise<
  | { ok: true; batch: SocialBatch; warning?: string }
  | { ok: false; error: string; status: number }
> {
  const batch = getSocialBatch(input.batchId);
  if (!batch) return { ok: false, error: "Not found", status: 404 };
  if (batch.status === "approved") {
    return { ok: false, error: "This batch is already signed off.", status: 400 };
  }
  const name = input.reviewedBy.trim();
  if (name.length < 2) {
    return { ok: false, error: "Type your name to record this review.", status: 400 };
  }
  const checklist = checklistFromInput(input.checklist);
  const identity = input.identity ?? SERVICE;

  if (input.approved) {
    if (!socialQaChecklistComplete(checklist)) {
      return {
        ok: false,
        error: "Complete the QA checklist before approving this batch.",
        status: 400,
      };
    }

    const ts = nowIso();
    let stepId = batch.signoff_step_id;
    const posted = await postQaReviewComment({
      batch,
      html: socialQaApproveCommentHtml({ name, checklist }),
      identity,
    });
    let warning = posted.warning;

    const projectId = (batch.qa_project_id || "").trim();
    const todoId = (batch.qa_todo_id || "").trim();
    if (projectId && todoId) {
      const stepTitle = `${name} has reviewed and approved this batch of social`.slice(0, 999);
      const created = await createTodoStep(projectId, todoId, stepTitle, identity);
      if (created.ok && created.id) {
        stepId = created.id;
        const completed = await completeTodoStep(projectId, created.id, "on", identity);
        if (!completed.ok) {
          warning =
            warning ||
            "Signed off here, but Basecamp did not check off the subtask.";
          recordFailure({
            kind: "basecamp_todo",
            subject: batch.client_name || batch.title,
            detail: completed.error || "complete step failed",
            hint: "Open the Social QA to-do in Basecamp and check the sign-off subtask.",
          });
        }
      }
    }

    getDb()
      .prepare(
        `UPDATE social_batches
            SET status = 'approved', approved_at = ?, approved_by = ?, approved_by_slug = ?,
                signoff_step_id = ?, qa_by = COALESCE(qa_by, ?), qa_at = COALESCE(qa_at, ?),
                issue_tag = '', issue_note = '', updated_at = ?
          WHERE id = ?`
      )
      .run(ts, name, input.actorSlug, stepId, input.actorSlug, ts, ts, batch.id);

    insertQaReview({
      batchId: batch.id,
      decision: "approved",
      authorSlug: input.actorSlug,
      authorName: name,
      feedback: "",
      checklist,
      bcCommentUrl: posted.url,
    });

    return { ok: true, batch: getSocialBatch(batch.id)!, warning };
  }

  const feedback = (input.feedback || "").replace(/\r\n/g, "\n").trim();
  if (feedback.length < 2) {
    return {
      ok: false,
      error: "Leave feedback so the creator knows what to fix.",
      status: 400,
    };
  }

  const posted = await postQaReviewComment({
    batch,
    html: socialQaRejectCommentHtml({ name, feedback }),
    identity,
  });
  if (posted.warning) {
    recordFailure({
      kind: "basecamp_todo",
      subject: batch.client_name || batch.title,
      detail: posted.warning,
      hint: "The feedback is saved in Campaign Desk; add it on the Social QA to-do if needed.",
    });
  }

  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE social_batches
          SET status = 'needs_revisions', issue_tag = CASE WHEN issue_tag = '' THEN 'other' ELSE issue_tag END,
              issue_note = ?, qa_by = COALESCE(qa_by, ?), qa_at = COALESCE(qa_at, ?),
              updated_at = ?
        WHERE id = ?`
    )
    .run(feedback, input.actorSlug, ts, ts, batch.id);

  insertQaReview({
    batchId: batch.id,
    decision: "rejected",
    authorSlug: input.actorSlug,
    authorName: name,
    feedback,
    checklist,
    bcCommentUrl: posted.url,
  });

  return { ok: true, batch: getSocialBatch(batch.id)!, warning: posted.warning };
}

export { INTERNAL_REVIEW_MESSAGE_MAX_CHARS };
