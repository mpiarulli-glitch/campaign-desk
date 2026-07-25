import { nanoid } from "nanoid";
import { getDb, type RevClient, type ScheduledSend } from "./db";
import {
  computeCycleStatus,
  findSendForWindow,
  nextWindow,
  todayYmd,
  type CycleStatus,
  type Window,
} from "./cadence";
import { deliverableOverview, getOrCreateToken as getOrCreateSnapshotToken } from "./snapshot";
import { aggregate, getRevClient, kpisForModel, listMetrics } from "./revenue";
import { planSends } from "./plan";
import { listActivity, listPendingApprovalCampaigns, type ActivityItem, type PendingApproval } from "./campaigns";
import { listOkrs, type OkrStatus } from "./okrs";
import { listTodos } from "./todos";
import { teamLabel, avatarFor, slugForName } from "./team";

/* ------------------------------------------------------- share token */

export function getOrCreateDashboardToken(clientId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT dashboard_token FROM rev_clients WHERE id = ?`)
    .get(clientId) as { dashboard_token: string | null } | undefined;
  if (!row) return null;
  if (row.dashboard_token) return row.dashboard_token;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET dashboard_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function rotateDashboardToken(clientId: string): string | null {
  const db = getDb();
  const exists = db.prepare(`SELECT id FROM rev_clients WHERE id = ?`).get(clientId);
  if (!exists) return null;
  const token = nanoid(24);
  db.prepare(`UPDATE rev_clients SET dashboard_token = ? WHERE id = ?`).run(
    token,
    clientId
  );
  return token;
}

export function getClientByDashboardToken(token: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE dashboard_token = ?`)
      .get(token) as RevClient | undefined) || null
  );
}

/* --------------------------------------------------- production status */

export interface ProductionStatus {
  window: Window | null;
  status: CycleStatus;
  existingSend: { sendDate: string; status: string } | null;
}

export function productionStatus(client: RevClient): ProductionStatus {
  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  const existing = window ? findSendForWindow(client.id, window.start) : null;
  return {
    window,
    status,
    existingSend: existing ? { sendDate: existing.send_date, status: existing.status } : null,
  };
}

/* -------------------------------------------------------------- activity */

// One combined, time-sorted feed of everything that happened on an account:
// campaign feedback/approvals (via listActivity, now client_id-scoped),
// client notes left on the shared editorial calendar, and production booking
// events. Internal-only (OKRs) never flows through this function.
export interface AccountActivityItem {
  kind: "feedback" | "approved" | "calendar_note" | "production_booked" | "production_sent";
  at: string;
  summary: string;
  detail: string;
}

