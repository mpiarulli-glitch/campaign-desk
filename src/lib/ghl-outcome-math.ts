/**
 * Pure lifecycle outcome math. Kept off the GHL client so UI / tip code
 * can import it without pulling better-sqlite3 into the browser bundle.
 */

export type LifecycleTouch = "campaign" | "flow" | "other";

export interface TouchCounts {
  total: number;
  fromCampaign: number;
  fromFlow: number;
  fromOther: number;
  unknown: number;
}

export interface AppointmentOutcomes extends TouchCounts {
  booked: number;
  abandoned: number;
  recovered: number;
  recoveryRate: number;
  error: string | null;
}

export interface FormOutcomes extends TouchCounts {
  error: string | null;
}

export interface CommerceOutcomes extends TouchCounts {
  revenue: number;
  fromCampaignRevenue: number;
  fromFlowRevenue: number;
  error: string | null;
}

export interface LifecycleOutcomes {
  appointments: AppointmentOutcomes;
  forms: FormOutcomes;
  commerce: CommerceOutcomes;
  attributionNote: string;
}

export interface AppointmentEvent {
  id: string;
  contactId: string;
  startMs: number;
  addedMs: number;
  status: string;
  source: unknown;
  createdBy: unknown;
  raw: Record<string, unknown>;
}

const FLOW_RE = /\b(workflow|automation|flow|drip|nurture|sequence)\b/i;
const EMAIL_RE = /\b(e-?mail|newsletter|broadcast|email marketing)\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function flattenTouchText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => flattenTouchText(v, depth + 1)).join(" ");
  const rec = asRecord(value);
  if (!rec) return "";
  const keys = [
    "sessionSource",
    "source",
    "medium",
    "utmMedium",
    "utm_source",
    "utmSource",
    "utm_medium",
    "campaign",
    "utmCampaign",
    "utm_campaign",
    "mediumId",
    "parentName",
    "parentId",
    "adSource",
    "referrer",
    "createdBy",
  ];
  return keys.map((k) => flattenTouchText(rec[k], depth + 1)).join(" ");
}

/**
 * Best-effort campaign vs flow from GHL attribution blobs.
 * Workflow / automation wins over generic “email” so drip mail is not counted
 * as a blast.
 */
export function classifyLifecycleTouch(...parts: unknown[]): LifecycleTouch {
  const text = parts.map((p) => flattenTouchText(p)).join(" ").trim();
  if (!text) return "other";
  if (FLOW_RE.test(text)) return "flow";
  if (EMAIL_RE.test(text)) return "campaign";
  return "other";
}

export function emptyTouchCounts(): TouchCounts {
  return { total: 0, fromCampaign: 0, fromFlow: 0, fromOther: 0, unknown: 0 };
}

export function addTouch(counts: TouchCounts, touch: LifecycleTouch | null): void {
  counts.total += 1;
  if (touch === "campaign") counts.fromCampaign += 1;
  else if (touch === "flow") counts.fromFlow += 1;
  else if (touch === "other") counts.fromOther += 1;
  else counts.unknown += 1;
}

export function fromEmailOrFlow(counts: TouchCounts): number {
  return counts.fromCampaign + counts.fromFlow;
}

export function normalizeAppointmentStatus(status: unknown): string {
  return String(status || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isAbandonedStatus(status: unknown): boolean {
  const s = normalizeAppointmentStatus(status);
  return s === "cancelled" || s === "canceled" || s === "noshow" || s === "deleted";
}

export function isBookedStatus(status: unknown): boolean {
  return !isAbandonedStatus(status) && normalizeAppointmentStatus(status) !== "invalid";
}

export function summarizeAbandons(events: AppointmentEvent[]): {
  abandoned: number;
  recovered: number;
  recoveryRate: number;
} {
  const abandoned = events.filter((e) => isAbandonedStatus(e.status));
  const booked = events.filter((e) => isBookedStatus(e.status));
  let recovered = 0;
  for (const miss of abandoned) {
    if (!miss.contactId) continue;
    const later = booked.some(
      (hit) =>
        hit.id !== miss.id &&
        hit.contactId === miss.contactId &&
        (hit.startMs > miss.startMs || hit.addedMs > miss.addedMs)
    );
    if (later) recovered += 1;
  }
  return {
    abandoned: abandoned.length,
    recovered,
    recoveryRate: abandoned.length ? (recovered / abandoned.length) * 100 : 0,
  };
}
