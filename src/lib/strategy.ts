import { getDb, nowIso, type ClientStrategy } from "./db";
import { createTodo } from "./todos";

export type { ClientStrategy };

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

// Onboarding tasks: a base checklist every account gets, plus channel-specific
// setup work. Recurring tasks: what repeats each period per channel, plus base
// reporting/check-in work.
const BASE_ONBOARDING = [
  "Schedule kickoff call",
  "Collect brand assets, logins, and access",
  "Set up platform subaccount and sending config",
  "Define audience segments",
  "Connect tracking and analytics",
];
const CHANNEL_ONBOARDING: Record<string, string[]> = {
  email: ["Set up email sending domain and warm-up", "Build welcome / nurture flow"],
  sms: ["Register A2P 10DLC for SMS", "Draft SMS opt-in flow"],
  social: ["Connect social accounts and scheduler"],
  content: ["Build content calendar", "Outline first blog post"],
  ppc: ["Set up ad accounts and conversion tracking"],
  seo: ["Run technical SEO audit", "Complete keyword research"],
  reviews: ["Connect review platform and request flow"],
  automation: ["Map core CRM automations"],
};

const BASE_RECURRING = ["Monthly performance report", "Monthly strategy check-in"];
const CHANNEL_RECURRING: Record<string, string[]> = {
  email: ["Send monthly email campaign"],
  sms: ["Send monthly SMS campaign"],
  social: ["Publish this month's social posts"],
  content: ["Publish monthly blog post"],
  ppc: ["Optimize ad campaigns and report"],
  seo: ["Monthly SEO progress and rankings check"],
  reviews: ["Monthly review response and generation push"],
  automation: ["Audit and tune CRM automations"],
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
  const titles = [
    ...BASE_ONBOARDING,
    ...strategy.channels.flatMap((c) => CHANNEL_ONBOARDING[c] || []),
  ];
  for (const title of titles) {
    createTodo({ title, clientId, priority: "important", source: "strategy" });
  }
  getDb()
    .prepare(`UPDATE client_strategies SET onboarding_generated_at = ? WHERE client_id = ?`)
    .run(nowIso(), clientId);
  return { created: titles.length, skipped: false };
}

// Build this month's recurring to-dos. Idempotent per calendar month unless
// force: re-running in the same month is a no-op.
export function generateRecurringTodos(clientId: string, force = false): GenerateResult {
  const strategy = getStrategy(clientId);
  const month = currentMonth();
  if (strategy.recurring_generated_at?.startsWith(month) && !force) {
    return { created: 0, skipped: true, reason: "Recurring to-dos already generated this month." };
  }
  const titles = [
    ...BASE_RECURRING,
    ...strategy.channels.flatMap((c) => CHANNEL_RECURRING[c] || []),
  ];
  const due = endOfMonthYmd();
  for (const title of titles) {
    createTodo({ title, clientId, priority: "flexible", source: "strategy", dueDate: due });
  }
  getDb()
    .prepare(`UPDATE client_strategies SET recurring_generated_at = ? WHERE client_id = ?`)
    .run(nowIso(), clientId);
  return { created: titles.length, skipped: false };
}
