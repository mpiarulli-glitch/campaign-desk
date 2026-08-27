/**
 * Paid-media dashboard: one snapshot per client, plus gaps derived from
 * tracking, funnel, and whether paid ads is on their strategy.
 */

import { getDb, nowIso } from "./db";
import { listRevClients, logoUrlFor } from "./revenue";
import {
  ADS_CHANNELS,
  computeGaps,
  effectiveNurture,
  isAdsStatus,
  isFunnelReady,
  isLeadMagnet,
  isNurtureStatus,
  isTrackingState,
  looksLikeNurture,
  parseChannels,
  parseTracking,
  trackingScore,
  type AdsChannel,
  type AdsClientRow,
  type AdsDashboard,
  type AdsStatus,
  type LeadMagnet,
  type NurtureStatus,
  type TrackingMap,
} from "./ads";

export type { AdsClientRow, AdsDashboard };

export interface AdsAccountRecord {
  client_id: string;
  status: AdsStatus;
  monthly_spend_limit: number | null;
  google_customer_id: string;
  channels: string;
  landing_page_url: string;
  landing_page_label: string;
  lead_magnet: LeadMagnet;
  lead_magnet_notes: string;
  nurture_status: NurtureStatus;
  nurture_notes: string;
  tracking_json: string;
  conversion_action: string;
  offer: string;
  last_reviewed_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

const CHANNEL_ORDER = ADS_CHANNELS.map((c) => c.value);

function emptyRecord(clientId: string): Omit<AdsAccountRecord, "created_at" | "updated_at"> {
  return {
    client_id: clientId,
    status: "unknown",
    monthly_spend_limit: null,
    google_customer_id: "",
    channels: "[]",
    landing_page_url: "",
    landing_page_label: "",
    lead_magnet: "unknown",
    lead_magnet_notes: "",
    nurture_status: "unknown",
    nurture_notes: "",
    tracking_json: "{}",
    conversion_action: "",
    offer: "",
    last_reviewed_at: null,
    notes: "",
  };
}

function listAccounts(): AdsAccountRecord[] {
  return getDb()
    .prepare(`SELECT * FROM ads_accounts`)
    .all() as AdsAccountRecord[];
}

function ppcClientIds(): Set<string> {
  const rows = getDb()
    .prepare(`SELECT client_id, channels FROM client_strategies`)
    .all() as Array<{ client_id: string; channels: string }>;
  const ids = new Set<string>();
  for (const row of rows) {
    try {
      const channels = JSON.parse(row.channels);
      if (Array.isArray(channels) && channels.includes("ppc")) ids.add(row.client_id);
    } catch {
      // ignore malformed strategy JSON
    }
  }
  return ids;
}

type DetectedNurture = { status: "live" | "draft"; label: string };

function nurtureDetections(): Map<string, DetectedNurture> {
  const map = new Map<string, DetectedNurture>();
  const automations = getDb()
    .prepare(
      `SELECT client_id, name, kind, status FROM lifecycle_automations
        WHERE client_id IS NOT NULL`
    )
    .all() as Array<{
    client_id: string;
    name: string;
    kind: string;
    status: string;
  }>;
  for (const row of automations) {
    if (!looksLikeNurture(row.name, row.kind)) continue;
    const live = row.status === "live";
    const next: DetectedNurture = {
      status: live ? "live" : "draft",
      label: row.name,
    };
    const prev = map.get(row.client_id);
    if (!prev || (prev.status !== "live" && live)) map.set(row.client_id, next);
  }

  const campaigns = getDb()
    .prepare(
      `SELECT client_id, title, status FROM campaigns
        WHERE presentation = 'automation'
          AND client_id IS NOT NULL
          AND (archived_at IS NULL OR archived_at = '')`
    )
    .all() as Array<{ client_id: string; title: string; status: string }>;
  for (const row of campaigns) {
    if (!looksLikeNurture(row.title)) continue;
    const live = row.status === "sent" || row.status === "approved" || row.status === "scheduled";
    const next: DetectedNurture = {
      status: live ? "live" : "draft",
      label: row.title,
    };
    const prev = map.get(row.client_id);
    if (!prev || (prev.status !== "live" && live)) map.set(row.client_id, next);
  }
  return map;
}

function sortChannels(channels: AdsChannel[]): AdsChannel[] {
  return [...channels].sort(
    (a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b)
  );
}

function rowFrom(
  client: {
    id: string;
    name: string;
    account_manager: string;
    website: string;
  },
  record: AdsAccountRecord | null,
  ppc: Set<string>,
  detected: Map<string, DetectedNurture>
): AdsClientRow {
  const account = record ?? emptyRecord(client.id);
  const channels = sortChannels(parseChannels(account.channels));
  const tracking = parseTracking(account.tracking_json);
  const magnet = isLeadMagnet(account.lead_magnet) ? account.lead_magnet : "unknown";
  const explicitNurture = isNurtureStatus(account.nurture_status)
    ? account.nurture_status
    : "unknown";
  const found = detected.get(client.id) ?? null;
  const nurtureStatus = effectiveNurture(explicitNurture, found?.status ?? null);
  const nurtureSource: AdsClientRow["nurtureSource"] =
    explicitNurture !== "unknown" ? "manual" : found ? "detected" : "none";
  const hasPpc = ppc.has(client.id);
  const gaps = computeGaps({
    status: isAdsStatus(account.status) ? account.status : "unknown",
    monthlySpendLimit: account.monthly_spend_limit,
    channels,
    landingPageUrl: account.landing_page_url,
    leadMagnet: magnet,
    nurtureStatus,
    tracking,
    conversionAction: account.conversion_action,
    lastReviewedAt: account.last_reviewed_at,
    hasPpcInStrategy: hasPpc,
  });
  const score = trackingScore(tracking, channels);
  const status = isAdsStatus(account.status) ? account.status : "unknown";
  return {
    clientId: client.id,
    name: client.name,
    accountManager: client.account_manager,
    website: client.website,
    logoUrl: logoUrlFor(client.website),
    status,
    monthlySpendLimit: account.monthly_spend_limit,
    googleCustomerId: account.google_customer_id,
    channels,
    landingPageUrl: account.landing_page_url,
    landingPageLabel: account.landing_page_label,
    leadMagnet: magnet,
    leadMagnetNotes: account.lead_magnet_notes,
    nurtureStatus,
    nurtureNotes: account.nurture_notes,
    nurtureSource,
    nurtureDetectedLabel: found?.label ?? null,
    tracking,
    trackingDone: score.done,
    trackingTotal: score.total,
    conversionAction: account.conversion_action,
    offer: account.offer,
    notes: account.notes,
    lastReviewedAt: account.last_reviewed_at,
    gaps,
    ready: isFunnelReady({ status, leadMagnet: magnet, nurtureStatus, gaps }),
    hasPpcInStrategy: hasPpc,
    saved: Boolean(record),
    updatedAt: record?.updated_at ?? null,
  };
}

function context() {
  const accounts = new Map(listAccounts().map((a) => [a.client_id, a]));
  return {
    accounts,
    ppc: ppcClientIds(),
    detected: nurtureDetections(),
  };
}

export function buildAdsDashboard(): AdsDashboard {
  const { accounts, ppc, detected } = context();
  const rows = listRevClients(false).map((c) =>
    rowFrom(c, accounts.get(c.id) ?? null, ppc, detected)
  );
  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    paused: rows.filter((r) => r.status === "paused").length,
    off: rows.filter((r) => r.status === "off").length,
    unknown: rows.filter((r) => r.status === "unknown").length,
    attention: rows.filter((r) => r.gaps.length > 0).length,
    ready: rows.filter((r) => r.ready).length,
  };
  return { counts, rows };
}

