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
  calendarSendIsAutomation,
  campaignCountsTowardQuota,
  campaignReachedClient,
  contractPace,
  daysInPeriod,
  isEmailPlatform,
  isYmd,
  previewLaunchTodos,
  sameLifecycleAccount,
  type EmailPlatform,
  type PaceStatus,
} from "./email-launch";
import { addBoardCard, listBoardCards } from "./lifecycle-board";
import { currentPeriod, periodLabel } from "./period";
import { todayYmd } from "./cadence";
import { createTodo, listTodos, type TodoView } from "./todos";
import { getRevClient, listRevClients } from "./revenue";

export type HubWorkKind = "campaign" | "automation";

export interface HubSend {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  assetType: string;
  kind: HubWorkKind;
}

export interface HubCampaign {
  id: string;
  title: string;
  status: string;
  approvedChannel: string | null;
  updatedAt: string;
  createdAt: string;
  presentation: string;
  emailCount: number;
  kind: HubWorkKind;
  countsTowardQuota: boolean;
  /** True once this campaign's emails count against the monthly contract. */
  delivered: boolean;
}

export interface HubActivity {
  id: string;
  source: "calendar" | "campaign";
  kind: HubWorkKind;
  title: string;
  date: string | null;
  status: string;
  countsTowardQuota: boolean;
  delivered: boolean;
  href: string | null;
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
  activity: HubActivity[];
  memberIds: string[];
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

function monthWindow(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const endMonth = m === 12 ? 1 : m + 1;
  const endYear = m === 12 ? y + 1 : y;
  const endPeriod = `${endYear}-${String(endMonth).padStart(2, "0")}`;
  const end = `${endPeriod}-${String(daysInPeriod(endPeriod)).padStart(2, "0")}`;
  return { start: `${period}-01`, end };
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function ymdFromIso(iso: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : null;
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

function sendsByClient(
  clientIds: string[],
  idToName: Map<string, string>,
  start: string,
  end: string
): Map<string, HubSend[]> {
  if (!clientIds.length) return new Map();
  const nameKeys = [
    ...new Set([...idToName.values()].map((n) => n.trim().toLowerCase()).filter(Boolean)),
  ];
  const nameClause = nameKeys.length
    ? `OR lower(trim(client_name)) IN (${nameKeys.map(() => "?").join(",")})`
    : "";
  const rows = getDb()
    .prepare(
      `SELECT id, client_id, client_name, title, send_date, send_time, status, asset_type
         FROM scheduled_sends
        WHERE (client_id IN (${clientIds.map(() => "?").join(",")}) ${nameClause})
          AND send_date >= ? AND send_date <= ?
          AND cancelled_at IS NULL
          AND requested_by_client = 0
          AND (asset_type = '' OR asset_type IN ('email_campaign', 'crm_automation'))
        ORDER BY send_date ASC, send_time ASC, created_at ASC`
    )
    .all(...clientIds, ...nameKeys, start, end) as Array<{
    id: string;
    client_id: string | null;
    client_name: string;
    title: string;
    send_date: string;
    send_time: string;
    status: string;
    asset_type: string;
  }>;
  const idSet = new Set(clientIds);
  const map = new Map<string, HubSend[]>();
  const add = (clientId: string, send: HubSend) => {
    const list = map.get(clientId) ?? [];
    if (list.some((s) => s.id === send.id)) return;
    list.push(send);
    map.set(clientId, list);
  };
  for (const r of rows) {
    const automation = calendarSendIsAutomation(r.asset_type);
    const send: HubSend = {
      id: r.id,
      title: r.title,
      date: r.send_date,
      time: r.send_time || "",
      status: r.status,
      assetType: r.asset_type || "",
      kind: automation ? "automation" : "campaign",
    };
    if (r.client_id && idSet.has(r.client_id)) {
      add(r.client_id, send);
      continue;
    }
    for (const [id, name] of idToName) {
      if (sameLifecycleAccount(name, r.client_name || "")) add(id, send);
    }
  }
  return map;
}

function campaignsByClient(
  clientIds: string[],
  idToName: Map<string, string>,
  period: string
): Map<string, HubCampaign[]> {
  if (!clientIds.length) return new Map();
  const nameKeys = [
    ...new Set([...idToName.values()].map((n) => n.trim().toLowerCase()).filter(Boolean)),
  ];
  const nameClause = nameKeys.length
    ? `OR lower(trim(c.client_name)) IN (${nameKeys.map(() => "?").join(",")})`
    : "";
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.client_id, c.client_name, c.title, c.status, c.approved_channel,
              c.updated_at, c.created_at, c.presentation,
              (SELECT COUNT(*) FROM campaign_emails e
                WHERE e.campaign_id = c.id AND e.kind = 'email') AS email_count
         FROM campaigns c
        WHERE c.archived_at IS NULL
          AND (
            strftime('%Y-%m', c.created_at) = ?
            OR (c.status = 'sent' AND strftime('%Y-%m', c.updated_at) = ?)
          )
          AND (c.client_id IN (${clientIds.map(() => "?").join(",")}) ${nameClause})
          AND EXISTS (
            SELECT 1 FROM campaign_emails e
             WHERE e.campaign_id = c.id AND e.kind IN ('email', 'sms')
          )
        ORDER BY c.updated_at DESC`
    )
    .all(period, period, ...clientIds, ...nameKeys) as Array<{
    id: string;
    client_id: string | null;
    client_name: string;
    title: string;
    status: string;
    approved_channel: string | null;
    updated_at: string;
    created_at: string;
    presentation: string | null;
    email_count: number;
  }>;
  const idSet = new Set(clientIds);
  const map = new Map<string, HubCampaign[]>();
  const add = (clientId: string, campaign: HubCampaign) => {
    const list = map.get(clientId) ?? [];
    if (list.some((c) => c.id === campaign.id)) return;
    list.push(campaign);
    map.set(clientId, list);
  };
  for (const r of rows) {
    const counts = campaignCountsTowardQuota(r.presentation, r.title);
    const campaign: HubCampaign = {
      id: r.id,
      title: r.title,
      status: r.status,
      approvedChannel: r.approved_channel,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      presentation: r.presentation || "package",
      emailCount: r.email_count,
      kind: counts ? "campaign" : "automation",
      countsTowardQuota: counts,
      delivered: counts && campaignReachedClient(r.status, r.approved_channel),
    };
    if (r.client_id && idSet.has(r.client_id)) {
      add(r.client_id, campaign);
      continue;
    }
    for (const [id, name] of idToName) {
      if (sameLifecycleAccount(name, r.client_name || "")) add(id, campaign);
    }
  }
  return map;
}

type BoardCard = ReturnType<typeof listBoardCards>[number];

interface CardGroup {
  primary: BoardCard;
  displayName: string;
  memberIds: string[];
  memberNames: string[];
  campaigns: BoardCard["campaigns"];
  delivered: number;
  quota: number;
}

function groupBoardCards(cards: BoardCard[]): CardGroup[] {
  const groups: BoardCard[][] = [];
  for (const card of cards) {
    const existing = groups.find((g) =>
      g.some((c) => sameLifecycleAccount(c.clientName, card.clientName))
    );
    if (existing) existing.push(card);
    else groups.push([card]);
  }
  return groups.map((group) => {
    const primary = [...group].sort(
      (a, b) => b.campaigns.length - a.campaigns.length || b.clientName.length - a.clientName.length
    )[0];
    const displayName = [...group].sort((a, b) => a.clientName.length - b.clientName.length)[0]
      .clientName;
    const seen = new Set<string>();
    const campaigns: BoardCard["campaigns"] = [];
    for (const card of group) {
      for (const camp of card.campaigns) {
        if (seen.has(camp.id)) continue;
        seen.add(camp.id);
        campaigns.push(camp);
      }
    }
    return {
      primary: { ...primary, clientName: displayName, campaigns },
      displayName,
      memberIds: group.map((c) => c.clientId),
      memberNames: group.map((c) => c.clientName),
      campaigns,
      delivered: campaigns.reduce((n, c) => n + (c.delivered ? c.emailCount : 0), 0),
      quota: Math.max(...group.map((c) => c.quota)),
    };
  });
}

function collectForIds<T>(map: Map<string, T[]>, ids: string[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    for (const row of map.get(id) ?? []) {
      const key = (row as { id: string }).id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function buildActivity(sends: HubSend[], campaigns: HubCampaign[]): HubActivity[] {
  const calendarTitles = new Set(sends.map((s) => normalizeTitle(s.title)));
  const fromSends: HubActivity[] = sends.map((s) => ({
    id: `send:${s.id}`,
    source: "calendar",
    kind: s.kind,
    title: s.title,
    date: s.date,
    status: s.status,
    countsTowardQuota: false,
    delivered: false,
    href: "/admin/calendar",
  }));
  const fromCampaigns: HubActivity[] = campaigns
    .filter((c) => !calendarTitles.has(normalizeTitle(c.title)))
    .map((c) => ({
      id: `camp:${c.id}`,
      source: "campaign" as const,
      kind: c.kind,
      title: c.title,
      date: c.status === "sent" ? ymdFromIso(c.updatedAt) || ymdFromIso(c.createdAt) : null,
      status: c.status,
      countsTowardQuota: c.countsTowardQuota,
      delivered: c.delivered,
      href: `/admin/campaigns/${c.id}`,
    }));
  return [...fromSends, ...fromCampaigns].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });
}

function toHubClient(
  group: CardGroup,
  today: string,
  period: string,
  sends: HubSend[],
  campaigns: HubCampaign[],
  launch: HubLaunchTodo[],
  launchDate: string | null,
  platform: EmailPlatform | null
): HubClient {
  const dayOfMonth = Number(today.slice(8, 10));
  const pace = contractPace(group.quota, group.delivered, dayOfMonth, daysInPeriod(period));
  const upcoming = sends.filter((s) => s.status !== "sent" && s.date >= today);
  return {
    id: group.primary.clientId,
    name: group.displayName,
    quota: group.quota,
    delivered: group.delivered,
    remaining: pace.remaining,
    pace: pace.status,
    paceLabel: pace.label,
    pipeline: group.primary.columnKey,
    pipelineLabel: PIPELINE_LABEL[group.primary.columnKey] || group.primary.columnKey,
    launchDate,
    platform,
    nextSend: upcoming[0] || null,
    sends,
    campaigns,
    activity: buildActivity(sends, campaigns),
    memberIds: group.memberIds,
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
  const groups = groupBoardCards(listBoardCards(period));
  const { start, end } = monthWindow(period);
  const clientIds = groups.flatMap((g) => g.memberIds);
  const idToName = new Map<string, string>();
  for (const group of groups) {
    group.memberIds.forEach((id, i) => idToName.set(id, group.memberNames[i] || group.displayName));
  }
  const sends = sendsByClient(clientIds, idToName, start, end);
  const campaigns = campaignsByClient(clientIds, idToName, period);
  const launch = launchTodosByClient(clientIds);
  const meta = launchMetaByClient(clientIds);
  const onBoard = new Set(clientIds);
  const available = listRevClients(false)
    .filter((c) => c.active === 1 && !onBoard.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  const clients = groups
    .map((group) => {
      const launchDate =
        group.memberIds.map((id) => meta.get(id)?.launchDate).find(Boolean) ?? null;
      const platform =
        group.memberIds.map((id) => meta.get(id)?.platform).find(Boolean) ?? null;
      return toHubClient(
        group,
        today,
        period,
        collectForIds(sends, group.memberIds),
        collectForIds(campaigns, group.memberIds),
        collectForIds(launch, group.memberIds),
        launchDate,
        platform
      );
    })
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
