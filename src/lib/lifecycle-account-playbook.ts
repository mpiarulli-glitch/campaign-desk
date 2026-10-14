/**
 * Account-level Lifecycle strategy & playbook data:
 * - Brand guidelines (voice/tone, colors, typography, assets, sender info, do's & don'ts)
 * - ICPs (Ideal Customer Profiles)
 * - Offers (core, seasonal, promo codes, CTAs)
 * - Opt-in methods (popups, forms, lead magnets, conversion rates, lists)
 * - Campaign calendar & Testing calendar
 * - A/B testing log with results tracked
 */

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { getRevClient } from "./revenue";

export interface AccountBrandGuidelines {
  clientId: string;
  voiceTone: string;
  colors: string;
  fonts: string;
  logoAssetsUrl: string;
  dosAndDonts: string;
  senderName: string;
  replyToEmail: string;
  footerNotes: string;
  updatedAt: string | null;
}

export interface AccountIcp {
  id: string;
  clientId: string;
  name: string;
  painPoints: string;
  desires: string;
  objections: string;
  triggers: string;
  messagingAngle: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountOffer {
  id: string;
  clientId: string;
  name: string;
  offerType: string;
  details: string;
  promoCode: string;
  ctaUrl: string;
  status: "active" | "upcoming" | "paused" | "retired";
  createdAt: string;
  updatedAt: string;
}

export interface AccountOptInMethod {
  id: string;
  clientId: string;
  name: string;
  channel: string;
  incentive: string;
  destinationList: string;
  conversionRate: string;
  url: string;
  status: "live" | "testing" | "draft" | "paused";
  createdAt: string;
  updatedAt: string;
}

export type AccountCalendarKind = "campaign" | "testing";

export interface AccountCalendarItem {
  id: string;
  clientId: string;
  calendarKind: AccountCalendarKind;
  title: string;
  plannedDate: string;
  audienceOrTarget: string;
  offerOrVariable: string;
  status: "planned" | "drafting" | "in_review" | "scheduled" | "sent" | "completed";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountAbTest {
  id: string;
  clientId: string;
  title: string;
  campaignOrFlow: string;
  variable: string;
  hypothesis: string;
  variantA: string;
  variantB: string;
  metric: string;
  resultA: string;
  resultB: string;
  winner: "pending" | "a" | "b" | "tie" | "inconclusive";
  takeaway: string;
  testedOn: string;
  status: "idea" | "running" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface AccountPlaybook {
  clientId: string;
  brand: AccountBrandGuidelines;
  icps: AccountIcp[];
  offers: AccountOffer[];
  optIns: AccountOptInMethod[];
  campaignCalendar: AccountCalendarItem[];
  testingCalendar: AccountCalendarItem[];
  abTests: AccountAbTest[];
}

function normalizeIds(clientId: string, memberIds: string[] = []): string[] {
  return [...new Set([clientId, ...memberIds].filter(Boolean))];
}

export function getAccountBrandGuidelines(
  clientId: string,
  memberIds: string[] = []
): AccountBrandGuidelines {
  const ids = normalizeIds(clientId, memberIds);
  const row = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_brand
        WHERE client_id IN (${ids.map(() => "?").join(",")})
        ORDER BY updated_at DESC LIMIT 1`
    )
    .get(...ids) as
    | {
        client_id: string;
        voice_tone: string;
        colors: string;
        fonts: string;
        logo_assets_url: string;
        dos_and_donts: string;
        sender_name: string;
        reply_to_email: string;
        footer_notes: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      clientId,
      voiceTone: "",
      colors: "",
      fonts: "",
      logoAssetsUrl: "",
      dosAndDonts: "",
      senderName: "",
      replyToEmail: "",
      footerNotes: "",
      updatedAt: null,
    };
  }

  return {
    clientId,
    voiceTone: row.voice_tone,
    colors: row.colors,
    fonts: row.fonts,
    logoAssetsUrl: row.logo_assets_url,
    dosAndDonts: row.dos_and_donts,
    senderName: row.sender_name,
    replyToEmail: row.reply_to_email,
    footerNotes: row.footer_notes,
    updatedAt: row.updated_at,
  };
}

export function saveAccountBrandGuidelines(
  clientId: string,
  input: Partial<Omit<AccountBrandGuidelines, "clientId" | "updatedAt">>
): AccountBrandGuidelines | null {
  if (!getRevClient(clientId)) return null;
  const current = getAccountBrandGuidelines(clientId);
  const ts = nowIso();
  const next = {
    voiceTone: input.voiceTone !== undefined ? String(input.voiceTone).trim() : current.voiceTone,
    colors: input.colors !== undefined ? String(input.colors).trim() : current.colors,
    fonts: input.fonts !== undefined ? String(input.fonts).trim() : current.fonts,
    logoAssetsUrl:
      input.logoAssetsUrl !== undefined
        ? String(input.logoAssetsUrl).trim()
        : current.logoAssetsUrl,
    dosAndDonts:
      input.dosAndDonts !== undefined ? String(input.dosAndDonts).trim() : current.dosAndDonts,
    senderName:
      input.senderName !== undefined ? String(input.senderName).trim() : current.senderName,
    replyToEmail:
      input.replyToEmail !== undefined ? String(input.replyToEmail).trim() : current.replyToEmail,
    footerNotes:
      input.footerNotes !== undefined ? String(input.footerNotes).trim() : current.footerNotes,
  };

  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_brand (
         client_id, voice_tone, colors, fonts, logo_assets_url,
         dos_and_donts, sender_name, reply_to_email, footer_notes, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         voice_tone = excluded.voice_tone,
         colors = excluded.colors,
         fonts = excluded.fonts,
         logo_assets_url = excluded.logo_assets_url,
         dos_and_donts = excluded.dos_and_donts,
         sender_name = excluded.sender_name,
         reply_to_email = excluded.reply_to_email,
         footer_notes = excluded.footer_notes,
         updated_at = excluded.updated_at`
    )
    .run(
      clientId,
      next.voiceTone,
      next.colors,
      next.fonts,
      next.logoAssetsUrl,
      next.dosAndDonts,
      next.senderName,
      next.replyToEmail,
      next.footerNotes,
      ts
    );

  return getAccountBrandGuidelines(clientId);
}

export function listAccountIcps(clientId: string, memberIds: string[] = []): AccountIcp[] {
  const ids = normalizeIds(clientId, memberIds);
  const rows = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_icps
        WHERE client_id IN (${ids.map(() => "?").join(",")})
        ORDER BY created_at ASC`
    )
    .all(...ids) as Array<{
    id: string;
    client_id: string;
    name: string;
    pain_points: string;
    desires: string;
    objections: string;
    triggers: string;
    messaging_angle: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    painPoints: r.pain_points,
    desires: r.desires,
    objections: r.objections,
    triggers: r.triggers,
    messagingAngle: r.messaging_angle,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function addAccountIcp(
  clientId: string,
  input: {
    name: string;
    painPoints?: string;
    desires?: string;
    objections?: string;
    triggers?: string;
    messagingAngle?: string;
  }
): AccountIcp | null {
  if (!getRevClient(clientId)) return null;
  const name = (input.name || "").trim();
  if (!name) return null;
  const id = `icp_${nanoid(10)}`;
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_icps (
         id, client_id, name, pain_points, desires, objections, triggers, messaging_angle, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clientId,
      name,
      (input.painPoints || "").trim(),
      (input.desires || "").trim(),
      (input.objections || "").trim(),
      (input.triggers || "").trim(),
      (input.messagingAngle || "").trim(),
      ts,
      ts
    );
  return listAccountIcps(clientId).find((i) => i.id === id) ?? null;
}

export function deleteAccountIcp(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM lifecycle_account_icps WHERE id = ?`).run(id);
  return res.changes > 0;
}

const OFFER_STATUSES = new Set<AccountOffer["status"]>([
  "active",
  "upcoming",
  "paused",
  "retired",
]);

export function listAccountOffers(clientId: string, memberIds: string[] = []): AccountOffer[] {
  const ids = normalizeIds(clientId, memberIds);
  const rows = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_offers
        WHERE client_id IN (${ids.map(() => "?").join(",")})
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                 created_at DESC`
    )
    .all(...ids) as Array<{
    id: string;
    client_id: string;
    name: string;
    offer_type: string;
    details: string;
    promo_code: string;
    cta_url: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    offerType: r.offer_type,
    details: r.details,
    promoCode: r.promo_code,
    ctaUrl: r.cta_url,
    status: OFFER_STATUSES.has(r.status as AccountOffer["status"])
      ? (r.status as AccountOffer["status"])
      : "active",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function addAccountOffer(
  clientId: string,
  input: {
    name: string;
    offerType?: string;
    details?: string;
    promoCode?: string;
    ctaUrl?: string;
    status?: string;
  }
): AccountOffer | null {
  if (!getRevClient(clientId)) return null;
  const name = (input.name || "").trim();
  if (!name) return null;
  const id = `off_${nanoid(10)}`;
  const ts = nowIso();
  const status = OFFER_STATUSES.has(input.status as AccountOffer["status"])
    ? (input.status as AccountOffer["status"])
    : "active";
  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_offers (
         id, client_id, name, offer_type, details, promo_code, cta_url, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clientId,
      name,
      (input.offerType || "core").trim(),
      (input.details || "").trim(),
      (input.promoCode || "").trim(),
      (input.ctaUrl || "").trim(),
      status,
      ts,
      ts
    );
  return listAccountOffers(clientId).find((o) => o.id === id) ?? null;
}

export function updateAccountOfferStatus(id: string, status: string): boolean {
  if (!OFFER_STATUSES.has(status as AccountOffer["status"])) return false;
  const res = getDb()
    .prepare(`UPDATE lifecycle_account_offers SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowIso(), id);
  return res.changes > 0;
}

