import { nanoid } from "nanoid";
import {
  SERVICE,
  SOCIAL_QA_TODOLIST_NAME,
  basecampConnected,
  completeTodoStep,
  createAssignedTodo,
  createTodoStep,
  getProjectPeopleForMention,
  resolveSylviaMention,
  type BcIdentity,
  type BcPerson,
} from "./basecamp";
import { getDb, nowIso, type SocialBatch, type SocialBatchStatus, type SocialPost } from "./db";
import { recordFailure } from "./failures";
import {
  INTERNAL_REVIEW_MESSAGE_MAX_CHARS,
  internalReviewMention,
  internalReviewTodoHtmlFromText,
  parseInternalReviewDueOn,
  pickDefaultInternalReviewer,
  teamPeopleForInternalReview,
  type InternalReviewPerson,
} from "./internal-review";
import { adminSocialBatchUrl } from "./auth";
import { getRevClient, listRevClients } from "./revenue";
import {
  isSocialBatchStatus,
  isSocialIssueTag,
  issueTagLabel,
} from "./social-qa-meta";
import { slugForName } from "./team";
import { createTodo } from "./todos";

export {
  SOCIAL_QA_STATUSES,
  SOCIAL_QA_STATUS_LABELS,
  SOCIAL_CHANNELS,
  SOCIAL_ISSUE_TAGS,
  isSocialBatchStatus,
  isSocialIssueTag,
  issueTagLabel,
} from "./social-qa-meta";
export type { SocialIssueTag } from "./social-qa-meta";

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

export type SocialBatchRow = SocialBatch & {
  post_count: number;
  issue_count: number;
  qa_count: number;
};

