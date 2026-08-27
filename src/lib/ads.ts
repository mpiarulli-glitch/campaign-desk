/**
 * Paid-media dashboard: campaign types, spend, funnel, and tracking.
 *
 * Pure on purpose so the UI can share labels with the API, and so gap rules
 * can be tested without standing up SQLite.
 */

export const ADS_STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "off", label: "Off" },
  { value: "unknown", label: "Not set" },
] as const;

export type AdsStatus = (typeof ADS_STATUSES)[number]["value"];

export const ADS_CHANNELS = [
  { value: "search", label: "Search" },
  { value: "pmax", label: "PMax" },
  { value: "lsa", label: "Local Services" },
  { value: "demand_gen", label: "Demand Gen" },
  { value: "display", label: "Display" },
  { value: "youtube", label: "YouTube" },
  { value: "meta", label: "Meta" },
  { value: "other", label: "Other" },
] as const;

export type AdsChannel = (typeof ADS_CHANNELS)[number]["value"];

export const LEAD_MAGNETS = [
  { value: "unknown", label: "Not set" },
  { value: "none", label: "None" },
  { value: "form", label: "Form" },
  { value: "download", label: "Download" },
  { value: "quiz", label: "Quiz" },
  { value: "call", label: "Call" },
  { value: "other", label: "Other" },
] as const;

export type LeadMagnet = (typeof LEAD_MAGNETS)[number]["value"];

export const NURTURE_STATUSES = [
  { value: "unknown", label: "Not set" },
  { value: "none", label: "None" },
  { value: "draft", label: "Draft" },
  { value: "live", label: "Live" },
] as const;

export type NurtureStatus = (typeof NURTURE_STATUSES)[number]["value"];

export const TRACKING_STATES = ["unknown", "yes", "no"] as const;
export type TrackingState = (typeof TRACKING_STATES)[number];

export const TRACKING_ITEMS = [
  { key: "gtm", label: "Google Tag Manager" },
  { key: "ga4", label: "GA4" },
  { key: "google_ads_tag", label: "Google Ads conversion" },
  { key: "enhanced_conversions", label: "Enhanced conversions" },
  { key: "call_tracking", label: "Call tracking" },
  { key: "form_tracking", label: "Form / CRM tracking" },
  { key: "thank_you_page", label: "Thank-you page" },
  { key: "meta_pixel", label: "Meta Pixel" },
] as const;

export type TrackingKey = (typeof TRACKING_ITEMS)[number]["key"];
export type TrackingMap = Record<TrackingKey, TrackingState>;

export type GapSeverity = "block" | "watch";

export interface AdsGap {
  key: string;
  label: string;
  severity: GapSeverity;
}

export const REVIEW_STALE_DAYS = 30;

const STATUS_VALUES = new Set<string>(ADS_STATUSES.map((s) => s.value));
const CHANNEL_VALUES = new Set<string>(ADS_CHANNELS.map((c) => c.value));
const MAGNET_VALUES = new Set<string>(LEAD_MAGNETS.map((m) => m.value));
const NURTURE_VALUES = new Set<string>(NURTURE_STATUSES.map((n) => n.value));
const TRACKING_KEYS = TRACKING_ITEMS.map((i) => i.key);
const TRACKING_KEY_SET = new Set<string>(TRACKING_KEYS);
const TRACKING_STATE_SET = new Set<string>(TRACKING_STATES);

const GOOGLE_CHANNELS: AdsChannel[] = [
  "search",
  "pmax",
  "lsa",
  "demand_gen",
  "display",
  "youtube",
];
const GOOGLE_LEAD_CHANNELS: AdsChannel[] = [
  "search",
  "pmax",
  "demand_gen",
  "display",
  "youtube",
];

export function isAdsStatus(value: unknown): value is AdsStatus {
  return typeof value === "string" && STATUS_VALUES.has(value);
}

export function isLeadMagnet(value: unknown): value is LeadMagnet {
  return typeof value === "string" && MAGNET_VALUES.has(value);
}

export function isNurtureStatus(value: unknown): value is NurtureStatus {
  return typeof value === "string" && NURTURE_VALUES.has(value);
}

export function isTrackingState(value: unknown): value is TrackingState {
  return typeof value === "string" && TRACKING_STATE_SET.has(value);
}

