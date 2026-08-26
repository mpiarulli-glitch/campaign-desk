/**
 * Lifecycle hub: one row per email client, with contract pace, upcoming
 * sends, in-flight campaigns, and the launch checklist.
 *
 * Local SQLite only. LinkedIn / GHL sweeps stay on the old tools endpoint
 * so opening this page stays fast.
 */

import { getDb, nowIso } from "./db";
import {
  EMAIL_LAUNCH_LIST,
  EMAIL_LAUNCH_SOURCE,
  PACE_RANK,
  PIPELINE_LABEL,
  contractPace,
  daysInPeriod,
  isEmailPlatform,
  isYmd,
  previewLaunchTodos,
  type EmailPlatform,
  type PaceStatus,
} from "./email-launch";
import { addBoardCard, listBoardCards } from "./lifecycle-board";
import { currentPeriod, periodLabel } from "./period";
import { todayYmd } from "./cadence";
import { createTodo, listTodos, type TodoView } from "./todos";
import { getRevClient, listRevClients } from "./revenue";

export interface HubSend {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  assetType: string;
}

export interface HubCampaign {
  id: string;
  title: string;
  status: string;
  approvedChannel: string | null;
  updatedAt: string;
}

export interface HubLaunchTodo {
  id: string;
  title: string;
  dueDate: string | null;
  status: "open" | "done";
}

export interface HubClient {
  id: string;
  name: string;
  quota: number;
  delivered: number;
  remaining: number;
  pace: PaceStatus;
  paceLabel: string;
  pipeline: string;
  pipelineLabel: string;
  launchDate: string | null;
  platform: EmailPlatform | null;
  nextSend: HubSend | null;
  sends: HubSend[];
  campaigns: HubCampaign[];
  launch: {
    started: boolean;
    open: number;
    total: number;
    todos: HubLaunchTodo[];
  };
}

export interface LifecycleHub {
  period: string;
  periodLabel: string;
  today: string;
  counts: {
    total: number;
    behind: number;
    onTrack: number;
    met: number;
    launching: number;
  };
  clients: HubClient[];
  available: Array<{ id: string; name: string }>;
}

function monthWindow(period: string, today: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const endMonth = m === 12 ? 1 : m + 1;
  const endYear = m === 12 ? y + 1 : y;
  const endPeriod = `${endYear}-${String(endMonth).padStart(2, "0")}`;
  const end = `${endPeriod}-${String(daysInPeriod(endPeriod)).padStart(2, "0")}`;
  return { start: today, end };
}

function launchMetaByClient(
  clientIds: string[]
): Map<string, { launchDate: string | null; platform: EmailPlatform | null }> {
  const map = new Map<string, { launchDate: string | null; platform: EmailPlatform | null }>();
  if (!clientIds.length) return map;
  const rows = getDb()
    .prepare(
      `SELECT id, lifecycle_launch_date, lifecycle_email_platform FROM rev_clients
        WHERE id IN (${clientIds.map(() => "?").join(",")})`
    )
    .all(...clientIds) as Array<{
    id: string;
    lifecycle_launch_date: string | null;
    lifecycle_email_platform: string;
  }>;
  for (const r of rows) {
    map.set(r.id, {
      launchDate: r.lifecycle_launch_date || null,
      platform: isEmailPlatform(r.lifecycle_email_platform) ? r.lifecycle_email_platform : null,
    });
  }
  return map;
}

