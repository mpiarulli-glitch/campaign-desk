// The Email Board reads designs Campaign Desk already has. It does not call
// Klaviyo, GoHighLevel, or Basecamp, and it never sends.
//
// A frame is one campaign_emails row (or a yes/no gate from campaign_flow_steps).
// The HTML, image, or link on that row is the preview. Subject lines come from
// email_subjects. Send order for a flow comes from the automation map; a
// package uses scheduled_send_at, then sort_order. Saved x/y live in
// email_board_positions and never write back to the campaign.

import { nanoid } from "nanoid";
import {
  atLabel,
  buildAutomationTree,
  type AutomationEmail,
  type FlowStepRecord,
  type FlowTreeNode,
} from "./automation-map";
import { getDb, nowIso, type CampaignEmail, type EmailSubject } from "./db";
import {
  classifyEmailDesign,
  emailBoardBucket,
  isNoteColor,
  kindLabelFor,
  placeOnBoard,
  type BoardPlaceItem,
  type EmailBoardClient,
  type EmailBoardFrame,
  type EmailBoardGroup,
  type EmailBoardNote,
  type EmailBoardPayload,
} from "./email-board-model";
import { APP_TIME_ZONE } from "./period";

type Result<T> = { status: number; body: T };

type ClientRow = { id: string; name: string };

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  approved_channel: string | null;
  presentation: "package" | "automation";
  trigger_label: string;
  magic_token: string;
  logged_off_app: number;
  updated_at: string;
};

type Slot = BoardPlaceItem & {
  lane: "" | "yes" | "no";
  atMs: number | null;
  conditionLabel: string;
  emailId: string | null;
};

const NOTE_BODY_MAX = 2000;
const COORD_MAX = 200_000;

export function shortPacificDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(d);
}