export function adsStatusLabel(status: AdsStatus): string {
  return ADS_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function adsChannelLabel(channel: AdsChannel): string {
  return ADS_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

export function leadMagnetLabel(magnet: LeadMagnet): string {
  return LEAD_MAGNETS.find((m) => m.value === magnet)?.label ?? magnet;
}

export function nurtureStatusLabel(status: NurtureStatus): string {
  return NURTURE_STATUSES.find((n) => n.value === status)?.label ?? status;
}

export function emptyTracking(): TrackingMap {
  return {
    gtm: "unknown",
    ga4: "unknown",
    google_ads_tag: "unknown",
    enhanced_conversions: "unknown",
    call_tracking: "unknown",
    form_tracking: "unknown",
    thank_you_page: "unknown",
    meta_pixel: "unknown",
  };
}

export function parseChannels(raw: unknown): AdsChannel[] {
  const list = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
  const seen = new Set<AdsChannel>();
  const out: AdsChannel[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !CHANNEL_VALUES.has(item)) continue;
    const channel = item as AdsChannel;
    if (seen.has(channel)) continue;
    seen.add(channel);
    out.push(channel);
  }
  return out;
}

export function parseTracking(raw: unknown): TrackingMap {
  const base = emptyTracking();
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!obj || typeof obj !== "object") return base;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!TRACKING_KEY_SET.has(key) || !isTrackingState(value)) continue;
    base[key as TrackingKey] = value;
  }
  return base;
}

export function cycleTracking(state: TrackingState): TrackingState {
  if (state === "unknown") return "yes";
  if (state === "yes") return "no";
  return "unknown";
}

export interface TrackingPlan {
  required: TrackingKey[];
  recommended: TrackingKey[];
}

export function trackingPlan(channels: AdsChannel[]): TrackingPlan {
  const required: TrackingKey[] = ["gtm", "ga4"];
  const recommended: TrackingKey[] = ["thank_you_page"];
  const google =
    channels.length === 0 || channels.some((c) => GOOGLE_CHANNELS.includes(c));
  if (google) {
    required.push("google_ads_tag");
    recommended.push("enhanced_conversions");
  }
  if (channels.includes("lsa")) required.push("call_tracking");
  if (channels.some((c) => GOOGLE_LEAD_CHANNELS.includes(c)) || channels.length === 0) {
    required.push("form_tracking");
  }
  if (channels.includes("meta")) required.push("meta_pixel");

  const seen = new Set<TrackingKey>();
  const uniq = (keys: TrackingKey[]) => {
    const out: TrackingKey[] = [];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };
  const requiredUniq = uniq(required);
  const recommendedUniq = recommended.filter((key) => !requiredUniq.includes(key));
  return { required: requiredUniq, recommended: recommendedUniq };
}

export function trackingScore(
  tracking: TrackingMap,
  channels: AdsChannel[]
): { done: number; total: number } {
  const plan = trackingPlan(channels);
  const keys = [...plan.required, ...plan.recommended];
  return {
    done: keys.filter((key) => tracking[key] === "yes").length,
    total: keys.length,
  };
}

export interface AdsGapInput {
  status: AdsStatus;
  monthlySpendLimit: number | null;
  channels: AdsChannel[];
  landingPageUrl: string;
  leadMagnet: LeadMagnet;
  nurtureStatus: NurtureStatus;
  tracking: TrackingMap;
  conversionAction: string;
  lastReviewedAt: string | null;
  hasPpcInStrategy: boolean;
  nowMs?: number;
}

function isRunning(status: AdsStatus): boolean {
  return status === "active" || status === "paused";
}