export function deleteAccountOffer(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM lifecycle_account_offers WHERE id = ?`).run(id);
  return res.changes > 0;
}

const OPT_IN_STATUSES = new Set<AccountOptInMethod["status"]>([
  "live",
  "testing",
  "draft",
  "paused",
]);

export function listAccountOptIns(
  clientId: string,
  memberIds: string[] = []
): AccountOptInMethod[] {
  const ids = normalizeIds(clientId, memberIds);
  const rows = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_opt_ins
        WHERE client_id IN (${ids.map(() => "?").join(",")})
        ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'testing' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
                 created_at DESC`
    )
    .all(...ids) as Array<{
    id: string;
    client_id: string;
    name: string;
    channel: string;
    incentive: string;
    destination_list: string;
    conversion_rate: string;
    url: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    channel: r.channel,
    incentive: r.incentive,
    destinationList: r.destination_list,
    conversionRate: r.conversion_rate,
    url: r.url,
    status: OPT_IN_STATUSES.has(r.status as AccountOptInMethod["status"])
      ? (r.status as AccountOptInMethod["status"])
      : "live",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function addAccountOptIn(
  clientId: string,
  input: {
    name: string;
    channel?: string;
    incentive?: string;
    destinationList?: string;
    conversionRate?: string;
    url?: string;
    status?: string;
  }
): AccountOptInMethod | null {
  if (!getRevClient(clientId)) return null;
  const name = (input.name || "").trim();
  if (!name) return null;
  const id = `opt_${nanoid(10)}`;
  const ts = nowIso();
  const status = OPT_IN_STATUSES.has(input.status as AccountOptInMethod["status"])
    ? (input.status as AccountOptInMethod["status"])
    : "live";
  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_opt_ins (
         id, client_id, name, channel, incentive, destination_list, conversion_rate, url, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clientId,
      name,
      (input.channel || "popup").trim(),
      (input.incentive || "").trim(),
      (input.destinationList || "").trim(),
      (input.conversionRate || "").trim(),
      (input.url || "").trim(),
      status,
      ts,
      ts
    );
  return listAccountOptIns(clientId).find((o) => o.id === id) ?? null;
}

export function updateAccountOptIn(
  id: string,
  patch: { status?: string; conversionRate?: string }
): boolean {
  const existing = getDb()
    .prepare(`SELECT status, conversion_rate FROM lifecycle_account_opt_ins WHERE id = ?`)
    .get(id) as { status: string; conversion_rate: string } | undefined;
  if (!existing) return false;
  const status =
    patch.status && OPT_IN_STATUSES.has(patch.status as AccountOptInMethod["status"])
      ? patch.status
      : existing.status;
  const conversionRate =
    patch.conversionRate !== undefined
      ? String(patch.conversionRate).trim()
      : existing.conversion_rate;
  const res = getDb()
    .prepare(
      `UPDATE lifecycle_account_opt_ins
          SET status = ?, conversion_rate = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(status, conversionRate, nowIso(), id);
  return res.changes > 0;
}

export function deleteAccountOptIn(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM lifecycle_account_opt_ins WHERE id = ?`).run(id);
  return res.changes > 0;
}

const CALENDAR_STATUSES = new Set<AccountCalendarItem["status"]>([
  "planned",
  "drafting",
  "in_review",
  "scheduled",
  "sent",
  "completed",
]);

export function listAccountCalendarItems(
  clientId: string,
  memberIds: string[] = [],
  kind?: AccountCalendarKind
): AccountCalendarItem[] {
  const ids = normalizeIds(clientId, memberIds);
  const kindFilter = kind ? `AND calendar_kind = ?` : "";
  const params = kind ? [...ids, kind] : ids;
  const rows = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_calendar_items
        WHERE client_id IN (${ids.map(() => "?").join(",")}) ${kindFilter}
        ORDER BY (planned_date = '') ASC, planned_date ASC, created_at ASC`
    )
    .all(...params) as Array<{
    id: string;
    client_id: string;
    calendar_kind: string;
    title: string;
    planned_date: string;
    audience_or_target: string;
    offer_or_variable: string;
    status: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    calendarKind: r.calendar_kind === "testing" ? "testing" : "campaign",
    title: r.title,
    plannedDate: r.planned_date,
    audienceOrTarget: r.audience_or_target,
    offerOrVariable: r.offer_or_variable,
    status: CALENDAR_STATUSES.has(r.status as AccountCalendarItem["status"])
      ? (r.status as AccountCalendarItem["status"])
      : "planned",
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function addAccountCalendarItem(
  clientId: string,
  input: {
    calendarKind: AccountCalendarKind;
    title: string;
    plannedDate?: string;
    audienceOrTarget?: string;
    offerOrVariable?: string;
    status?: string;
    notes?: string;
  }
): AccountCalendarItem | null {
  if (!getRevClient(clientId)) return null;
  const title = (input.title || "").trim();
  if (!title) return null;
  const calendarKind: AccountCalendarKind =
    input.calendarKind === "testing" ? "testing" : "campaign";
  const status = CALENDAR_STATUSES.has(input.status as AccountCalendarItem["status"])
    ? (input.status as AccountCalendarItem["status"])
    : "planned";
  const id = `cal_${nanoid(10)}`;
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_calendar_items (
         id, client_id, calendar_kind, title, planned_date,
         audience_or_target, offer_or_variable, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clientId,
      calendarKind,
      title,
      (input.plannedDate || "").trim(),
      (input.audienceOrTarget || "").trim(),
      (input.offerOrVariable || "").trim(),
      status,
      (input.notes || "").trim(),
      ts,
      ts
    );
  return listAccountCalendarItems(clientId, [], calendarKind).find((i) => i.id === id) ?? null;
}

export function updateAccountCalendarItemStatus(id: string, status: string): boolean {
  if (!CALENDAR_STATUSES.has(status as AccountCalendarItem["status"])) return false;
  const res = getDb()
    .prepare(
      `UPDATE lifecycle_account_calendar_items SET status = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, nowIso(), id);
  return res.changes > 0;
}