function listBoardClients(): EmailBoardClient[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name,
              (
                SELECT COUNT(*)
                  FROM campaign_emails e
                  JOIN campaigns k ON k.id = e.campaign_id
                 WHERE k.archived_at IS NULL
                   AND (
                     k.client_id = c.id
                     OR (
                       (k.client_id IS NULL OR k.client_id = '')
                       AND lower(trim(k.client_name)) = lower(trim(c.name))
                     )
                   )
              ) AS frames
         FROM rev_clients c
        WHERE c.active = 1
           OR EXISTS (
             SELECT 1 FROM campaigns k
              WHERE k.archived_at IS NULL AND k.client_id = c.id
           )
        ORDER BY c.name COLLATE NOCASE ASC`
    )
    .all() as { id: string; name: string; frames: number }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    frames: Number(row.frames) || 0,
  }));
}

function getClient(id: string): ClientRow | null {
  if (!id || id.length > 80) return null;
  const row = getDb()
    .prepare(`SELECT id, name FROM rev_clients WHERE id = ?`)
    .get(id) as ClientRow | undefined;
  return row || null;
}

function campaignsForClient(client: ClientRow): CampaignRow[] {
  return getDb()
    .prepare(
      `SELECT id, title, status, approved_channel, presentation, trigger_label,
              magic_token, logged_off_app, updated_at
         FROM campaigns
        WHERE archived_at IS NULL
          AND (
            client_id = ?
            OR (
              (client_id IS NULL OR client_id = '')
              AND lower(trim(client_name)) = lower(trim(?))
            )
          )
        ORDER BY updated_at DESC, title COLLATE NOCASE ASC`
    )
    .all(client.id, client.name) as CampaignRow[];
}

function rowsFor<T>(sql: string, ids: string[]): T[] {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  return getDb().prepare(sql.replace("IN (?)", `IN (${marks})`)).all(...ids) as T[];
}

function subjectLine(
  email: CampaignEmail,
  subjects: EmailSubject[]
): { subject: string; previewText: string } {
  const chosen =
    email.chosen_subject_id &&
    subjects.find((row) => row.id === email.chosen_subject_id);
  const row =
    chosen ||
    subjects.find((item) => item.subject.trim()) ||
    subjects[0] ||
    null;
  return {
    subject: row?.subject.trim() || "",
    previewText: row?.preview_text.trim() || "",
  };
}

function walkFlow(
  nodes: FlowTreeNode[],
  col: number,
  row: number,
  lane: "" | "yes" | "no"
): { slots: Slot[]; endCol: number; endRow: number; used: boolean } {
  let cursor = col;
  let deepest = row;
  const slots: Slot[] = [];
  let used = false;
  for (const node of nodes) {
    if (node.type === "wait") continue;
    if (node.type === "email") {
      if (!node.emailId) continue;
      slots.push({
        key: node.emailId,
        kind: "email",
        col: cursor,
        row,
        lane,
        atMs: node.atMs,
        conditionLabel: "",
        emailId: node.emailId,
      });
      cursor += 1;
      deepest = Math.max(deepest, row);
      used = true;
      continue;
    }
    slots.push({
      key: `step:${node.id}`,
      kind: "condition",
      col: cursor,
      row,
      lane,
      atMs: node.atMs,
      conditionLabel: node.label,
      emailId: null,
    });
    const yes = walkFlow(node.yes, cursor + 1, row, "yes");
    const noRow = yes.used ? yes.endRow + 1 : row;
    const no = walkFlow(node.no, cursor + 1, noRow, "no");
    slots.push(...yes.slots, ...no.slots);
    cursor = Math.max(
      cursor + 1,
      yes.used ? yes.endCol : cursor + 1,
      no.used ? no.endCol : cursor + 1
    );
    deepest = Math.max(
      deepest,
      row,
      yes.used ? yes.endRow : row,
      no.used ? no.endRow : row
    );
    used = true;
  }
  return {
    slots,
    endCol: used ? cursor : col,
    endRow: used ? deepest : row - 1,
    used,
  };
}

function uniqueSlots(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const slot of slots) {
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    out.push(slot);
  }
  return out;
}

function packageSlots(emails: CampaignEmail[]): Slot[] {
  const sorted = [...emails].sort((a, b) => {
    const as = a.scheduled_send_at || "";
    const bs = b.scheduled_send_at || "";
    if (as && bs && as !== bs) return as < bs ? -1 : 1;
    if (as && !bs) return -1;
    if (!as && bs) return 1;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
  return uniqueSlots(sorted.map((email, index) => ({
    key: email.id,
    kind: "email" as const,
    col: index,
    row: 0,
    lane: "" as const,
    atMs: null,
    conditionLabel: "",
    emailId: email.id,
  })));
}

function flowSlots(
  emails: CampaignEmail[],
  steps: FlowStepRecord[]
): Slot[] {
  const tree = buildAutomationTree({
    emails: emails.map(
      (email): AutomationEmail => ({
        id: email.id,
        title: email.title,
        kind: email.kind,
        delay_ms: email.delay_ms,
      })
    ),
    steps,
  });
  const walked = walkFlow(tree.nodes, 0, 0, "");
  const seen = new Set(
    walked.slots.map((slot) => slot.emailId).filter((id): id is string => Boolean(id))
  );
  let col = walked.slots.reduce((max, slot) => Math.max(max, slot.col), -1) + 1;
  const extra: Slot[] = [];
  for (const email of emails) {
    if (seen.has(email.id)) continue;
    extra.push({
      key: email.id,
      kind: "email",
      col,
      row: 0,
      lane: "",
      atMs: null,
      conditionLabel: "",
      emailId: email.id,
    });
    col += 1;
  }
  return uniqueSlots([...walked.slots, ...extra]);
}

function sendLabelFor(
  email: CampaignEmail | null,
  slot: Slot,
  presentation: string,
  emailIndex: number
): string {
  if (email?.scheduled_send_at) {
    const day = shortPacificDay(email.scheduled_send_at);
    if (day) return day;
  }
  if (presentation === "automation" && slot.atMs != null) return atLabel(slot.atMs);
  return `Email ${emailIndex}`;
}

function laneLabel(lane: Slot["lane"]): string {
  if (lane === "yes") return "Yes";
  if (lane === "no") return "No";
  return "";
}

function buildClientBoard(client: ClientRow): {
  groups: EmailBoardGroup[];
  frames: EmailBoardFrame[];
  notes: EmailBoardNote[];
} {
  const campaigns = campaignsForClient(client).sort((a, b) => {
    const rank = (row: CampaignRow) => {
      if (row.presentation === "automation") return 0;
      if (row.logged_off_app) return 2;
      return 1;
    };
    const diff = rank(a) - rank(b);
    if (diff) return diff;
    return a.updated_at < b.updated_at ? 1 : -1;
  });
  const ids = campaigns.map((row) => row.id);
  const emails = rowsFor<CampaignEmail>(
    `SELECT * FROM campaign_emails WHERE campaign_id IN (?) ORDER BY sort_order ASC, created_at ASC`,
    ids
  );
  const subjects = rowsFor<EmailSubject>(
    `SELECT * FROM email_subjects WHERE campaign_id IN (?) ORDER BY sort_order ASC, created_at ASC`,
    ids
  );
  const steps = rowsFor<FlowStepRecord>(
    `SELECT id, campaign_id, parent_id, branch, sort_order, step_type, delay_ms,
            email_id, condition_kind, condition_label
       FROM campaign_flow_steps WHERE campaign_id IN (?)`,
    ids
  );
  const saved = new Map<string, { x: number; y: number }>();
  for (const row of getDb()
    .prepare(
      `SELECT frame_key, x, y FROM email_board_positions WHERE client_id = ?`
    )
    .all(client.id) as { frame_key: string; x: number; y: number }[]) {
    saved.set(row.frame_key, { x: row.x, y: row.y });
  }

  const emailsByCampaign = new Map<string, CampaignEmail[]>();
  for (const email of emails) {
    const list = emailsByCampaign.get(email.campaign_id) || [];
    list.push(email);
    emailsByCampaign.set(email.campaign_id, list);
  }
  const subjectsByEmail = new Map<string, EmailSubject[]>();
  for (const subject of subjects) {
    const list = subjectsByEmail.get(subject.email_id) || [];
    list.push(subject);
    subjectsByEmail.set(subject.email_id, list);
  }
  const stepsByCampaign = new Map<string, FlowStepRecord[]>();
  for (const step of steps) {
    const id = step.campaign_id || "";
    const list = stepsByCampaign.get(id) || [];
    list.push(step);
    stepsByCampaign.set(id, list);
  }

  const placeGroups: { id: string; items: BoardPlaceItem[] }[] = [];
  const slotsByCampaign = new Map<string, Slot[]>();
  for (const campaign of campaigns) {
    const list = emailsByCampaign.get(campaign.id) || [];
    const slots =
      campaign.presentation === "automation"
        ? flowSlots(list, stepsByCampaign.get(campaign.id) || [])
        : packageSlots(list);
    if (!slots.length) {
      slots.push({
        key: `campaign:${campaign.id}`,
        kind: "email",
        col: 0,
        row: 0,
        lane: "",
        atMs: null,
        conditionLabel: "",
        emailId: null,
      });
    }
    slotsByCampaign.set(campaign.id, slots);
    placeGroups.push({
      id: campaign.id,
      items: slots.map((slot) => ({
        key: slot.key,
        kind: slot.kind,
        col: slot.col,
        row: slot.row,
      })),
    });
  }
  const placed = placeOnBoard(placeGroups);

  const groups: EmailBoardGroup[] = [];
  const frames: EmailBoardFrame[] = [];
  for (const campaign of campaigns) {
    const slots = slotsByCampaign.get(campaign.id) || [];
    const emailList = emailsByCampaign.get(campaign.id) || [];
    const byId = new Map(emailList.map((email) => [email.id, email]));
    const bucket = emailBoardBucket(campaign.status, campaign.approved_channel);
    let emailIndex = 0;
    for (const slot of slots) {
      const spot = placed.get(slot.key);
      if (!spot) continue;
      const savedSpot = saved.get(slot.key);
      const email = slot.emailId ? byId.get(slot.emailId) || null : null;
      if (slot.kind === "email") emailIndex += 1;
      const design = email
        ? classifyEmailDesign({
            kind: email.kind,
            bodyFormat: email.body_format,
            html: email.html_content,
            htmlB: email.html_content_b,
            mediaUrl: email.media_url,
            loggedOff: campaign.logged_off_app === 1,
          })
        : {
            render: "empty" as const,
            previewHtml: "",
            previewHtmlB: "",
            text: "",
            mediaUrl: null,
            linkUrl: null,
            plain: "No design stored yet.",
            emptyReason: "blank" as const,
            hasVariantB: false,
          };
      const lines = email
        ? subjectLine(email, subjectsByEmail.get(email.id) || [])
        : { subject: "", previewText: "" };
      const render = slot.kind === "condition" ? "condition" : design.render;
      frames.push({
        key: slot.key,
        groupId: campaign.id,
        groupTitle: campaign.title,
        presentation: campaign.presentation === "automation" ? "automation" : "package",
        render,
        title:
          slot.kind === "condition"
            ? slot.conditionLabel || "Split"
            : email?.title || campaign.title,
        subject: lines.subject,
        previewText: lines.previewText,
        status: campaign.status,
        approvedChannel: campaign.approved_channel,
        bucket,
        kind: email?.kind || (slot.kind === "condition" ? "condition" : "email"),
        kindLabel:
          slot.kind === "condition" ? "Split" : kindLabelFor(email?.kind || "email"),
        sendLabel:
          slot.kind === "condition"
            ? "If / else"
            : sendLabelFor(email, slot, campaign.presentation, emailIndex),
        laneLabel: laneLabel(slot.lane),
        col: slot.col,
        row: slot.row,
        x: savedSpot ? savedSpot.x : spot.x,
        y: savedSpot ? savedSpot.y : spot.y,
        w: spot.w,
        h: spot.h,
        defaultX: spot.x,
        defaultY: spot.y,
        placed: Boolean(savedSpot),
        previewHtml: render === "html" ? design.previewHtml : "",
        previewHtmlB: render === "html" ? design.previewHtmlB : "",
        text: design.text,
        mediaUrl: design.mediaUrl,
        linkUrl: design.linkUrl,
        plain: slot.kind === "condition" ? slot.conditionLabel : design.plain,
        emptyReason: render === "empty" ? design.emptyReason : "",
        campaignHref: `/admin/campaigns/${campaign.id}`,
        reviewHref: campaign.magic_token ? `/review/${campaign.magic_token}` : "",
        hasVariantB: design.hasVariantB,
        loggedOff: campaign.logged_off_app === 1,
      });
    }
    groups.push({
      id: campaign.id,
      title: campaign.title,
      presentation: campaign.presentation === "automation" ? "automation" : "package",
      bucket,
      status: campaign.status,
      approvedChannel: campaign.approved_channel,
      triggerLabel: (campaign.trigger_label || "").trim(),
      frameCount: slots.filter((slot) => slot.kind === "email").length,
    });
  }

  const notes = (
    getDb()
      .prepare(
        `SELECT id, body, color, x, y, author, updated_at
           FROM email_board_notes
          WHERE client_id = ?
          ORDER BY created_at ASC`
      )
      .all(client.id) as {
      id: string;
      body: string;
      color: string;
      x: number;
      y: number;
      author: string;
      updated_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    body: row.body,
    color: isNoteColor(row.color) ? row.color : "yellow",
    x: row.x,
    y: row.y,
    author: row.author,
    updatedAt: row.updated_at,
  }));

  return { groups, frames, notes };
}

export function getEmailBoard(
  clientId: string | null
): Result<EmailBoardPayload> {
  const clients = listBoardClients();
  const requested = (clientId || "").trim();
  let client = requested ? getClient(requested) : null;
  if (!requested) {
    client =
      clients.find((row) => row.frames > 0) ||
      clients[0] ||
      null;
    if (client) client = getClient(client.id);
  }
  if (!client) {
    return {
      status: 200,
      body: {
        clients,
        client: null,
        missing: Boolean(requested),
        groups: [],
        frames: [],
        notes: [],
      },
    };
  }
  const board = buildClientBoard(client);
  return {
    status: 200,
    body: {
      clients,
      client: { id: client.id, name: client.name },
      missing: false,
      groups: board.groups,
      frames: board.frames,
      notes: board.notes,
    },
  };
}

type PositionInput = { frameKey: string; x: number; y: number };

function parsePositions(value: unknown): PositionInput[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 400) return null;
  const rows: PositionInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const frameKey =
      typeof (raw as { frameKey?: unknown }).frameKey === "string"
        ? (raw as { frameKey: string }).frameKey.trim()
        : "";
    const x = Number((raw as { x?: unknown }).x);
    const y = Number((raw as { y?: unknown }).y);
    if (!frameKey || frameKey.length > 80) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > COORD_MAX || Math.abs(y) > COORD_MAX) return null;
    rows.push({ frameKey, x, y });
  }
  return rows;
}

export function saveEmailBoardLayout(
  clientId: string,
  positions: unknown
): Result<{ ok: true; saved: number } | { error: string }> {
  const client = getClient((clientId || "").trim());
  if (!client) return { status: 404, body: { error: "Client not found" } };
  const rows = parsePositions(positions);
  if (!rows) return { status: 400, body: { error: "Invalid positions" } };
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO email_board_positions (client_id, frame_key, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id, frame_key) DO UPDATE SET
       x = excluded.x,
       y = excluded.y,
       updated_at = excluded.updated_at`
  );
  const ts = nowIso();
  const run = db.transaction(() => {
    for (const row of rows) stmt.run(client.id, row.frameKey, row.x, row.y, ts);
  });
  run();
  return { status: 200, body: { ok: true, saved: rows.length } };
}

