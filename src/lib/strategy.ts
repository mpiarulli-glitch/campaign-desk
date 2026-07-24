import { getDb, nowIso, type ClientStrategy } from "./db";
import { createTodo } from "./todos";
import { getRevClient } from "./revenue";
import { slugForName } from "./team";

export type { ClientStrategy };

// Who owns what, by department. "am" = the account's manager (resolved from
// rev_clients.account_manager), falling back to Cassidy when none is set.
const OWNER = {
  michael: "michael", // email, sms, automation, lifecycle, reviews
  carlos: "carlos", // SEO
  mike_hines: "mike_hines", // paid media
  luis: "luis_romero", // generic onboarding
  am_fallback: "cassidy", // client-facing when no manager set
} as const;

function accountManagerSlug(clientId: string): string {
  const client = getRevClient(clientId);
  const resolved = client ? slugForName(client.account_manager) : null;
  return resolved || OWNER.am_fallback;
}

// Marketing channels a client can be running. Drives which onboarding and
// recurring to-dos get generated.
export const CHANNELS = [
  { slug: "email", label: "Email marketing" },
  { slug: "sms", label: "SMS marketing" },
  { slug: "social", label: "Social media" },
  { slug: "content", label: "Content / blog" },
  { slug: "ppc", label: "Paid ads" },
  { slug: "seo", label: "SEO" },
  { slug: "reviews", label: "Review management" },
  { slug: "automation", label: "CRM automation" },
] as const;

// Each generated task carries a title, the list it groups under, and an owner
// role. Owner is either a fixed slug or "am" (the account manager). Onboarding
// tasks all group under "Onboarding"; recurring tasks group by department.
type OwnerRole = string | "am";
interface TaskTemplate {
  title: string;
  list: string;
  owner: OwnerRole;
}

// Base onboarding checklist, always generated. Client-facing items go to the
// account manager; the generic setup work goes to Luis.
const BASE_ONBOARDING: TaskTemplate[] = [
  { title: "Schedule kickoff call", list: "Onboarding", owner: "am" },
  { title: "Collect brand assets, logins, and access", list: "Onboarding", owner: OWNER.luis },
  { title: "Set up platform subaccount and sending config", list: "Onboarding", owner: OWNER.luis },
  { title: "Define audience segments", list: "Onboarding", owner: "am" },
  { title: "Connect tracking and analytics", list: "Onboarding", owner: OWNER.luis },
];

// Channel-specific onboarding. All grouped under "Onboarding", owned by the
// department lead.
const CHANNEL_ONBOARDING: Record<string, TaskTemplate[]> = {
  email: [
    { title: "Set up email sending domain and warm-up", list: "Onboarding", owner: OWNER.michael },
    { title: "Build welcome / nurture flow", list: "Onboarding", owner: OWNER.michael },
  ],
  sms: [
    { title: "Register A2P 10DLC for SMS", list: "Onboarding", owner: OWNER.michael },
    { title: "Draft SMS opt-in flow", list: "Onboarding", owner: OWNER.michael },
  ],
  social: [{ title: "Connect social accounts and scheduler", list: "Onboarding", owner: "am" }],
  content: [
    { title: "Build content calendar", list: "Onboarding", owner: "am" },
    { title: "Outline first blog post", list: "Onboarding", owner: "am" },
  ],
  ppc: [{ title: "Set up ad accounts and conversion tracking", list: "Onboarding", owner: OWNER.mike_hines }],
  seo: [
    { title: "Run technical SEO audit", list: "Onboarding", owner: OWNER.carlos },
    { title: "Complete keyword research", list: "Onboarding", owner: OWNER.carlos },
  ],
  reviews: [{ title: "Connect review platform and request flow", list: "Onboarding", owner: OWNER.michael }],
  automation: [{ title: "Map core CRM automations", list: "Onboarding", owner: OWNER.michael }],
};

// Recurring work, grouped by department.
const BASE_RECURRING: TaskTemplate[] = [
  { title: "Monthly performance report", list: "Strategy & Client", owner: "am" },
  { title: "Monthly strategy check-in", list: "Strategy & Client", owner: "am" },
];
const CHANNEL_RECURRING: Record<string, TaskTemplate[]> = {
  email: [{ title: "Send monthly email campaign", list: "Email & Lifecycle", owner: OWNER.michael }],
  sms: [{ title: "Send monthly SMS campaign", list: "Email & Lifecycle", owner: OWNER.michael }],
  social: [{ title: "Publish this month's social posts", list: "Social", owner: "am" }],
  content: [{ title: "Publish monthly blog post", list: "Content", owner: "am" }],
  ppc: [{ title: "Optimize ad campaigns and report", list: "Paid Media", owner: OWNER.mike_hines }],
  seo: [{ title: "Monthly SEO progress and rankings check", list: "SEO", owner: OWNER.carlos }],
  reviews: [{ title: "Monthly review response and generation push", list: "Email & Lifecycle", owner: OWNER.michael }],
  automation: [{ title: "Audit and tune CRM automations", list: "Email & Lifecycle", owner: OWNER.michael }],
};