export function buildAdsRow(clientId: string): AdsClientRow | null {
  const client = listRevClients(true).find((c) => c.id === clientId);
  if (!client) return null;
  const { accounts, ppc, detected } = context();
  return rowFrom(client, accounts.get(client.id) ?? null, ppc, detected);
}

export interface AdsAccountPatch {
  status?: AdsStatus;
  monthlySpendLimit?: number | null;
  googleCustomerId?: string;
  channels?: AdsChannel[];
  landingPageUrl?: string;
  landingPageLabel?: string;
  leadMagnet?: LeadMagnet;
  leadMagnetNotes?: string;
  nurtureStatus?: NurtureStatus;
  nurtureNotes?: string;
  tracking?: Partial<TrackingMap>;
  conversionAction?: string;
  offer?: string;
  notes?: string;
  markReviewed?: boolean;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim();
}

export function parseAdsPatch(body: unknown): AdsAccountPatch | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const patch: AdsAccountPatch = {};

  if ("status" in b) {
    if (!isAdsStatus(b.status)) return { error: "Invalid ads status" };
    patch.status = b.status;
  }
  if ("monthlySpendLimit" in b) {
    if (b.monthlySpendLimit === null || b.monthlySpendLimit === "") {
      patch.monthlySpendLimit = null;
    } else if (typeof b.monthlySpendLimit === "number" && Number.isFinite(b.monthlySpendLimit)) {
      if (b.monthlySpendLimit < 0) return { error: "Spend limit cannot be negative" };
      patch.monthlySpendLimit = b.monthlySpendLimit;
    } else if (typeof b.monthlySpendLimit === "string" && b.monthlySpendLimit.trim() === "") {
      patch.monthlySpendLimit = null;
    } else if (typeof b.monthlySpendLimit === "string" && Number.isFinite(Number(b.monthlySpendLimit))) {
      const n = Number(b.monthlySpendLimit);
      if (n < 0) return { error: "Spend limit cannot be negative" };
      patch.monthlySpendLimit = n;
    } else {
      return { error: "Invalid spend limit" };
    }
  }
  if ("googleCustomerId" in b) {
    const v = asText(b.googleCustomerId);
    if (v === undefined) return { error: "Invalid Google customer id" };
    patch.googleCustomerId = v;
  }
  if ("channels" in b) {
    if (!Array.isArray(b.channels)) return { error: "Invalid channels" };
    patch.channels = parseChannels(b.channels);
  }
  if ("landingPageUrl" in b) {
    const v = asText(b.landingPageUrl);
    if (v === undefined) return { error: "Invalid landing page" };
    patch.landingPageUrl = v;
  }
  if ("landingPageLabel" in b) {
    const v = asText(b.landingPageLabel);
    if (v === undefined) return { error: "Invalid landing page label" };
    patch.landingPageLabel = v;
  }
  if ("leadMagnet" in b) {
    if (!isLeadMagnet(b.leadMagnet)) return { error: "Invalid lead magnet" };
    patch.leadMagnet = b.leadMagnet;
  }
  if ("leadMagnetNotes" in b) {
    const v = asText(b.leadMagnetNotes);
    if (v === undefined) return { error: "Invalid lead magnet notes" };
    patch.leadMagnetNotes = v;
  }
  if ("nurtureStatus" in b) {
    if (!isNurtureStatus(b.nurtureStatus)) return { error: "Invalid nurture status" };
    patch.nurtureStatus = b.nurtureStatus;
  }
  if ("nurtureNotes" in b) {
    const v = asText(b.nurtureNotes);
    if (v === undefined) return { error: "Invalid nurture notes" };
    patch.nurtureNotes = v;
  }
  if ("tracking" in b) {
    if (!b.tracking || typeof b.tracking !== "object") return { error: "Invalid tracking" };
    const tracking: Partial<TrackingMap> = {};
    for (const [key, value] of Object.entries(b.tracking as Record<string, unknown>)) {
      if (!isTrackingState(value)) return { error: "Invalid tracking state" };
      if (
        key === "gtm" ||
        key === "ga4" ||
        key === "google_ads_tag" ||
        key === "enhanced_conversions" ||
        key === "call_tracking" ||
        key === "form_tracking" ||
        key === "thank_you_page" ||
        key === "meta_pixel"
      ) {
        tracking[key] = value;
      }
    }
    patch.tracking = tracking;
  }
  if ("conversionAction" in b) {
    const v = asText(b.conversionAction);
    if (v === undefined) return { error: "Invalid conversion action" };
    patch.conversionAction = v;
  }
  if ("offer" in b) {
    const v = asText(b.offer);
    if (v === undefined) return { error: "Invalid offer" };
    patch.offer = v;
  }
  if ("notes" in b) {
    const v = asText(b.notes);
    if (v === undefined) return { error: "Invalid notes" };
    patch.notes = v;
  }
  if ("markReviewed" in b) {
    if (typeof b.markReviewed !== "boolean") return { error: "Invalid review flag" };
    patch.markReviewed = b.markReviewed;
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to update" };
  return patch;
}

