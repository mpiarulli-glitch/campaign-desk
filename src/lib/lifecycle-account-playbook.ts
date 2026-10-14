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

function seedSwingInn(clientId: string): void {
  const client = getRevClient(clientId);
  if (!client || !/swing inn/i.test(client.name)) return;
  const existing = getAccountBrandGuidelines(clientId);
  if (existing.voiceTone.trim() || listAccountIcps(clientId).length) return;

  saveAccountBrandGuidelines(clientId, {
    voiceTone:
      "Fun, bold, a little larger-than-life. Hollywood personality meets Texas pitmaster. Warm and welcoming, never stiff or corporate.",
    colors: "#D24719  ·  #000000",
    fonts: "Swing Inn mark. Real photography of Dean, the smoker, the 1927 counter, and the Old Town sign.",
    senderName: "Swing Inn Cafe & BBQ",
    replyToEmail: "",
    logoAssetsUrl: "https://swinginncafe.com",
    dosAndDonts:
      "Meeting Dean is for customers — say so plainly, and never promise he is there beyond a confirmed Dean Day. Every call to action captures an email or phone number first. Do not ask people only to follow. Review requests are never incentivized. Free cinnamon roll is one per person, with an entrée, redeemed by showing the email at the register. SMS goes only to opted-in contacts, with STOP and HELP. Client-facing creative uses Swing Inn red and black, not Marketing Empire Group branding. Giveaway rules include no-purchase-necessary language.",
    footerNotes:
      "Swing Inn Cafe & BBQ · Old Town Temecula. Giveaway official rules required. Dean’s likeness and the cardboard cutout need client approval before they go out.",
  });

  const icps = [
    ["Weekend visitors from LA, OC, and SD", "The drive into Old Town needs a reason to stop.", "A meal worth posting, and maybe Dean in the room.", "Dean might not be there, and Old Town has plenty of other doors.", "A TikTok, a Google Maps search on the drive, or a Dean Days alert.", "Swing Inn is the Old Town stop you’ll post about — and this month you could win dinner with Dean."],
    ["Local regulars", "The first visit doesn’t give them a reason to come back.", "A place that still feels like theirs when the hype shows up.", "It can feel like a tourist stop.", "A Dean Day on the calendar, or a welcome offer they can actually use.", "Come back for the plate, not the viral clip."],
    ["Dean fans", "They want a real connection, not a sighting from the sidewalk.", "Dinner with Dean, a photo, something signed.", "No guarantee he is working the room.", "The monthly dinner prize, or a confirmed Dean Day.", "Meeting Dean is for customers. Grab a plate and come say hi."],
    ["BBQ people", "A lot of places claim craft without the pit.", "Award-caliber Texas BBQ, brisket sliced in front of them.", "Another Old Town option that looks the same online.", "Pitmaster credibility in the content.", "A 1927 diner and a real smoker, not a themed restaurant."],
    ["Catering buyers", "An event has to run smoothly, especially with a famous name attached.", "A memorable, reliable event.", "They need confidence on date, headcount, and follow-through.", "A holiday, a company dinner, a gathering that should be talked about.", "Celebrity-owned catering that still shows up like a working BBQ house."],
  ] as const;
  for (const [name, painPoints, desires, objections, triggers, messagingAngle] of icps) {
    addAccountIcp(clientId, { name, painPoints, desires, objections, triggers, messagingAngle });
  }

  addAccountOffer(clientId, {
    name: "Win Dinner with Dean",
    offerType: "seasonal",
    details:
      "Monthly giveaway. Entries reset each month. 1st: dinner for up to 4, a photo with Dean, and an autographed item. 2nd: $100 gift card. 3rd: $50 gift card. Enter, then visit, then upload a Cardboard Dean selfie and a receipt for bonus entries.",
    status: "active",
  });
  addAccountOffer(clientId, {
    name: "Free cinnamon roll",
    offerType: "lead_magnet",
    details:
      "Every signup on the website or SweepWidget gets one free cinnamon roll. One per person, with the purchase of an entrée. Redeem by showing the email at the register.",
    status: "active",
  });
  addAccountOffer(clientId, {
    name: "Dean Days",
    offerType: "core",
    details:
      "Dean is home all of October. Meeting him is for customers. First confirmed day is Saturday, October 10. Copy states his hours and never extends the promise past a confirmed date.",
    status: "active",
  });
  addAccountOffer(clientId, {
    name: "Catering",
    offerType: "core",
    details:
      "Expansion offer. Celebrity-owned catering for a memorable, reliable event. Holiday catering belongs on the Q4 calendar.",
    status: "upcoming",
  });

  addAccountOptIn(clientId, {
    name: "SweepWidget — Win Dinner with Dean",
    channel: "giveaway",
    incentive: "Dinner with Dean, plus gift-card runners-up",
    destinationList: "Giveaway entries, reset monthly",
    conversionRate: "",
    url: "",
    status: "live",
  });
  addAccountOptIn(clientId, {
    name: "Website cinnamon roll signup",
    channel: "embedded_form",
    incentive: "Free cinnamon roll",
    destinationList: "Welcome flow — same offer as SweepWidget",
    url: "https://swinginncafe.com",
    status: "draft",
  });
  addAccountOptIn(clientId, {
    name: "Cardboard Dean QR",
    channel: "landing_page",
    incentive: "Bonus entries for a cutout photo and a receipt",
    destinationList: "SweepWidget upload",
    status: "draft",
  });

  const campaignDays: Array<[string, string, string, string, string]> = [
    ["2026-10-06", "Campaign brief locked", "All departments", "Empire Method brief", "Blueprint approved. Agreement signed October 1."],
    ["2026-10-07", "Dean Days #1 email drafted", "Dean fans and visitors", "Dean Days", "Michael drafts. Alignment call the same day."],
    ["2026-10-08", "Dean Days #1 email sends", "Opted-in email", "Dean will be in the house — grab a plate and come say hi", "Bridget approves Thursday morning. Send the same day."],
    ["2026-10-10", "Dean Days #1", "Customers in the house", "SMS reminder that morning", "Saturday. SMS to opted-in contacts only. Meeting Dean is for customers."],
    ["2026-10-15", "Welcome flow", "Every new signup", "Free cinnamon roll", "Fires for website and SweepWidget signups. How to redeem, then a nudge toward the cutout photo and the receipt."],
    ["2026-10-22", "Giveaway launch email", "Segmented: visitor, local, Dean fan", "Enter to win dinner with Dean", "Not a mass blast. Entries reset monthly."],
    ["2026-10-29", "Winners and re-entry", "Last month’s entrants", "Announce the winner, then ask them to enter again", "Email and SMS."],
  ];
  for (const [plannedDate, title, audienceOrTarget, offerOrVariable, notes] of campaignDays) {
    addAccountCalendarItem(clientId, {
      calendarKind: "campaign",
      title,
      plannedDate,
      audienceOrTarget,
      offerOrVariable,
      notes,
      status: plannedDate <= "2026-10-10" ? "scheduled" : "planned",
    });
  }

  addAccountCalendarItem(clientId, {
    calendarKind: "testing",
    title: "Welcome subject: cinnamon roll vs dinner with Dean",
    plannedDate: "2026-10-15",
    audienceOrTarget: "Welcome email 1",
    offerOrVariable: "Subject line",
    notes: "Which promise gets the open, and which one gets the visit.",
    status: "planned",
  });
}