function parseChannels(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export interface StrategyView extends Omit<ClientStrategy, "channels"> {
  channels: string[];
}

export function getStrategy(clientId: string): StrategyView {
  const row = getDb()
    .prepare(`SELECT * FROM client_strategies WHERE client_id = ?`)
    .get(clientId) as ClientStrategy | undefined;
  if (!row) {
    return {
      client_id: clientId,
      positioning: "",
      audience: "",
      goals: "",
      channels: [],
      cadence_notes: "",
      onboarding_generated_at: null,
      recurring_generated_at: null,
      updated_at: "",
    };
  }
  return { ...row, channels: parseChannels(row.channels) };
}

export function upsertStrategy(
  clientId: string,
  input: Partial<{
    positioning: string;
    audience: string;
    goals: string;
    channels: string[];
    cadenceNotes: string;
  }>
): StrategyView {
  const db = getDb();
  const existing = getStrategy(clientId);
  const ts = nowIso();
  const channels = input.channels ?? existing.channels;
  const validChannels = channels.filter((c) => CHANNELS.some((ch) => ch.slug === c));

  db.prepare(
    `INSERT INTO client_strategies
      (client_id, positioning, audience, goals, channels, cadence_notes, onboarding_generated_at, recurring_generated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       positioning = excluded.positioning,
       audience = excluded.audience,
       goals = excluded.goals,
       channels = excluded.channels,
       cadence_notes = excluded.cadence_notes,
       updated_at = excluded.updated_at`
  ).run(
    clientId,
    input.positioning ?? existing.positioning,
    input.audience ?? existing.audience,
    input.goals ?? existing.goals,
    JSON.stringify(validChannels),
    input.cadenceNotes ?? existing.cadence_notes,
    existing.onboarding_generated_at,
    existing.recurring_generated_at,
    ts
  );
  return getStrategy(clientId);
}

function endOfMonthYmd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface GenerateResult {
  created: number;
  skipped: boolean;
  reason?: string;
}

// Build the onboarding to-do set from the strategy's channels. Idempotent
// unless force: once generated, re-running is a no-op so re-saving strategy
// doesn't spam duplicates.
export function generateOnboardingTodos(clientId: string, force = false): GenerateResult {
  const strategy = getStrategy(clientId);
  if (strategy.onboarding_generated_at && !force) {
    return { created: 0, skipped: true, reason: "Onboarding to-dos were already generated." };
  }
  const am = accountManagerSlug(clientId);
  const templates: TaskTemplate[] = [
    ...BASE_ONBOARDING,
    ...strategy.channels.flatMap((c) => CHANNEL_ONBOARDING[c] || []),
  ];
  for (const t of templates) {
    createTodo({
      title: t.title,
      clientId,
      priority: "important",
      source: "strategy",
      listName: t.list,
      assignee: t.owner === "am" ? am : t.owner,
    });
  }
  getDb()
    .prepare(`UPDATE client_strategies SET onboarding_generated_at = ? WHERE client_id = ?`)
    .run(nowIso(), clientId);
  return { created: templates.length, skipped: false };
}

// Build this month's recurring to-dos. Idempotent per calendar month unless
// force: re-running in the same month is a no-op.
export function generateRecurringTodos(clientId: string, force = false): GenerateResult {
  const strategy = getStrategy(clientId);
  const month = currentMonth();
  if (strategy.recurring_generated_at?.startsWith(month) && !force) {
    return { created: 0, skipped: true, reason: "Recurring to-dos already generated this month." };
  }
  const am = accountManagerSlug(clientId);
  const templates: TaskTemplate[] = [
    ...BASE_RECURRING,
    ...strategy.channels.flatMap((c) => CHANNEL_RECURRING[c] || []),
  ];
  const due = endOfMonthYmd();
  for (const t of templates) {
    createTodo({
      title: t.title,
      clientId,
      priority: "flexible",
      source: "strategy",
      dueDate: due,
      listName: t.list,
      assignee: t.owner === "am" ? am : t.owner,
    });
  }
  getDb()
    .prepare(`UPDATE client_strategies SET recurring_generated_at = ? WHERE client_id = ?`)
    .run(nowIso(), clientId);
  return { created: templates.length, skipped: false };
}