export function clearEmailBoardLayout(
  clientId: string
): Result<{ ok: true } | { error: string }> {
  const client = getClient((clientId || "").trim());
  if (!client) return { status: 404, body: { error: "Client not found" } };
  getDb()
    .prepare(`DELETE FROM email_board_positions WHERE client_id = ?`)
    .run(client.id);
  return { status: 200, body: { ok: true } };
}

function noteFromRow(row: {
  id: string;
  body: string;
  color: string;
  x: number;
  y: number;
  author: string;
  updated_at: string;
}): EmailBoardNote {
  return {
    id: row.id,
    body: row.body,
    color: isNoteColor(row.color) ? row.color : "yellow",
    x: row.x,
    y: row.y,
    author: row.author,
    updatedAt: row.updated_at,
  };
}

function readNote(id: string): EmailBoardNote | null {
  const row = getDb()
    .prepare(
      `SELECT id, body, color, x, y, author, updated_at
         FROM email_board_notes WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        body: string;
        color: string;
        x: number;
        y: number;
        author: string;
        updated_at: string;
      }
    | undefined;
  return row ? noteFromRow(row) : null;
}

function finiteCoord(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > COORD_MAX) return null;
  return n;
}

export function createEmailBoardNote(input: {
  clientId: string;
  x: unknown;
  y: unknown;
  body: unknown;
  color: unknown;
  author: string;
}): Result<{ note: EmailBoardNote } | { error: string }> {
  const client = getClient((input.clientId || "").trim());
  if (!client) return { status: 404, body: { error: "Client not found" } };
  const x = finiteCoord(input.x);
  const y = finiteCoord(input.y);
  if (x == null || y == null) return { status: 400, body: { error: "Invalid position" } };
  const body = typeof input.body === "string" ? input.body.slice(0, NOTE_BODY_MAX) : "";
  const color = isNoteColor(input.color) ? input.color : "yellow";
  const id = nanoid(12);
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO email_board_notes
         (id, client_id, body, color, x, y, author, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, client.id, body, color, x, y, (input.author || "").slice(0, 80), ts, ts);
  const note = readNote(id);
  if (!note) return { status: 500, body: { error: "Could not save the note" } };
  return { status: 200, body: { note } };
}

export function updateEmailBoardNote(
  id: string,
  input: { body?: unknown; color?: unknown; x?: unknown; y?: unknown }
): Result<{ note: EmailBoardNote } | { error: string }> {
  const existing = readNote((id || "").trim());
  if (!existing) return { status: 404, body: { error: "Note not found" } };
  const body =
    typeof input.body === "string" ? input.body.slice(0, NOTE_BODY_MAX) : existing.body;
  const color = input.color === undefined ? existing.color : isNoteColor(input.color) ? input.color : existing.color;
  let x = existing.x;
  let y = existing.y;
  if (input.x !== undefined || input.y !== undefined) {
    const nextX = finiteCoord(input.x === undefined ? existing.x : input.x);
    const nextY = finiteCoord(input.y === undefined ? existing.y : input.y);
    if (nextX == null || nextY == null) {
      return { status: 400, body: { error: "Invalid position" } };
    }
    x = nextX;
    y = nextY;
  }
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE email_board_notes
          SET body = ?, color = ?, x = ?, y = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(body, color, x, y, ts, existing.id);
  const note = readNote(existing.id);
  if (!note) return { status: 404, body: { error: "Note not found" } };
  return { status: 200, body: { note } };
}

export function deleteEmailBoardNote(
  id: string
): Result<{ ok: true } | { error: string }> {
  const existing = readNote((id || "").trim());
  if (!existing) return { status: 404, body: { error: "Note not found" } };
  getDb().prepare(`DELETE FROM email_board_notes WHERE id = ?`).run(existing.id);
  return { status: 200, body: { ok: true } };
}