function addOnce(
  existingTitles: Set<string>,
  title: string,
  add: () => void
) {
  const key = title.trim().toLowerCase();
  if (existingTitles.has(key)) return;
  add();
  existingTitles.add(key);
}

/** Fills any Swing Inn page that is still empty, without duplicating what is already there. */
function completeSwingInn(clientId: string): void {
  const client = getRevClient(clientId);
  if (!client || !/swing inn/i.test(client.name)) return;
  seedSwingInn(clientId);

  const tests = new Set(
    listAccountCalendarItems(clientId, [], "testing").map((item) => item.title.trim().toLowerCase())
  );
  const testRows: Array<[string, string, string, string, string]> = [
    ["2026-10-15", "Welcome subject: cinnamon roll vs dinner with Dean", "Welcome email 1", "Subject line", "Which promise gets the open, and which one gets the visit."],
    ["2026-10-22", "Giveaway CTA: enter to win vs free cinnamon roll", "Giveaway launch", "Call to action", "Every CTA has to capture an email or a phone number first."],
    ["2026-11-05", "Dean Days subject: in the house vs Old Town stop", "Dean Days email", "Subject line", "Copy must say meeting Dean is for customers."],
    ["2026-11-12", "Send time: Thursday midday vs Saturday morning SMS", "Dean Day reminder", "Send time", "SMS only to opted-in contacts."],
  ];
  for (const [plannedDate, title, audienceOrTarget, offerOrVariable, notes] of testRows) {
    addOnce(tests, title, () => {
      addAccountCalendarItem(clientId, {
        calendarKind: "testing",
        title,
        plannedDate,
        audienceOrTarget,
        offerOrVariable,
        notes,
        status: "planned",
      });
    });
  }

  const campaigns = new Set(
    listAccountCalendarItems(clientId, [], "campaign").map((item) => item.title.trim().toLowerCase())
  );
  const moreDays: Array<[string, string, string, string, string]> = [
    ["2026-11-06", "New cutout look", "Past visitors", "Cardboard Dean photo corner", "Bonus entries for the selfie and the receipt."],
    ["2026-11-20", "Post-visit thank you", "People who dined", "Review request, never incentivized", "Automation 2. Ask for the review. Do not attach a prize."],
    ["2026-12-03", "Holiday catering", "Catering buyers", "Celebrity-owned catering", "Q4 push. Follow-up is date, headcount, location, budget, occasion."],
    ["2026-12-10", "60-day win-back", "Quiet contacts", "Birthday perk and a reason to come back", "Automation 3. Segment visitor, local, Dean fan, and catering. No mass blast."],
  ];
  for (const [plannedDate, title, audienceOrTarget, offerOrVariable, notes] of moreDays) {
    addOnce(campaigns, title, () => {
      addAccountCalendarItem(clientId, {
        calendarKind: "campaign",
        title,
        plannedDate,
        audienceOrTarget,
        offerOrVariable,
        notes,
        status: "planned",
      });
    });
  }

  const logged = new Set(listAccountAbTests(clientId).map((test) => test.title.trim().toLowerCase()));
  const testsToLog: Array<Parameters<typeof addAccountAbTest>[1]> = [
    {
      title: "Welcome subject: cinnamon roll vs dinner with Dean",
      campaignOrFlow: "Welcome email 1",
      variable: "subject_line",
      hypothesis: "The dinner prize gets the open. The cinnamon roll gets the visit.",
      variantA: "Your free cinnamon roll is waiting in Old Town",
      variantB: "This month, you could win dinner with Dean",
      metric: "conversion_rate",
      status: "idea",
      testedOn: "2026-10-15",
    },
    {
      title: "Giveaway CTA: enter to win vs free cinnamon roll",
      campaignOrFlow: "Giveaway launch",
      variable: "cta",
      hypothesis: "Leading with the cinnamon roll captures more emails than leading with the prize.",
      variantA: "Enter to win dinner with Dean",
      variantB: "Sign up, get a free cinnamon roll, and enter to win",
      metric: "conversion_rate",
      status: "idea",
      testedOn: "2026-10-22",
    },
    {
      title: "Dean Days subject: in the house vs Old Town stop",
      campaignOrFlow: "Dean Days",
      variable: "subject_line",
      hypothesis: "Saying Dean is in the house outperforms a generic Old Town invitation, as long as the copy says the visit is for customers.",
      variantA: "Dean will be in the house Saturday. Grab a plate and come say hi.",
      variantB: "Swing Inn is the Old Town stop you’ll post about",
      metric: "open_rate",
      status: "idea",
      testedOn: "2026-11-05",
    },
    {
      title: "Dean Day reminder: Thursday email vs Saturday SMS",
      campaignOrFlow: "Dean Days reminder",
      variable: "send_time",
      hypothesis: "The Saturday-morning SMS brings more of the opted-in list through the door than another Thursday email.",
      variantA: "Thursday email, day before is too early for a drive from LA",
      variantB: "Saturday morning SMS to opted-in contacts only",
      metric: "conversion_rate",
      status: "idea",
      testedOn: "2026-11-12",
    },
  ];
  for (const input of testsToLog) {
    addOnce(logged, input.title, () => {
      addAccountAbTest(clientId, input);
    });
  }
}

export function buildAccountPlaybook(
  clientId: string,
  memberIds: string[] = []
): AccountPlaybook {
  completeSwingInn(clientId);
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
