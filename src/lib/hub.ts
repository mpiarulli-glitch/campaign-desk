import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type HrIssue,
  type SentimentCheckin,
  type Sop,
  type TrainingPost,
} from "./db";

export type { Sop, TrainingPost, SentimentCheckin, HrIssue };

/* ------------------------------------------------------------- settings */

function getSetting(key: string): string {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value || "";
}
function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, nowIso());
}

// Editable external destinations for the Forecasts/docs/files section. The
// forecast link is internal so it isn't stored here.
const LINK_KEYS = ["hub_docs_url", "hub_files_url"] as const;
export type HubLinks = { docsUrl: string; filesUrl: string };

export function getHubLinks(): HubLinks {
  return { docsUrl: getSetting("hub_docs_url"), filesUrl: getSetting("hub_files_url") };
}
export function setHubLinks(links: Partial<HubLinks>): HubLinks {
  if (links.docsUrl !== undefined) setSetting("hub_docs_url", links.docsUrl.trim());
  if (links.filesUrl !== undefined) setSetting("hub_files_url", links.filesUrl.trim());
  return getHubLinks();
}
void LINK_KEYS;

/* ----------------------------------------------------------------- SOPs */

export function listSops(): Sop[] {
  return getDb()
    .prepare(`SELECT * FROM sops ORDER BY category ASC, sort_order ASC, title ASC`)
    .all() as Sop[];
}
export function createSop(input: { title: string; category?: string; body?: string; link?: string }): Sop {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO sops (id, title, category, body, link, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, input.title.trim(), (input.category || "").trim(), (input.body || "").trim(), (input.link || "").trim(), ts, ts);
  return db.prepare(`SELECT * FROM sops WHERE id = ?`).get(id) as Sop;
}
export function updateSop(id: string, u: Partial<{ title: string; category: string; body: string; link: string }>): Sop | null {
  const existing = getDb().prepare(`SELECT * FROM sops WHERE id = ?`).get(id) as Sop | undefined;
  if (!existing) return null;
  getDb()
    .prepare(`UPDATE sops SET title = ?, category = ?, body = ?, link = ?, updated_at = ? WHERE id = ?`)
    .run(
      u.title !== undefined ? u.title.trim() : existing.title,
      u.category !== undefined ? u.category.trim() : existing.category,
      u.body !== undefined ? u.body.trim() : existing.body,
      u.link !== undefined ? u.link.trim() : existing.link,
      nowIso(),
      id
    );
  return getDb().prepare(`SELECT * FROM sops WHERE id = ?`).get(id) as Sop;
}
export function deleteSop(id: string): boolean {
  return getDb().prepare(`DELETE FROM sops WHERE id = ?`).run(id).changes > 0;
}

/* ------------------------------------------------------------- training */

export function listTraining(): TrainingPost[] {
  return getDb()
    .prepare(`SELECT * FROM training_posts ORDER BY created_at DESC`)
    .all() as TrainingPost[];
}
export function createTraining(input: {
  title: string;
  kind?: string;
  body?: string;
  link?: string;
  createdBy?: string;
}): TrainingPost {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const kind = input.kind === "ai" ? "ai" : "marketing";
  db.prepare(
    `INSERT INTO training_posts (id, title, kind, body, link, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.title.trim(), kind, (input.body || "").trim(), (input.link || "").trim(), input.createdBy || "", ts, ts);
  return db.prepare(`SELECT * FROM training_posts WHERE id = ?`).get(id) as TrainingPost;
}
export function deleteTraining(id: string): boolean {
  return getDb().prepare(`DELETE FROM training_posts WHERE id = ?`).run(id).changes > 0;
}

/* ------------------------------------------------------------ sentiment */

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getMyCheckin(person: string, month: string): SentimentCheckin | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM sentiment_checkins WHERE person = ? AND month = ?`)
      .get(person, month) as SentimentCheckin | undefined) || null
  );
}

export function upsertCheckin(person: string, month: string, score: number, note: string): SentimentCheckin {
  const db = getDb();
  const ts = nowIso();
  const clamped = Math.max(1, Math.min(5, Math.round(score)));
  db.prepare(
    `INSERT INTO sentiment_checkins (id, person, month, score, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person, month) DO UPDATE SET score = excluded.score, note = excluded.note, updated_at = excluded.updated_at`
  ).run(nanoid(12), person, month, clamped, note.trim(), ts, ts);
  return getMyCheckin(person, month)!;
}

export function listCheckins(month: string): SentimentCheckin[] {
  return getDb()
    .prepare(`SELECT * FROM sentiment_checkins WHERE month = ? ORDER BY created_at ASC`)
    .all(month) as SentimentCheckin[];
}

/* ------------------------------------------------------------------- HR */

export function createHrIssue(input: {
  subject: string;
  body?: string;
  submittedBy?: string;
  anonymous?: boolean;
}): HrIssue {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO hr_issues (id, submitted_by, anonymous, subject, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(id, input.anonymous ? "" : input.submittedBy || "", input.anonymous ? 1 : 0, input.subject.trim(), (input.body || "").trim(), ts, ts);
  return db.prepare(`SELECT * FROM hr_issues WHERE id = ?`).get(id) as HrIssue;
}

export function listHrIssues(): HrIssue[] {
  return getDb().prepare(`SELECT * FROM hr_issues ORDER BY created_at DESC`).all() as HrIssue[];
}

export function setHrStatus(id: string, status: string): HrIssue | null {
  const valid = ["open", "acknowledged", "resolved"];
  if (!valid.includes(status)) return null;
  getDb().prepare(`UPDATE hr_issues SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
  return (getDb().prepare(`SELECT * FROM hr_issues WHERE id = ?`).get(id) as HrIssue | undefined) || null;
}