export function computeGaps(input: AdsGapInput): AdsGap[] {
  const gaps: AdsGap[] = [];
  const running = isRunning(input.status);

  if (input.status === "unknown" && input.hasPpcInStrategy) {
    gaps.push({
      key: "unset",
      label: "Paid ads on strategy, status not filled in",
      severity: "watch",
    });
  }
  if (input.status === "off" && input.hasPpcInStrategy) {
    gaps.push({
      key: "ppc_off",
      label: "Paid ads on strategy, ads off",
      severity: "watch",
    });
  }
  if (input.status === "paused") {
    gaps.push({ key: "paused", label: "Ads paused", severity: "watch" });
  }

  if (running) {
    if (!input.channels.length) {
      gaps.push({ key: "no_channels", label: "No campaign types", severity: "block" });
    }
    if (input.monthlySpendLimit == null) {
      gaps.push({ key: "no_budget", label: "No spend limit", severity: "block" });
    }
    if (!input.landingPageUrl.trim()) {
      gaps.push({ key: "no_landing", label: "No landing page", severity: "block" });
    }
    if (input.leadMagnet === "unknown") {
      gaps.push({
        key: "magnet_unknown",
        label: "Lead magnet not set",
        severity: "watch",
      });
    } else if (input.leadMagnet === "none") {
      gaps.push({ key: "no_magnet", label: "No lead magnet", severity: "watch" });
    }
    if (input.nurtureStatus === "unknown") {
      gaps.push({
        key: "nurture_unknown",
        label: "Nurture not set",
        severity: "watch",
      });
    } else if (input.nurtureStatus === "none") {
      gaps.push({ key: "no_nurture", label: "No nurture series", severity: "watch" });
    } else if (input.nurtureStatus === "draft") {
      gaps.push({
        key: "nurture_draft",
        label: "Nurture still draft",
        severity: "watch",
      });
    }
    if (!input.conversionAction.trim()) {
      gaps.push({
        key: "no_conversion",
        label: "Conversion action not named",
        severity: "watch",
      });
    }

    const plan = trackingPlan(input.channels);
    for (const key of plan.required) {
      if (input.tracking[key] !== "yes") {
        const item = TRACKING_ITEMS.find((t) => t.key === key);
        gaps.push({
          key: `track_${key}`,
          label: `${item?.label ?? key} missing`,
          severity: "block",
        });
      }
    }
    for (const key of plan.recommended) {
      if (input.tracking[key] !== "yes") {
        const item = TRACKING_ITEMS.find((t) => t.key === key);
        gaps.push({
          key: `track_${key}`,
          label: `${item?.label ?? key} missing`,
          severity: "watch",
        });
      }
    }

    const now = input.nowMs ?? Date.now();
    if (!input.lastReviewedAt) {
      gaps.push({ key: "never_reviewed", label: "Never reviewed", severity: "watch" });
    } else {
      const reviewed = Date.parse(input.lastReviewedAt);
      if (Number.isFinite(reviewed)) {
        const days = Math.floor((now - reviewed) / 86_400_000);
        if (days >= REVIEW_STALE_DAYS) {
          gaps.push({
            key: "stale_review",
            label: `Review ${days}d ago`,
            severity: "watch",
          });
        }
      }
    }
  }

  return gaps;
}

export function isFunnelReady(input: {
  status: AdsStatus;
  leadMagnet: LeadMagnet;
  nurtureStatus: NurtureStatus;
  gaps: AdsGap[];
}): boolean {
  if (input.status !== "active") return false;
  if (input.leadMagnet === "unknown" || input.leadMagnet === "none") return false;
  if (input.nurtureStatus !== "live") return false;
  return input.gaps.every((g) => g.severity !== "block");
}

export function formatSpend(limit: number | null): string {
  if (limit == null) return "—";
  const n = Math.round(limit);
  return `$${n.toLocaleString("en-US")}/mo`;
}

export function landingHref(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(t) || t.toLowerCase().startsWith("www.")) {
    return `https://${t}`;
  }
  return t;
}

export function landingHost(url: string): string {
  const href = landingHref(url);
  if (!href) return "";
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return host || href;
  } catch {
    return url.trim();
  }
}

const NURTURE_HINT = /\b(nurture|welcome|lead magnet|drip|follow[- ]?up)\b/i;

export function looksLikeNurture(name: string, kind = ""): boolean {
  return NURTURE_HINT.test(`${name} ${kind}`);
}

export function effectiveNurture(
  explicit: NurtureStatus,
  detected: "live" | "draft" | null
): NurtureStatus {
  if (explicit !== "unknown") return explicit;
  if (detected === "live") return "live";
  if (detected === "draft") return "draft";
  return "unknown";
}

export interface AdsClientRow {
  clientId: string;
  name: string;
  accountManager: string;
  website: string;
  logoUrl: string | null;
  status: AdsStatus;
  monthlySpendLimit: number | null;
  googleCustomerId: string;
  channels: AdsChannel[];
  landingPageUrl: string;
  landingPageLabel: string;
  leadMagnet: LeadMagnet;
  leadMagnetNotes: string;
  nurtureStatus: NurtureStatus;
  nurtureNotes: string;
  nurtureSource: "manual" | "detected" | "none";
  nurtureDetectedLabel: string | null;
  tracking: TrackingMap;
  trackingDone: number;
  trackingTotal: number;
  conversionAction: string;
  offer: string;
  notes: string;
  lastReviewedAt: string | null;
  gaps: AdsGap[];
  ready: boolean;
  hasPpcInStrategy: boolean;
  saved: boolean;
  updatedAt: string | null;
}

export interface AdsDashboard {
  counts: {
    total: number;
    active: number;
    paused: number;
    off: number;
    unknown: number;
    attention: number;
    ready: number;
  };
  rows: AdsClientRow[];
}
