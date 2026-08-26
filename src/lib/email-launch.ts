/**
 * Email-client launch checklist and "are we on track this month" math.
 *
 * Pure on purpose: the hub UI previews due dates in the browser, and the
 * tests lock the pace rules without standing up SQLite.
 */

export const EMAIL_LAUNCH_SOURCE = "email_launch";
export const EMAIL_LAUNCH_LIST = "Email launch";

export const EMAIL_PLATFORMS = [
  { slug: "ghl", label: "GHL" },
  { slug: "klaviyo", label: "Klaviyo" },
  { slug: "mailchimp", label: "Mailchimp" },
  { slug: "hubspot", label: "HubSpot" },
  { slug: "instantly", label: "Instantly.ai" },
] as const;

export type EmailPlatform = (typeof EMAIL_PLATFORMS)[number]["slug"];

const EMAIL_PLATFORM_SLUGS = new Set<string>(EMAIL_PLATFORMS.map((p) => p.slug));

export function isEmailPlatform(value: unknown): value is EmailPlatform {
  return typeof value === "string" && EMAIL_PLATFORM_SLUGS.has(value);
}

export function emailPlatformLabel(slug: string | null | undefined): string {
  return EMAIL_PLATFORMS.find((p) => p.slug === slug)?.label || "";
}

/**
 * Automations are tracked, but they are not contracted monthly volume.
 * Presentation is the source of truth; titles still catch packages that were
 * never flipped to the automation type (welcome series, flows).
 */
export function campaignCountsTowardQuota(
  presentation?: string | null,
  title?: string | null
): boolean {
  if (presentation === "automation") return false;
  const t = (title || "").toLowerCase();
  if (/\bautomations?\b/.test(t)) return false;
  if (/\bwelcome series\b/.test(t)) return false;
  if (/\bflows?\b/.test(t)) return false;
  return true;
}

/**
 * Statuses that mean the package has been sent to the client for approval
 * (or already came back). Draft, QA, and Cassidy/internal review are not here.
 */
export const CLIENT_APPROVAL_STATUSES = [
  "in_review",
  "needs_changes",
  "approved",
  "scheduled",
  "sent",
] as const;

/**
 * A campaign ticks the monthly contract once it has been sent to the client
 * for approval. `internal_review` and internally-approved work have not left
 * our hands. Later statuses still count so the number does not fall backwards
 * after notes, approval, scheduling, or send.
 */
export function campaignReachedClient(
  status?: string | null,
  approvedChannel?: string | null
): boolean {
  if (!status) return false;
  if (status === "approved" && approvedChannel === "internal") return false;
  return (CLIENT_APPROVAL_STATUSES as readonly string[]).includes(status);
}

export function calendarSendIsAutomation(assetType: string | null | undefined): boolean {
  return assetType === "crm_automation";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Duplicate revenue rows, or "Our Watch" vs "Our Watch w/Tim Thompson".
 * Location splits (Oceanside vs Corporate) stay separate.
 */
export function sameLifecycleAccount(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return new RegExp(`^${escapeRegExp(short)}\\s+(w\\/|with)\\s*`, "i").test(long);
}

export interface LaunchTaskTemplate {
  title: string;
  /** Whole weeks after the launch date. */
  weeks: number;
}

/**
 * What is owed after a client is added to Lifecycle, timed from their launch
 * date. Three milestones, nothing else.
 */
export const EMAIL_LAUNCH_TASKS: LaunchTaskTemplate[] = [
  { title: "Editorial campaign calendar", weeks: 2 },
  { title: "First round of campaigns", weeks: 3 },
  { title: "Automations", weeks: 4 },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Weekend due dates slide to Monday so nothing is owed on a day nobody works. */
export function weekdayOnOrAfter(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(y, (m || 1) - 1, d || 1).getDay();
  if (wd === 6) return addCalendarDays(ymd, 2);
  if (wd === 0) return addCalendarDays(ymd, 1);
  return ymd;
}

export function lastYmdOfPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const dt = new Date(y, m, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function daysInPeriod(period: string): number {
  return Number(lastYmdOfPeriod(period).slice(8, 10));
}

export interface LaunchPreviewItem {
  title: string;
  weeks: number;
  dueDate: string;
}

export function previewLaunchTodos(launchDate: string): LaunchPreviewItem[] {
  if (!isYmd(launchDate)) return [];
  return EMAIL_LAUNCH_TASKS.map((task) => ({
    title: task.title,
    weeks: task.weeks,
    dueDate: weekdayOnOrAfter(addCalendarDays(launchDate, task.weeks * 7)),
  }));
}

export type PaceStatus = "met" | "on_track" | "behind" | "no_quota";

export interface PaceResult {
  status: PaceStatus;
  remaining: number;
  label: string;
}

/**
 * Contract pace for the month. Quota is emails owed; delivered is emails
 * already sent to the client for approval. Remaining work vs remaining weeks,
 * with one extra email of slack so the first days of the month are not "behind".
 */
export function contractPace(
  quota: number,
  delivered: number,
  dayOfMonth: number,
  daysInMonth: number
): PaceResult {
  if (quota <= 0) {
    return { status: "no_quota", remaining: 0, label: "No quota set" };
  }
  const remaining = Math.max(0, quota - delivered);
  if (remaining === 0) {
    return { status: "met", remaining: 0, label: "Contract met" };
  }
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  const weeksLeft = daysLeft / 7;
  if (remaining <= weeksLeft + 1) {
    return { status: "on_track", remaining, label: "On track" };
  }
  return { status: "behind", remaining, label: "Behind" };
}

export const PACE_RANK: Record<PaceStatus, number> = {
  behind: 0,
  on_track: 1,
  met: 2,
  no_quota: 3,
};

export const PIPELINE_LABEL: Record<string, string> = {
  triage: "Not started",
  next_up: "In progress",
  qa: "In QA",
  internal_revisions: "Internal revisions",
  sent_for_approval: "With the client",
  follow_up_sent: "Followed up",
  needs_revisions: "Needs revisions",
  scheduling: "Needs scheduling",
  completed: "Done",
  deliverables_met: "Deliverables met",
};
