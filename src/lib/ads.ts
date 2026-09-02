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
  { key: "gtm", label: "Google Tag Manager", short: "GTM" },
  { key: "ga4", label: "GA4", short: "GA4" },
  { key: "google_ads_tag", label: "Google Ads conversion", short: "Ads tag" },
  { key: "enhanced_conversions", label: "Enhanced conversions", short: "Enhanced" },
  { key: "call_tracking", label: "Call tracking", short: "Calls" },
  { key: "form_tracking", label: "Form / CRM tracking", short: "Forms" },
  { key: "thank_you_page", label: "Thank-you page", short: "Thank-you" },
  { key: "meta_pixel", label: "Meta Pixel", short: "Pixel" },
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

export function trackingItemLabel(key: TrackingKey, compact = false): string {
  const item = TRACKING_ITEMS.find((t) => t.key === key);
  if (!item) return key;
  return compact ? item.short : item.label;
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

function missingTrackingLabel(keys: TrackingKey[]): string {
  const names = keys.map((key) => trackingItemLabel(key, true));
  if (names.length === 1) return `${names[0]} missing`;
  if (names.length === 2) return `${names[0]} & ${names[1]} missing`;
  return `${names[0]}, ${names[1]} +${names.length - 2} missing`;
}

const GAP_SORT = [
  "no_landing",
  "no_budget",
  "no_channels",
  "track_required",
  "unset",
  "not_filled",
  "never_reviewed",
  "stale_review",
  "magnet_unknown",
  "no_magnet",
  "nurture_unknown",
  "no_nurture",
  "nurture_draft",
  "no_conversion",
  "track_recommended",
  "paused",
  "ppc_off",
];

function sortGaps(gaps: AdsGap[]): AdsGap[] {
  return [...gaps].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "block" ? -1 : 1;
    const ia = GAP_SORT.indexOf(a.key);
    const ib = GAP_SORT.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function computeGaps(input: AdsGapInput): AdsGap[] {
  const gaps: AdsGap[] = [];
  const running = isRunning(input.status);

  if (input.status === "unknown") {
    gaps.push({
      key: input.hasPpcInStrategy ? "unset" : "not_filled",
      label: input.hasPpcInStrategy
        ? "Status not filled in · PPC on strategy"
        : "Not filled in",
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
    const missingRequired = plan.required.filter((key) => input.tracking[key] !== "yes");
    if (missingRequired.length) {
      gaps.push({
        key: "track_required",
        label: missingTrackingLabel(missingRequired),
        severity: "block",
      });
    }
    const missingRecommended = plan.recommended.filter((key) => input.tracking[key] !== "yes");
    if (missingRecommended.length) {
      gaps.push({
        key: "track_recommended",
        label: missingTrackingLabel(missingRecommended),
        severity: "watch",
      });
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

  return sortGaps(gaps);
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

export type AdsBoardLane = "block" | "watch" | "ok";

export function adsBoardLane(gaps: AdsGap[]): AdsBoardLane {
  if (gaps.some((g) => g.severity === "block")) return "block";
  if (gaps.length > 0) return "watch";
  return "ok";
}

export function adsGapCounts(gaps: AdsGap[]): { block: number; watch: number } {
  let block = 0;
  let watch = 0;
  for (const gap of gaps) {
    if (gap.severity === "block") block += 1;
    else watch += 1;
  }
  return { block, watch };
}

const FILL_KEYS = new Set(["never_reviewed", "not_filled", "unset"]);
const REVIEW_ONLY_KEYS = new Set(["never_reviewed", "stale_review", "paused", "track_recommended"]);

function fillPriority(gaps: AdsGap[]): number {
  const keys = new Set(gaps.map((g) => g.key));
  if ([...FILL_KEYS].some((key) => keys.has(key))) return 0;
  if (keys.has("stale_review")) return 1;
  return 2;
}

export function reviewAgeDays(lastReviewedAt: string | null, nowMs = Date.now()): number | null {
  if (!lastReviewedAt) return null;
  const ms = Date.parse(lastReviewedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((nowMs - ms) / 86_400_000);
}

export type ReviewSignal =
  | { kind: "never" }
  | { kind: "stale"; days: number }
  | { kind: "ok"; days: number };

export function reviewSignal(lastReviewedAt: string | null, nowMs = Date.now()): ReviewSignal {
  const days = reviewAgeDays(lastReviewedAt, nowMs);
  if (days == null) return { kind: "never" };
  if (days >= REVIEW_STALE_DAYS) return { kind: "stale", days };
  return { kind: "ok", days };
}

export function reviewSignalLabel(signal: ReviewSignal): string {
  if (signal.kind === "never") return "Never reviewed";
  if (signal.days === 0) return "Reviewed today";
  if (signal.days === 1) return "Reviewed yesterday";
  return `Reviewed ${signal.days}d ago`;
}

/** Row is set up enough that the weekly pass is a check-in, not a fill-in. */
export function canMarkReviewedOnRow(gaps: AdsGap[]): boolean {
  if (gaps.some((g) => g.severity === "block")) return false;
  return gaps.every((g) => REVIEW_ONLY_KEYS.has(g.key));
}

export interface AdsSortable {
  name: string;
  gaps: AdsGap[];
  lastReviewedAt: string | null;
}

export function compareAdsRows(a: AdsSortable, b: AdsSortable, nowMs = Date.now()): number {
  const laneOrder: Record<AdsBoardLane, number> = { block: 0, watch: 1, ok: 2 };
  const la = adsBoardLane(a.gaps);
  const lb = adsBoardLane(b.gaps);
  if (la !== lb) return laneOrder[la] - laneOrder[lb];

  const ca = adsGapCounts(a.gaps);
  const cb = adsGapCounts(b.gaps);
  if (ca.block !== cb.block) return cb.block - ca.block;
  if (ca.watch !== cb.watch) return cb.watch - ca.watch;

  const fa = fillPriority(a.gaps);
  const fb = fillPriority(b.gaps);
  if (fa !== fb) return fa - fb;

  const ageA = reviewAgeDays(a.lastReviewedAt, nowMs);
  const ageB = reviewAgeDays(b.lastReviewedAt, nowMs);
  const rankA = ageA == null ? Number.POSITIVE_INFINITY : ageA;
  const rankB = ageB == null ? Number.POSITIVE_INFINITY : ageB;
  if (rankA !== rankB) return rankB - rankA;

  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function sortAdsRows<T extends AdsSortable>(rows: T[], nowMs = Date.now()): T[] {
  return [...rows].sort((a, b) => compareAdsRows(a, b, nowMs));
}

export function adsDashboardCounts(rows: Array<{
  status: AdsStatus;
  gaps: AdsGap[];
  ready: boolean;
}>): AdsDashboard["counts"] {
  let active = 0;
  let paused = 0;
  let off = 0;
  let unknown = 0;
  let attention = 0;
  let blocking = 0;
  let watch = 0;
  let ready = 0;
  for (const row of rows) {
    if (row.status === "active") active += 1;
    else if (row.status === "paused") paused += 1;
    else if (row.status === "off") off += 1;
    else unknown += 1;
    if (row.gaps.length > 0) attention += 1;
    const lane = adsBoardLane(row.gaps);
    if (lane === "block") blocking += 1;
    else if (lane === "watch") watch += 1;
    if (row.ready) ready += 1;
  }
  return {
    total: rows.length,
    active,
    paused,
    off,
    unknown,
    attention,
    blocking,
    watch,
    ready,
  };
}

export function adsPassSummary(counts: AdsDashboard["counts"]): string {
  if (counts.attention === 0) {
    return counts.ready
      ? `Nothing needs you this week. ${counts.ready} funnel-ready.`
      : "Nothing needs you this week.";
  }
  const noun = counts.attention === 1 ? "account needs you" : "accounts need you";
  const parts = [`${counts.attention} ${noun}`];
  if (counts.blocking) {
    parts.push(`${counts.blocking} blocking`);
  }
  if (counts.watch) {
    parts.push(`${counts.watch} to watch`);
  }
  return parts.join(" · ");
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

export interface AdsSetupStep {
  key: string;
  title: string;
  hint: string;
  done: boolean;
}

export function adsSetupSteps(row: {
  status: AdsStatus;
  monthlySpendLimit: number | null;
  googleCustomerId: string;
  channels: AdsChannel[];
  landingPageUrl: string;
  tracking: TrackingMap;
  trackingDone: number;
  trackingTotal: number;
  leadMagnet: LeadMagnet;
  nurtureStatus: NurtureStatus;
  conversionAction: string;
}): AdsSetupStep[] {
  const plan = trackingPlan(row.channels);
  const requiredDone =
    plan.required.length === 0 ||
    plan.required.every((key) => row.tracking[key] === "yes");
  return [
    {
      key: "status",
      title: "Ads status",
      hint: "Whether paid media is on, paused, or off for this account.",
      done: row.status !== "unknown",
    },
    {
      key: "budget",
      title: "Spend limit and account ID",
      hint: "Monthly cap and the Google Ads customer ID, if you have one.",
      done: row.monthlySpendLimit != null || row.status === "off",
    },
    {
      key: "channels",
      title: "Campaign types",
      hint: "Search, PMax, Local Services, Meta, and the rest.",
      done: row.channels.length > 0 || row.status === "off",
    },
    {
      key: "landing",
      title: "Landing page",
      hint: "Where the ads send people.",
      done: Boolean(row.landingPageUrl.trim()) || row.status === "off",
    },
    {
      key: "tracking",
      title: "Tracking",
      hint: "GTM, GA4, conversion tags, and the rest of the checklist.",
      done: requiredDone || row.status === "off",
    },
    {
      key: "funnel",
      title: "Lead magnet and nurture",
      hint: "What the click becomes, and whether a series follows it.",
      done:
        (row.leadMagnet !== "unknown" && row.nurtureStatus !== "unknown") ||
        row.status === "off",
    },
    {
      key: "conversion",
      title: "Conversion and offer",
      hint: "Name the conversion action and the offer the ads sell.",
      done: Boolean(row.conversionAction.trim()) || row.status === "off",
    },
  ];
}

export interface AdsAnalyticsMonth {
  period: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  leads: number | null;
  notes: string;
}

export function emptyAdsAnalytics(period: string): AdsAnalyticsMonth {
  return {
    period,
    spend: null,
    impressions: null,
    clicks: null,
    conversions: null,
    leads: null,
    notes: "",
  };
}

export function adsAnalyticsRates(row: AdsAnalyticsMonth): {
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
  cpa: number | null;
  convRate: number | null;
} {
  const impressions = row.impressions;
  const clicks = row.clicks;
  const spend = row.spend;
  const leads = row.leads;
  const conversions = row.conversions;
  return {
    ctr:
      impressions && impressions > 0 && clicks != null
        ? (clicks / impressions) * 100
        : null,
    cpc: spend != null && clicks && clicks > 0 ? spend / clicks : null,
    cpl: spend != null && leads && leads > 0 ? spend / leads : null,
    cpa: spend != null && conversions && conversions > 0 ? spend / conversions : null,
    convRate:
      clicks && clicks > 0 && conversions != null
        ? (conversions / clicks) * 100
        : null,
  };
}

export function currentAdsPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function formatAdsRate(value: number | null, kind: "pct" | "money"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export interface AdsDashboard {
  counts: {
    total: number;
    active: number;
    paused: number;
    off: number;
    unknown: number;
    attention: number;
    blocking: number;
    watch: number;
    ready: number;
  };
  rows: AdsClientRow[];
}