export function listSocialBatches(archived = false): SocialBatchRow[] {
  return getDb()
    .prepare(
      `SELECT b.*,
              (SELECT COUNT(*) FROM social_posts p WHERE p.batch_id = b.id) AS post_count,
              (SELECT COUNT(*) FROM social_posts p WHERE p.batch_id = b.id AND p.issue_tag != '') AS issue_count,
              (SELECT COUNT(*) FROM social_posts p WHERE p.batch_id = b.id AND p.qa_at IS NOT NULL) AS qa_count
         FROM social_batches b
        WHERE ${archived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL"}
        ORDER BY b.updated_at DESC`
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
  posts?: Array<{
    title: string;
    channel?: string;
    goLiveOn?: string | null;
    createdBy?: string;
  }>;
}): SocialBatch {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const clientId = input.clientId || null;
  const linked = clientId ? getRevClient(clientId) : null;
  db.prepare(
    `INSERT INTO social_batches
      (id, title, client_name, client_id, sprout_url, notes, status, created_by,
       qa_assignee, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '', ?, ?)`
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
  const posts = input.posts || [];
  posts.forEach((post, index) => {
    const title = post.title.trim();
    if (!title) return;
    insertPost(id, {
      title,
      channel: post.channel || "",
      goLiveOn: post.goLiveOn ?? null,
      createdBy: post.createdBy || input.createdBy,
      sortOrder: index,
    });
  });
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
  db.prepare(
    `UPDATE social_batches
        SET title = ?, client_name = ?, client_id = ?, sprout_url = ?, notes = ?,
            status = ?, archived_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    patch.title !== undefined ? patch.title.trim() : current.title,
    clientName,
    clientId,
    patch.sproutUrl !== undefined ? patch.sproutUrl.trim() : current.sprout_url,
    patch.notes !== undefined ? patch.notes.trim() : current.notes,
    patch.status && isSocialBatchStatus(patch.status) ? patch.status : current.status,
    archivedAt,
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
  count: number;
  created_by: string;
  client_name: string;
  batch_id: string;
  batch_title: string;
  post_title: string;
  post_id: string;
  updated_at: string;
};

export function listSocialIssueRows(): SocialIssueStat[] {
  const rows = getDb()
    .prepare(
      `SELECT p.issue_tag AS tag, p.created_by, p.title AS post_title, p.id AS post_id,
              p.updated_at, b.id AS batch_id, b.title AS batch_title, b.client_name
         FROM social_posts p
         JOIN social_batches b ON b.id = p.batch_id
        WHERE p.issue_tag != ''
        ORDER BY p.updated_at DESC`
    )
    .all() as Array<Omit<SocialIssueStat, "label">>;
  return rows.map((row) => ({ ...row, label: issueTagLabel(row.tag) }));
}

export function socialIssueCounts(): Array<{ tag: string; label: string; count: number }> {
  const rows = getDb()
    .prepare(
      `SELECT issue_tag AS tag, COUNT(*) AS count
         FROM social_posts
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
    "Flag anything that needs a fix on the row, then type your name and approve the batch when it is clean.",
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
      people: InternalReviewPerson[];
      peopleReason: string;
      defaultReviewerId: number | null;
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

  let people: InternalReviewPerson[] = [];
  let peopleReason = "";
  if (client?.basecamp_project_id && basecampConnected()) {
    try {
      const roster = await getProjectPeopleForMention(client.basecamp_project_id);
      people = teamPeopleForInternalReview(roster);
      if (!people.length) {
        peopleReason =
          "Nobody from our team is on that Basecamp project, so there is no one to assign.";
      }
    } catch {
      peopleReason = "Could not load the Basecamp project roster.";
    }
  }

  const defaultReviewer = pickDefaultSocialQaReviewer(people, batch.created_by.split(":")[0] || "");
  return {
    ready: missing.length === 0 && people.length > 0,
    missing,
    clientName: client?.name || batch.client_name || "",
    people,
    peopleReason,
    defaultReviewerId: defaultReviewer?.id ?? null,
    todoUrl: batch.qa_todo_url,
    todoId: batch.qa_todo_id,
    message: socialQaTodoMessageText({
      reviewerName: defaultReviewer?.name || "",
      deskUrl: adminSocialBatchUrl(batch.id),
      sproutUrl: batch.sprout_url,
    }),
  };
}

export async function sendSocialBatchForQa(input: {
  batchId: string;
  reviewerId: number;
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
  if (!basecampConnected()) {
    return {
      ok: false,
      error: "Basecamp isn't connected. Connect it before sending for QA.",
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
    return { ok: false, error: "Add the Sprout Social link before sending for QA.", status: 400 };
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
  const team = teamPeopleForInternalReview(roster);
  const reviewer = team.find((person) => person.id === input.reviewerId);
  if (!reviewer) {
    return { ok: false, error: "Pick a teammate on this Basecamp project.", status: 400 };
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
      attachable_sgid: reviewer.attachableSgid,
    }
  );
  const who = (batch.client_name || client.name).trim();
  const title = `QA ${who ? `${who}: ` : ""}${batch.title}`.slice(0, 999);
  const dueOn = parseInternalReviewDueOn(input.dueOn);
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
      reviewer.name,
      created.todoId,
      created.todoUrl,
      client.basecamp_project_id,
      ts,
      batch.id
    );

  const assigneeSlug =
    slugForName(reviewer.name) || slugForName(reviewer.name.split(/\s+/)[0] || "");
  if (assigneeSlug) {
    createTodo({
      title,
      notes: ["Social QA", deskUrl, created.todoUrl].join("\n"),
      clientId: batch.client_id || client.id,
      assignee: assigneeSlug,
      dueDate: dueOn,
      source: "social_qa",
      listName: SOCIAL_QA_TODOLIST_NAME,
    });
  }

  return {
    ok: true,
    reviewerName: reviewer.name,
    todoId: created.todoId,
    todoUrl: created.todoUrl,
    status: "in_qa",
    dueOn,
  };
}

export async function signOffSocialBatch(input: {
  batchId: string;
  approvedBy: string;
  actorSlug: string;
  identity?: BcIdentity;
}): Promise<
  | { ok: true; batch: SocialBatch; warning?: string }
  | { ok: false; error: string; status: number }
> {
  const batch = getSocialBatch(input.batchId);
  if (!batch) return { ok: false, error: "Not found", status: 404 };
  if (batch.status === "approved") {
    return { ok: false, error: "This batch is already signed off.", status: 400 };
  }
  const name = input.approvedBy.trim();
  if (name.length < 2) {
    return { ok: false, error: "Type your name to sign this batch off.", status: 400 };
  }
  const openIssues = listSocialPosts(batch.id).filter((p) => p.issue_tag);
  if (openIssues.length) {
    return {
      ok: false,
      error: `Clear or fix ${openIssues.length} flagged ${openIssues.length === 1 ? "post" : "posts"} before signing off.`,
      status: 400,
    };
  }

  const ts = nowIso();
  let stepId = batch.signoff_step_id;
  let warning: string | undefined;
  const projectId = (batch.qa_project_id || "").trim();
  const todoId = (batch.qa_todo_id || "").trim();
  if (projectId && todoId) {
    const identity = input.identity ?? SERVICE;
    const stepTitle = `${name} has reviewed and approved this batch of social`.slice(0, 999);
    const created = await createTodoStep(projectId, todoId, stepTitle, identity);
    if (created.ok && created.id) {
      stepId = created.id;
      const completed = await completeTodoStep(projectId, created.id, "on", identity);
      if (!completed.ok) {
        warning = "Signed off here, but Basecamp did not check off the subtask.";
        recordFailure({
          kind: "basecamp_todo",
          subject: batch.client_name || batch.title,
          detail: completed.error || "complete step failed",
          hint: "Open the Social QA to-do in Basecamp and check the sign-off subtask.",
        });
      }
    } else {
      warning = "Signed off here, but Basecamp did not get the sign-off subtask.";
      recordFailure({
        kind: "basecamp_todo",
        subject: batch.client_name || batch.title,
        detail: created.error || "create step failed",
        hint: "The batch is approved in Campaign Desk; add the checked subtask on the Social QA to-do if needed.",
      });
    }
  }

  getDb()
    .prepare(
      `UPDATE social_batches
          SET status = 'approved', approved_at = ?, approved_by = ?, approved_by_slug = ?,
              signoff_step_id = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(ts, name, input.actorSlug, stepId, ts, batch.id);
  getDb()
    .prepare(
      `UPDATE social_posts
          SET signed_off_by = COALESCE(signed_off_by, ?),
              signed_off_at = COALESCE(signed_off_at, ?),
              qa_by = COALESCE(qa_by, ?),
              qa_at = COALESCE(qa_at, ?),
              updated_at = ?
        WHERE batch_id = ?`
    )
    .run(name, ts, input.actorSlug, ts, ts, batch.id);

  return { ok: true, batch: getSocialBatch(batch.id)!, warning };
}

export { INTERNAL_REVIEW_MESSAGE_MAX_CHARS };