function setLifecycleLaunch(
  clientId: string,
  launchDate: string,
  platform?: EmailPlatform | null
): void {
  if (platform) {
    getDb()
      .prepare(
        `UPDATE rev_clients
            SET lifecycle_launch_date = ?, lifecycle_email_platform = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(launchDate, platform, nowIso(), clientId);
    return;
  }
  getDb()
    .prepare(`UPDATE rev_clients SET lifecycle_launch_date = ?, updated_at = ? WHERE id = ?`)
    .run(launchDate, nowIso(), clientId);
}

export function setClientEmailPlatform(clientId: string, platform: EmailPlatform): boolean {
  if (!getRevClient(clientId)) return false;
  getDb()
    .prepare(`UPDATE rev_clients SET lifecycle_email_platform = ?, updated_at = ? WHERE id = ?`)
    .run(platform, nowIso(), clientId);
  return true;
}

function sortKey(client: HubClient): number {
  if (client.pace === "behind") return 0;
  if (client.launch.open > 0) return 1;
  return PACE_RANK[client.pace] + 2;
}

function groupByClient<T extends { clientId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.clientId) ?? [];
    list.push(row);
    map.set(row.clientId, list);
  }
  return map;
}

function launchTodosByClient(clientIds: string[]): Map<string, HubLaunchTodo[]> {
  if (!clientIds.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT id, client_id, title, due_date, status FROM todos
        WHERE source = ? AND client_id IN (${clientIds.map(() => "?").join(",")})
        ORDER BY (due_date IS NULL) ASC, due_date ASC, created_at ASC`
    )
    .all(EMAIL_LAUNCH_SOURCE, ...clientIds) as Array<{
    id: string;
    client_id: string | null;
    title: string;
    due_date: string | null;
    status: string;
  }>;
  return groupByClient(
    rows
      .filter((r): r is typeof r & { client_id: string } => Boolean(r.client_id))
      .map((r) => ({
        clientId: r.client_id,
        id: r.id,
        title: r.title,
        dueDate: r.due_date,
        status: r.status === "done" ? ("done" as const) : ("open" as const),
      }))
  );
}

function sendsByClient(clientIds: string[], start: string, end: string): Map<string, HubSend[]> {
  if (!clientIds.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT id, client_id, title, send_date, send_time, status, asset_type
         FROM scheduled_sends
        WHERE client_id IN (${clientIds.map(() => "?").join(",")})
          AND send_date >= ? AND send_date <= ?
          AND cancelled_at IS NULL
          AND requested_by_client = 0
          AND (asset_type = '' OR asset_type IN ('email_campaign', 'crm_automation'))
        ORDER BY send_date ASC, send_time ASC, created_at ASC`
    )
    .all(...clientIds, start, end) as Array<{
    id: string;
    client_id: string;
    title: string;
    send_date: string;
    send_time: string;
    status: string;
    asset_type: string;
  }>;
  return groupByClient(
    rows.map((r) => ({
      clientId: r.client_id,
      id: r.id,
      title: r.title,
      date: r.send_date,
      time: r.send_time || "",
      status: r.status,
      assetType: r.asset_type || "",
    }))
  );
}

function campaignsByClient(clientIds: string[]): Map<string, HubCampaign[]> {
  if (!clientIds.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.client_id, c.title, c.status, c.approved_channel, c.updated_at
         FROM campaigns c
        WHERE c.client_id IN (${clientIds.map(() => "?").join(",")})
          AND c.archived_at IS NULL
          AND c.status != 'sent'
          AND EXISTS (
            SELECT 1 FROM campaign_emails e
             WHERE e.campaign_id = c.id AND e.kind IN ('email', 'sms')
          )
        ORDER BY c.updated_at DESC`
    )
    .all(...clientIds) as Array<{
    id: string;
    client_id: string;
    title: string;
    status: string;
    approved_channel: string | null;
    updated_at: string;
  }>;
  const grouped = groupByClient(
    rows.map((r) => ({
      clientId: r.client_id,
      id: r.id,
      title: r.title,
      status: r.status,
      approvedChannel: r.approved_channel,
      updatedAt: r.updated_at,
    }))
  );
  for (const [id, list] of grouped) grouped.set(id, list.slice(0, 12));
  return grouped;
}

function toHubClient(
  card: ReturnType<typeof listBoardCards>[number],
  today: string,
  period: string,
  sends: HubSend[],
  campaigns: HubCampaign[],
  launch: HubLaunchTodo[],
  launchDate: string | null,
  platform: EmailPlatform | null
): HubClient {
  const dayOfMonth = Number(today.slice(8, 10));
  const pace = contractPace(card.quota, card.delivered, dayOfMonth, daysInPeriod(period));
  const upcoming = sends.filter((s) => s.status !== "sent");
  return {
    id: card.clientId,
    name: card.clientName,
    quota: card.quota,
    delivered: card.delivered,
    remaining: pace.remaining,
    pace: pace.status,
    paceLabel: pace.label,
    pipeline: card.columnKey,
    pipelineLabel: PIPELINE_LABEL[card.columnKey] || card.columnKey,
    launchDate,
    platform,
    nextSend: upcoming[0] || null,
    sends,
    campaigns,
    launch: {
      started: launch.length > 0,
      open: launch.filter((t) => t.status === "open").length,
      total: launch.length,
      todos: launch,
    },
  };
}

export function buildLifecycleHub(now = new Date()): LifecycleHub {
  const period = currentPeriod(now);
  const today = todayYmd();
  const cards = listBoardCards(period);
  const { start, end } = monthWindow(period, today);
  const clientIds = cards.map((c) => c.clientId);
  const sends = sendsByClient(clientIds, start, end);
  const campaigns = campaignsByClient(clientIds);
  const launch = launchTodosByClient(clientIds);
  const meta = launchMetaByClient(clientIds);
  const onBoard = new Set(clientIds);
  const available = listRevClients(false)
    .filter((c) => c.active === 1 && !onBoard.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  const clients = cards
    .map((card) =>
      toHubClient(
        card,
        today,
        period,
        sends.get(card.clientId) ?? [],
        campaigns.get(card.clientId) ?? [],
        launch.get(card.clientId) ?? [],
        meta.get(card.clientId)?.launchDate ?? null,
        meta.get(card.clientId)?.platform ?? null
      )
    )
    .sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name));

  return {
    period,
    periodLabel: periodLabel(period),
    today,
    counts: {
      total: clients.length,
      behind: clients.filter((c) => c.pace === "behind").length,
      onTrack: clients.filter((c) => c.pace === "on_track").length,
      met: clients.filter((c) => c.pace === "met").length,
      launching: clients.filter((c) => c.launch.open > 0).length,
    },
    clients,
    available,
  };
}