export function deleteAccountCalendarItem(id: string): boolean {
  const res = getDb()
    .prepare(`DELETE FROM lifecycle_account_calendar_items WHERE id = ?`)
    .run(id);
  return res.changes > 0;
}

const AB_WINNERS = new Set<AccountAbTest["winner"]>([
  "pending",
  "a",
  "b",
  "tie",
  "inconclusive",
]);
const AB_STATUSES = new Set<AccountAbTest["status"]>(["idea", "running", "completed"]);

export function listAccountAbTests(clientId: string, memberIds: string[] = []): AccountAbTest[] {
  const ids = normalizeIds(clientId, memberIds);
  const rows = getDb()
    .prepare(
      `SELECT * FROM lifecycle_account_ab_tests
        WHERE client_id IN (${ids.map(() => "?").join(",")})
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'idea' THEN 1 ELSE 2 END,
                 (tested_on = '') ASC, tested_on DESC, created_at DESC`
    )
    .all(...ids) as Array<{
    id: string;
    client_id: string;
    title: string;
    campaign_or_flow: string;
    variable: string;
    hypothesis: string;
    variant_a: string;
    variant_b: string;
    metric: string;
    result_a: string;
    result_b: string;
    winner: string;
    takeaway: string;
    tested_on: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    campaignOrFlow: r.campaign_or_flow,
    variable: r.variable,
    hypothesis: r.hypothesis,
    variantA: r.variant_a,
    variantB: r.variant_b,
    metric: r.metric,
    resultA: r.result_a,
    resultB: r.result_b,
    winner: AB_WINNERS.has(r.winner as AccountAbTest["winner"])
      ? (r.winner as AccountAbTest["winner"])
      : "pending",
    takeaway: r.takeaway,
    testedOn: r.tested_on,
    status: AB_STATUSES.has(r.status as AccountAbTest["status"])
      ? (r.status as AccountAbTest["status"])
      : "running",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function addAccountAbTest(
  clientId: string,
  input: {
    title: string;
    campaignOrFlow?: string;
    variable?: string;
    hypothesis?: string;
    variantA?: string;
    variantB?: string;
    metric?: string;
    resultA?: string;
    resultB?: string;
    winner?: string;
    takeaway?: string;
    testedOn?: string;
    status?: string;
  }
): AccountAbTest | null {
  if (!getRevClient(clientId)) return null;
  const title = (input.title || "").trim();
  if (!title) return null;
  const id = `abt_${nanoid(10)}`;
  const ts = nowIso();
  const winner = AB_WINNERS.has(input.winner as AccountAbTest["winner"])
    ? (input.winner as AccountAbTest["winner"])
    : "pending";
  const status = AB_STATUSES.has(input.status as AccountAbTest["status"])
    ? (input.status as AccountAbTest["status"])
    : winner !== "pending"
      ? "completed"
      : "running";

  getDb()
    .prepare(
      `INSERT INTO lifecycle_account_ab_tests (
         id, client_id, title, campaign_or_flow, variable, hypothesis,
         variant_a, variant_b, metric, result_a, result_b,
         winner, takeaway, tested_on, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clientId,
      title,
      (input.campaignOrFlow || "").trim(),
      (input.variable || "subject_line").trim(),
      (input.hypothesis || "").trim(),
      (input.variantA || "").trim(),
      (input.variantB || "").trim(),
      (input.metric || "open_rate").trim(),
      (input.resultA || "").trim(),
      (input.resultB || "").trim(),
      winner,
      (input.takeaway || "").trim(),
      (input.testedOn || "").trim(),
      status,
      ts,
      ts
    );

  return listAccountAbTests(clientId).find((t) => t.id === id) ?? null;
}

export function updateAccountAbTest(
  id: string,
  patch: {
    resultA?: string;
    resultB?: string;
    winner?: string;
    takeaway?: string;
    status?: string;
  }
): AccountAbTest | null {
  const existing = getDb()
    .prepare(`SELECT * FROM lifecycle_account_ab_tests WHERE id = ?`)
    .get(id) as
    | {
        id: string;
        client_id: string;
        result_a: string;
        result_b: string;
        winner: string;
        takeaway: string;
        status: string;
      }
    | undefined;
  if (!existing) return null;

  const winner =
    patch.winner && AB_WINNERS.has(patch.winner as AccountAbTest["winner"])
      ? patch.winner
      : existing.winner;
  const status =
    patch.status && AB_STATUSES.has(patch.status as AccountAbTest["status"])
      ? patch.status
      : winner !== "pending" && existing.status === "running"
        ? "completed"
        : existing.status;
  const resultA =
    patch.resultA !== undefined ? String(patch.resultA).trim() : existing.result_a;
  const resultB =
    patch.resultB !== undefined ? String(patch.resultB).trim() : existing.result_b;
  const takeaway =
    patch.takeaway !== undefined ? String(patch.takeaway).trim() : existing.takeaway;

  getDb()
    .prepare(
      `UPDATE lifecycle_account_ab_tests
          SET result_a = ?, result_b = ?, winner = ?, takeaway = ?, status = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(resultA, resultB, winner, takeaway, status, nowIso(), id);

  return listAccountAbTests(existing.client_id).find((t) => t.id === id) ?? null;
}

export function deleteAccountAbTest(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM lifecycle_account_ab_tests WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function buildAccountPlaybook(
  clientId: string,
  memberIds: string[] = []
): AccountPlaybook {
  const calendar = listAccountCalendarItems(clientId, memberIds);
  return {
    clientId,
    brand: getAccountBrandGuidelines(clientId, memberIds),
    icps: listAccountIcps(clientId, memberIds),
    offers: listAccountOffers(clientId, memberIds),
    optIns: listAccountOptIns(clientId, memberIds),
    campaignCalendar: calendar.filter((c) => c.calendarKind === "campaign"),
    testingCalendar: calendar.filter((c) => c.calendarKind === "testing"),
    abTests: listAccountAbTests(clientId, memberIds),
  };
}