export function upsertAdsAccount(
  clientId: string,
  patch: AdsAccountPatch
): AdsClientRow | null {
  const client = listRevClients(true).find((c) => c.id === clientId);
  if (!client) return null;

  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM ads_accounts WHERE client_id = ?`)
    .get(clientId) as AdsAccountRecord | undefined;
  const ts = nowIso();
  const tracking = {
    ...parseTracking(existing?.tracking_json),
    ...(patch.tracking || {}),
  };

  const next = {
    client_id: clientId,
    status: patch.status ?? (isAdsStatus(existing?.status) ? existing!.status : "unknown"),
    monthly_spend_limit:
      patch.monthlySpendLimit !== undefined
        ? patch.monthlySpendLimit
        : (existing?.monthly_spend_limit ?? null),
    google_customer_id: patch.googleCustomerId ?? existing?.google_customer_id ?? "",
    channels: JSON.stringify(patch.channels ?? parseChannels(existing?.channels ?? "[]")),
    landing_page_url: patch.landingPageUrl ?? existing?.landing_page_url ?? "",
    landing_page_label: patch.landingPageLabel ?? existing?.landing_page_label ?? "",
    lead_magnet: patch.leadMagnet ?? (isLeadMagnet(existing?.lead_magnet) ? existing!.lead_magnet : "unknown"),
    lead_magnet_notes: patch.leadMagnetNotes ?? existing?.lead_magnet_notes ?? "",
    nurture_status:
      patch.nurtureStatus ??
      (isNurtureStatus(existing?.nurture_status) ? existing!.nurture_status : "unknown"),
    nurture_notes: patch.nurtureNotes ?? existing?.nurture_notes ?? "",
    tracking_json: JSON.stringify(tracking),
    conversion_action: patch.conversionAction ?? existing?.conversion_action ?? "",
    offer: patch.offer ?? existing?.offer ?? "",
    last_reviewed_at: patch.markReviewed ? ts : (existing?.last_reviewed_at ?? null),
    notes: patch.notes ?? existing?.notes ?? "",
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };

  db.prepare(
    `INSERT INTO ads_accounts (
       client_id, status, monthly_spend_limit, google_customer_id, channels,
       landing_page_url, landing_page_label, lead_magnet, lead_magnet_notes,
       nurture_status, nurture_notes, tracking_json, conversion_action, offer,
       last_reviewed_at, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       status = excluded.status,
       monthly_spend_limit = excluded.monthly_spend_limit,
       google_customer_id = excluded.google_customer_id,
       channels = excluded.channels,
       landing_page_url = excluded.landing_page_url,
       landing_page_label = excluded.landing_page_label,
       lead_magnet = excluded.lead_magnet,
       lead_magnet_notes = excluded.lead_magnet_notes,
       nurture_status = excluded.nurture_status,
       nurture_notes = excluded.nurture_notes,
       tracking_json = excluded.tracking_json,
       conversion_action = excluded.conversion_action,
       offer = excluded.offer,
       last_reviewed_at = excluded.last_reviewed_at,
       notes = excluded.notes,
       updated_at = excluded.updated_at`
  ).run(
    next.client_id,
    next.status,
    next.monthly_spend_limit,
    next.google_customer_id,
    next.channels,
    next.landing_page_url,
    next.landing_page_label,
    next.lead_magnet,
    next.lead_magnet_notes,
    next.nurture_status,
    next.nurture_notes,
    next.tracking_json,
    next.conversion_action,
    next.offer,
    next.last_reviewed_at,
    next.notes,
    next.created_at,
    next.updated_at
  );

  return buildAdsRow(clientId);
}