export function accountActivity(clientId: string, limit = 30): AccountActivityItem[] {
  const campaignItems: AccountActivityItem[] = listActivity(limit, clientId).map(
    (item: ActivityItem) => ({
      kind: item.kind,
      at: item.at,
      summary:
        item.kind === "approved"
          ? `${item.campaign_title} approved`
          : `${item.actor || "Someone"} commented on ${item.campaign_title}`,
      detail: item.kind === "approved" ? "" : item.body || "",
    })
  );

  const calendarNotes = getDb()
    .prepare(
      `SELECT cf.body, cf.updated_at, s.title
       FROM calendar_feedback cf
       JOIN scheduled_sends s ON s.id = cf.send_id
       WHERE cf.client_id = ?
       ORDER BY cf.updated_at DESC LIMIT ?`
    )
    .all(clientId, limit) as Array<{ body: string; updated_at: string; title: string }>;
  const calendarItems: AccountActivityItem[] = calendarNotes.map((n) => ({
    kind: "calendar_note",
    at: n.updated_at,
    summary: `Note left on "${n.title}"`,
    detail: n.body,
  }));

  const sends = getDb()
    .prepare(
      `SELECT title, send_date, status, updated_at FROM scheduled_sends
       WHERE client_id = ? AND status IN ('requested','sent')
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(clientId, limit) as Array<{
    title: string;
    send_date: string;
    status: string;
    updated_at: string;
  }>;
  const sendItems: AccountActivityItem[] = sends.map((s) => ({
    kind: s.status === "sent" ? "production_sent" : "production_booked",
    at: s.updated_at,
    summary:
      s.status === "sent"
        ? `"${s.title}" sent`
        : `Production requested for ${s.send_date}`,
    detail: s.title,
  }));

  return [...campaignItems, ...calendarItems, ...sendItems]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/* ------------------------------------------------------- client-visible goals */

// A deliberately narrow view of an account's OKRs for the client-facing
// dashboard: the objective, its target date, and a coarse status. Never
// includes key results (their numeric targets/current progress) — those
// stay admin-only, surfaced separately via src/lib/okrs.ts on the admin route.
export interface ClientGoal {
  id: string;
  objective: string;
  targetDate: string | null;
  status: OkrStatus;
}

export function clientVisibleGoals(clientId: string): ClientGoal[] {
  return listOkrs(clientId).map((o) => ({
    id: o.id,
    objective: o.objective,
    targetDate: o.target_date,
    status: o.status,
  }));
}

/* --------------------------------------------------- aggregated dashboard */

interface DashboardKpi {
  key: string;
  label: string;
  fmt: string;
  hint: string | null;
  value: number | null;
}

export interface ClientDashboardData {
  client: { id: string; name: string; accountManager: string };
  production: ProductionStatus;
  snapshot: { token: string | null; overview: ReturnType<typeof deliverableOverview> };
  accountData: { kpis: DashboardKpi[] };
  calendar: ScheduledSend[];
  activity: AccountActivityItem[];
  goals: ClientGoal[];
  pendingApprovals: PendingApproval[];
  workboard: Workboard;
}

/* ----------------------------------------------------- live workroom (tower) */
// The client dashboard's "workroom" view: their to-dos, grouped into
// department "floors" of an office tower so the client can watch work happen.
export interface WorkboardTask {
  id: string;
  title: string;
  assignee: string;
  assigneeLabel: string;
  avatar: string | null;
  status: "open" | "done";
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  updatedAt: string;
}
export interface WorkboardFloor {
  key: string;
  department: string;
  active: number;
  done: number;
  tasks: WorkboardTask[];
}
export interface Workboard {
  floors: WorkboardFloor[];
  activeTotal: number;
  doneRecent: number;
  peopleActive: number;
  recent: { department: string; title: string; status: "open" | "done"; assigneeLabel: string; at: string }[];
  updatedAt: string;
}

// Department "floors", ordered top (penthouse) to bottom (lobby). Each client
// to-do is mapped to one by its list_name; anything unrecognized gets its own
// floor so nothing is hidden.
const TOWER_DEPARTMENTS: { key: string; label: string; match: string[] }[] = [
  { key: "strategy", label: "Strategy & Client", match: ["strategy & client", "strategy", "client", "strategy & planning"] },
  { key: "paid", label: "Paid Media", match: ["paid media", "paid", "ppc", "ads", "paid ads"] },
  { key: "seo", label: "SEO", match: ["seo"] },
  { key: "content", label: "Content", match: ["content", "content / blog", "blog"] },
  { key: "social", label: "Social", match: ["social", "social media"] },
  { key: "email", label: "Email & Lifecycle", match: ["email & lifecycle", "email", "lifecycle", "sms"] },
  { key: "onboarding", label: "Onboarding", match: ["onboarding"] },
];

function departmentFor(listName: string): { key: string; label: string } {
  const n = (listName || "").trim().toLowerCase();
  if (n) {
    for (const d of TOWER_DEPARTMENTS) {
      if (d.match.includes(n) || d.match.some((m) => n.includes(m))) return { key: d.key, label: d.label };
    }
  }
  const label = listName.trim() || "General";
  return { key: `other:${label.toLowerCase()}`, label };
}

export function getClientWorkboard(clientId: string): Workboard {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const nowIso = new Date().toISOString();
  const client = getRevClient(clientId);
  const amSlug = client ? slugForName(client.account_manager || "") : null;

  type WorkItem = {
    id: string; title: string; assignee: string; status: string; priority: string;
    due_date: string | null; completed_at: string | null; updated_at: string; list_name: string;
  };

  // Real, hand-tracked to-dos carry their true assignee.
  const items: WorkItem[] = listTodos({ clientId }).map((t) => ({
    id: t.id, title: t.title, assignee: t.assignee, status: t.status, priority: t.priority,
    due_date: t.due_date, completed_at: t.completed_at, updated_at: t.updated_at, list_name: t.list_name,
  }));

  // Supplement with the rest of the account's live work so the floor reflects
  // everything in motion, not only hand-entered to-dos. These are attributed to
  // the account manager (their real owner); each maps to a floor by category.
  const seen = new Set(items.map((i) => i.title.trim().toLowerCase()));
  const push = (it: WorkItem) => {
    const key = it.title.trim().toLowerCase();
    if (!it.title || seen.has(key)) return;
    seen.add(key);
    items.push(it);
  };

  try {
    for (const d of deliverableOverview(clientId)) {
      const done = ["completed", "approved"].includes(d.status);
      push({
        id: `dlv-${d.deliverable_id}`, title: d.name, assignee: amSlug || "",
        status: done ? "done" : "open", priority: "normal",
        due_date: null, completed_at: done ? nowIso : null, updated_at: nowIso,
        list_name: d.category || "",
      });
    }
  } catch { /* snapshot not set up for this client */ }

  try {
    const today = todayYmd();
    for (const s of planSends(clientId, addDaysYmd(today, -7), addDaysYmd(today, 45))) {
      if (!["planned", "scheduled", "requested", "sent"].includes(s.status)) continue;
      const done = s.status === "sent";
      push({
        id: `snd-${s.id}`, title: s.title, assignee: amSlug || "",
        status: done ? "done" : "open", priority: "normal",
        due_date: s.send_date, completed_at: done ? (s.updated_at || nowIso) : null,
        updated_at: s.updated_at || nowIso, list_name: "Email & Lifecycle",
      });
    }
  } catch { /* no calendar for this client */ }

  try {
    for (const c of listPendingApprovalCampaigns(clientId)) {
      push({
        id: `cmp-${c.id}`, title: c.title, assignee: amSlug || "",
        status: "open", priority: "important",
        due_date: null, completed_at: null, updated_at: c.updated_at || nowIso,
        list_name: "Email & Lifecycle",
      });
    }
  } catch { /* none pending */ }

  const todos = items;

  const byKey = new Map<string, WorkboardFloor>();
  const order = new Map(TOWER_DEPARTMENTS.map((d, i) => [d.key, i]));
  const activeAssignees = new Set<string>();
  let doneRecent = 0;

  for (const t of todos) {
    const dept = departmentFor(t.list_name);
    if (!byKey.has(dept.key)) {
      byKey.set(dept.key, { key: dept.key, department: dept.label, active: 0, done: 0, tasks: [] });
    }
    const floor = byKey.get(dept.key)!;
    const task: WorkboardTask = {
      id: t.id,
      title: t.title,
      assignee: t.assignee,
      assigneeLabel: t.assignee ? teamLabel(t.assignee) : "Unassigned",
      avatar: t.assignee ? avatarFor(t.assignee) : null,
      status: t.status === "done" ? "done" : "open",
      priority: t.priority,
      dueDate: t.due_date,
      completedAt: t.completed_at,
      updatedAt: t.updated_at,
    };
    floor.tasks.push(task);
    if (task.status === "open") {
      floor.active += 1;
      if (t.assignee) activeAssignees.add(t.assignee);
    } else {
      floor.done += 1;
      if (t.completed_at && new Date(t.completed_at).getTime() >= dayAgo) doneRecent += 1;
    }
  }

  // Active tasks first within a floor, urgent before important before flexible.
  const pri = (p: string) => (p === "urgent" ? 0 : p === "important" ? 1 : 2);
  for (const floor of byKey.values()) {
    floor.tasks.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return pri(a.priority) - pri(b.priority);
    });
  }

  const floors = Array.from(byKey.values()).sort((a, b) => {
    const oa = order.has(a.key) ? order.get(a.key)! : 100;
    const ob = order.has(b.key) ? order.get(b.key)! : 100;
    if (oa !== ob) return oa - ob;
    return a.department.localeCompare(b.department);
  });

  const recent = [...todos]
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .slice(0, 10)
    .map((t) => ({
      department: departmentFor(t.list_name).label,
      title: t.title,
      status: (t.status === "done" ? "done" : "open") as "open" | "done",
      assigneeLabel: t.assignee ? teamLabel(t.assignee) : "Unassigned",
      at: t.updated_at,
    }));

  return {
    floors,
    activeTotal: floors.reduce((s, f) => s + f.active, 0),
    doneRecent,
    peopleActive: activeAssignees.size,
    recent,
    updatedAt: new Date().toISOString(),
  };
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// The single aggregating read used by both the public dashboard route and the
// internal admin hub route. Includes clientVisibleGoals' narrow goal view
// (objective + target date + status only) — safe for the public token route.
// The admin route additionally merges full listOkrs() (with key results) on
// top of this result itself; that fuller view never flows through here.
export function getClientDashboardData(clientId: string): ClientDashboardData | null {
  const client = getRevClient(clientId);
  if (!client) return null;

  const today = todayYmd();
  const metrics = listMetrics(clientId);
  const agg = aggregate(metrics);
  const kpis = kpisForModel(client.business_model).map((k) => ({
    key: k.key,
    label: k.label,
    fmt: k.fmt,
    hint: k.hint ?? null,
    value: k.value(agg, client),
  }));

  return {
    client: { id: client.id, name: client.name, accountManager: client.account_manager },
    production: productionStatus(client),
    snapshot: {
      token: getOrCreateSnapshotToken(client.id),
      overview: deliverableOverview(client.id),
    },
    accountData: { kpis },
    calendar: planSends(client.id, addDaysYmd(today, -30), addDaysYmd(today, 180)),
    activity: accountActivity(client.id),
    goals: clientVisibleGoals(client.id),
    pendingApprovals: listPendingApprovalCampaigns(client.id),
    workboard: getClientWorkboard(client.id),
  };
}