export interface LaunchResult {
  created: number;
  skipped: boolean;
  reason?: string;
  todos: TodoView[];
}

export function createLaunchTodos(
  clientId: string,
  launchDate: string,
  createdBy = "michael",
  platform?: EmailPlatform | null
): LaunchResult {
  const client = getRevClient(clientId);
  if (!client) {
    return { created: 0, skipped: true, reason: "Unknown client.", todos: [] };
  }
  if (!isYmd(launchDate)) {
    return { created: 0, skipped: true, reason: "Pick a launch date.", todos: [] };
  }
  const resolved = isEmailPlatform(platform)
    ? platform
    : isEmailPlatform(client.lifecycle_email_platform)
      ? client.lifecycle_email_platform
      : null;
  if (!resolved) {
    return { created: 0, skipped: true, reason: "Pick a platform.", todos: [] };
  }
  setLifecycleLaunch(clientId, launchDate, resolved);
  const existing = listTodos({ clientId }).filter((t) => t.source === EMAIL_LAUNCH_SOURCE);
  if (existing.length) {
    return {
      created: 0,
      skipped: true,
      reason: "A launch checklist already exists for this client.",
      todos: existing,
    };
  }
  const preview = previewLaunchTodos(launchDate);
  const todos = getDb().transaction(() =>
    preview.map((item) =>
      createTodo({
        title: item.title,
        clientId,
        assignee: "michael",
        dueDate: item.dueDate,
        priority: "important",
        source: EMAIL_LAUNCH_SOURCE,
        listName: EMAIL_LAUNCH_LIST,
        createdBy,
      })
    )
  )();
  return { created: todos.length, skipped: false, todos };
}

export function addClientToHub(
  clientId: string,
  launchDate: string,
  createdBy = "michael",
  period?: string,
  platform?: EmailPlatform | null
): { ok: true } | { ok: false; error: string } {
  if (!getRevClient(clientId)) return { ok: false, error: "Unknown client." };
  if (!isYmd(launchDate)) return { ok: false, error: "Pick a launch date." };
  if (!isEmailPlatform(platform)) return { ok: false, error: "Pick a platform." };
  if (!addBoardCard(clientId, period || currentPeriod())) {
    return { ok: false, error: "Could not add that client." };
  }
  createLaunchTodos(clientId, launchDate, createdBy, platform);
  return { ok: true };
}
