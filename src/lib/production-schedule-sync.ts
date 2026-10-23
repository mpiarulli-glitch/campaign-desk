// Put Campaign Desk productions on the Video Editing Team Basecamp schedule,
// and read that schedule back when someone is offered a shoot time.
//
// Nothing here runs at startup. Booking, reschedule, cancel, the admin
// "add missing shoots" action, and the reminders cron call in. Reads are
// cached for a minute so a scheduling page does not walk Basecamp every time.
// If Basecamp cannot be read, the slot is not offered and the admin is told.

import { getAppUrl } from "./auth";
import {
  SERVICE,
  basecampConnected,
  createScheduleEntryOnSchedule,
  getProjectPeople,
  listScheduleEntriesStrict,
  trashRecording,
  updateScheduleEntry,
  type ProductionScheduleWrite,
} from "./basecamp";
import { APP_TIME_ZONE, appDateTime } from "./cadence";
import { PRODUCTION_PREDICATE, getSend } from "./calendar";
import { getDb, nowIso, type ScheduledSend } from "./db";
import { clearFailure, recordFailure } from "./failures";
import { parseProductionBrief } from "./production-brief";
import {
  PRODUCTION_SCHEDULE_ID,
  VIDEO_EDITING_PROJECT_ID,
  blockedSlotsForVideographer,
  buildProductionScheduleContent,
  namesMatch,
  parseScheduleEntry,
  slotIsBlocked,
  type ProductionScheduleEntry,
  type ScheduleBlocks,
} from "./production-schedule";
import { BOOKING_SLOTS } from "./scheduling-rules";
import { getRevClient } from "./revenue";
import { listVideographers } from "./videographers";

export const SCHEDULE_CACHE_MS = 60_000;
const ERROR_CACHE_MS = 15_000;
const PEOPLE_CACHE_MS = 10 * 60 * 1000;
const FAILURE_KIND = "basecamp_schedule" as const;
const FAILURE_SUBJECT = "Production schedule";

export const SCHEDULE_UNREACHABLE_ADMIN =
  "Couldn't reach Basecamp, so this videographer's schedule wasn't checked. Nothing was booked. Reconnect the King Kashflow service account and try again.";

export const SCHEDULE_UNREACHABLE_CLIENT =
  "We couldn't confirm the crew's calendar. Please try again in a few minutes.";

export const SCHEDULE_CONFLICT_ADMIN =
  "That time isn't available. This videographer is already on a shoot or out of office on the Basecamp production schedule.";

export const SCHEDULE_CONFLICT_CLIENT =
  "That time isn't available. Please pick another — the crew is already booked or out of office.";

type ListResult =
  | { ok: true; entries: unknown[]; totalCount: number }
  | { ok: false; error: string };

export interface ScheduleGateway {
  connected: () => boolean;
  listEntries: () => Promise<ListResult>;
  listPeople: () => Promise<{ id: number; name: string }[]>;
  create: (
    body: ProductionScheduleWrite
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  update: (
    id: string,
    body: ProductionScheduleWrite
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string; missing?: boolean }>;
  trash: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

const defaultGateway: ScheduleGateway = {
  connected: () => basecampConnected(),
  listEntries: () => listScheduleEntriesStrict(PRODUCTION_SCHEDULE_ID, 12, SERVICE),
  async listPeople() {
    const people = await getProjectPeople(VIDEO_EDITING_PROJECT_ID, SERVICE);
    return people.map((person) => ({ id: person.id, name: person.name }));
  },
  create: (body) => createScheduleEntryOnSchedule(PRODUCTION_SCHEDULE_ID, body, SERVICE),
  update: (id, body) => updateScheduleEntry(id, body, SERVICE),
  trash: (id) => trashRecording(VIDEO_EDITING_PROJECT_ID, id, SERVICE),
};

let gatewayOverride: Partial<ScheduleGateway> | null = null;
let entryCache:
  | { ok: true; entries: ProductionScheduleEntry[]; at: number }
  | { ok: false; error: string; at: number }
  | null = null;
let peopleCache: { at: number; people: { id: number; name: string }[] } | null = null;

export function resetProductionScheduleForTests(): void {
  gatewayOverride = null;
  entryCache = null;
  peopleCache = null;
}

export function setProductionScheduleGatewayForTests(
  gateway: Partial<ScheduleGateway> | null
): void {
  gatewayOverride = gateway;
  entryCache = null;
  peopleCache = null;
}

function gateway(): ScheduleGateway {
  return { ...defaultGateway, ...gatewayOverride };
}

export function isProductionRow(
  send: Pick<ScheduledSend, "requested_by_client" | "production_brief">
): boolean {
  return send.requested_by_client === 1 || parseProductionBrief(send.production_brief) !== null;
}

function noteFailure(detail: string, hint: string, subject = FAILURE_SUBJECT): void {
  recordFailure({
    kind: FAILURE_KIND,
    subject,
    detail,
    hint,
  });
}

async function loadEntries(): Promise<
  { ok: true; entries: ProductionScheduleEntry[] } | { ok: false; error: string }
> {
  const now = Date.now();
  if (entryCache?.ok && now - entryCache.at < SCHEDULE_CACHE_MS) {
    return { ok: true, entries: entryCache.entries };
  }
  if (entryCache && !entryCache.ok && now - entryCache.at < ERROR_CACHE_MS) {
    return { ok: false, error: entryCache.error };
  }
  const gw = gateway();
  if (!gw.connected()) {
    entryCache = { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, at: now };
    return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN };
  }
  try {
    const listed = await gw.listEntries();
    if (!listed.ok) {
      entryCache = { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, at: now };
      return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN };
    }
    if (listed.totalCount > 0 && listed.entries.length === 0) {
      entryCache = { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, at: now };
      return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN };
    }
    const entries = listed.entries
      .map((entry) => parseScheduleEntry(entry))
      .filter((entry): entry is ProductionScheduleEntry => entry !== null);
    entryCache = { ok: true, entries, at: now };
    return { ok: true, entries };
  } catch {
    entryCache = { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, at: now };
    return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN };
  }
}

async function loadPeople(): Promise<{ id: number; name: string }[]> {
  const now = Date.now();
  if (peopleCache && now - peopleCache.at < PEOPLE_CACHE_MS) return peopleCache.people;
  try {
    const people = await gateway().listPeople();
    peopleCache = { at: now, people };
    return people;
  } catch {
    return peopleCache?.people || [];
  }
}

function matchPersonId(
  name: string,
  roster: { id: number; name: string }[]
): number | null {
  const exact = roster.filter(
    (person) => person.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (exact.length === 1) return exact[0].id;
  const hits = roster.filter((person) => namesMatch(person.name, name));
  return hits.length === 1 ? hits[0].id : null;
}

function videographerName(videographerId: string): string {
  if (!videographerId) return "";
  const row = listVideographers(true).find((person) => person.id === videographerId);
  return row?.name || "";
}

function allVideographerNames(): string[] {
  return listVideographers(true).map((person) => person.name).filter(Boolean);
}

function allBlocked(dates: string[]): ScheduleBlocks {
  return {
    blockedHalfSlots: dates.flatMap((date) =>
      BOOKING_SLOTS.map((slot) => `${date}|${slot}`)
    ),
    blockedFullDays: [...dates],
  };
}

export async function readVideographerBlocks(input: {
  videographerId: string;
  dates: string[];
  excludeEntryId?: string;
}): Promise<{ ok: true; blocks: ScheduleBlocks } | { ok: false; error: string; blocks: ScheduleBlocks }> {
  const dates = [...new Set(input.dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const name = videographerName(input.videographerId);
  if (!name || !dates.length) return { ok: true, blocks: { blockedHalfSlots: [], blockedFullDays: [] } };
  const loaded = await loadEntries();
  if (!loaded.ok) {
    noteFailure(
      SCHEDULE_UNREACHABLE_ADMIN,
      "Reconnect the King Kashflow service account, then open Productions and add any missing shoots to the Basecamp schedule."
    );
    return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, blocks: allBlocked(dates) };
  }
  const roster = await loadPeople();
  const blocks = blockedSlotsForVideographer({
    entries: loaded.entries,
    videographerName: name,
    personId: matchPersonId(name, roster),
    allVideographerNames: allVideographerNames(),
    dates,
    excludeEntryId: input.excludeEntryId,
    timeZone: APP_TIME_ZONE,
  });
  clearFailure(FAILURE_KIND, FAILURE_SUBJECT);
  return { ok: true, blocks };
}

export async function videographerScheduleConflict(input: {
  videographerId: string;
  date: string;
  time: string;
  duration: "half" | "full";
  today: string;
  audience: "admin" | "client";
  excludeEntryId?: string;
}): Promise<{ ok: true } | { ok: false; httpStatus: number; error: string }> {
  if (!input.videographerId || !input.date || input.date < input.today) return { ok: true };
  const read = await readVideographerBlocks({
    videographerId: input.videographerId,
    dates: [input.date],
    excludeEntryId: input.excludeEntryId,
  });
  if (!read.ok) {
    return {
      ok: false,
      httpStatus: 503,
      error: input.audience === "admin" ? SCHEDULE_UNREACHABLE_ADMIN : SCHEDULE_UNREACHABLE_CLIENT,
    };
  }
  if (slotIsBlocked(read.blocks, input.date, input.time, input.duration)) {
    return {
      ok: false,
      httpStatus: 409,
      error: input.audience === "admin" ? SCHEDULE_CONFLICT_ADMIN : SCHEDULE_CONFLICT_CLIENT,
    };
  }
  return { ok: true };
}

function campaignForSend(sendId: string): { id: string; title: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, title FROM campaigns
       WHERE scheduled_send_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(sendId) as { id: string; title: string } | undefined;
  return row || null;
}

async function entryBody(send: ScheduledSend): Promise<ProductionScheduleWrite> {
  const client = send.client_id ? getRevClient(send.client_id) : null;
  const names: string[] = [];
  const participantIds: number[] = [];
  const videographerId = client?.videographer_id || "";
  const name = videographerName(videographerId);
  if (name) {
    names.push(name);
    const personId = matchPersonId(name, await loadPeople());
    if (personId != null) participantIds.push(personId);
    else if (gateway().connected()) {
      noteFailure(
        `${name} is assigned to ${send.client_name || "a production"}, but no Basecamp person on the Video Editing Team matches that name.`,
        "Use the same name on the videographer and their Basecamp profile, then sync the production schedule again.",
        send.client_name || name
      );
    }
  }
  const brief = parseProductionBrief(send.production_brief);
  const campaign = campaignForSend(send.id);
  const appUrl = getAppUrl();
  const content = buildProductionScheduleContent({
    clientName: send.client_name || client?.name || "Production",
    duration: send.duration,
    location: brief?.locations || "",
    date: send.send_date,
    time: send.send_time,
    productionUrl: `${appUrl}/admin/production/${send.id}`,
    campaignUrl: campaign ? `${appUrl}/admin/campaigns/${campaign.id}` : "",
    campaignTitle: campaign?.title || "",
    videographerNames: names,
    timeZone: APP_TIME_ZONE,
  });
  return {
    summary: content.summary,
    startsAt: content.startsAt,
    endsAt: content.endsAt,
    allDay: content.allDay,
    description: content.description,
    participantIds,
  };
}

function claimEntryId(sendId: string, entryId: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE scheduled_sends
       SET basecamp_schedule_entry_id = ?, updated_at = ?
       WHERE id = ? AND TRIM(IFNULL(basecamp_schedule_entry_id, '')) = ''`
    )
    .run(entryId, nowIso(), sendId);
  return result.changes > 0;
}

function clearEntryId(sendId: string, entryId: string): void {
  getDb()
    .prepare(
      `UPDATE scheduled_sends
       SET basecamp_schedule_entry_id = '', updated_at = ?
       WHERE id = ? AND basecamp_schedule_entry_id = ?`
    )
    .run(nowIso(), sendId, entryId);
}

export interface ScheduleSyncResult {
  ok: boolean;
  skipped?: boolean;
  entryId?: string;
  error?: string;
}

export async function syncProductionScheduleEntry(sendId: string): Promise<ScheduleSyncResult> {
  const send = getSend(sendId);
  if (!send || !isProductionRow(send)) return { ok: true, skipped: true };
  const subject = send.client_name || "Production";
  if (send.cancelled_at) return trashStoredEntry(send, subject);

  const existing = (send.basecamp_schedule_entry_id || "").trim();
  const today = appDateTime().date;
  if (send.send_date < today && !existing) return { ok: true, skipped: true };
  if (!gateway().connected()) {
    noteFailure(
      `Couldn't add ${subject} on ${send.send_date} to the Basecamp production schedule. ${SCHEDULE_UNREACHABLE_ADMIN}`,
      "Reconnect the King Kashflow service account, then use Add shoots to Basecamp on Productions.",
      subject
    );
    return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN };
  }

  let body: ProductionScheduleWrite;
  try {
    body = await entryBody(send);
  } catch (err) {
    const error = (err as Error).message || "Could not build the schedule entry.";
    noteFailure(error, "Try the sync again from Productions.", subject);
    return { ok: false, error };
  }

  const gw = gateway();
  if (existing) {
    const updated = await gw.update(existing, body);
    if (updated.ok) {
      clearFailure(FAILURE_KIND, subject);
      return { ok: true, entryId: existing };
    }
    if (!updated.missing) {
      noteFailure(
        updated.error || `Couldn't update the Basecamp entry for ${subject}.`,
        "Open the production schedule in Basecamp and update the entry, or sync again.",
        subject
      );
      return { ok: false, error: updated.error, entryId: existing };
    }
    clearEntryId(send.id, existing);
  }

  if (send.send_date < today) return { ok: true, skipped: true };
  const created = await gw.create(body);
  if (!created.ok) {
    noteFailure(
      created.error || `Couldn't add ${subject} to the Basecamp production schedule.`,
      "Use Add shoots to Basecamp on Productions once Basecamp is reachable.",
      subject
    );
    return { ok: false, error: created.error };
  }
  if (!claimEntryId(send.id, created.id)) {
    const current = (getSend(send.id)?.basecamp_schedule_entry_id || "").trim();
    if (current && current !== created.id) {
      await gw.trash(created.id);
      const updated = await gw.update(current, body);
      if (!updated.ok && !updated.missing) {
        return { ok: false, error: updated.error, entryId: current };
      }
      return { ok: true, entryId: current };
    }
  }
  clearFailure(FAILURE_KIND, subject);
  return { ok: true, entryId: created.id };
}

async function trashStoredEntry(
  send: ScheduledSend,
  subject: string
): Promise<ScheduleSyncResult> {
  const entryId = (send.basecamp_schedule_entry_id || "").trim();
  if (!entryId) return { ok: true, skipped: true };
  if (!gateway().connected()) {
    noteFailure(
      `Couldn't remove ${subject} from the Basecamp production schedule. ${SCHEDULE_UNREACHABLE_ADMIN}`,
      "Trash that schedule entry in Basecamp, or cancel again after reconnecting.",
      subject
    );
    return { ok: false, error: SCHEDULE_UNREACHABLE_ADMIN, entryId };
  }
  const trashed = await gateway().trash(entryId);
  if (!trashed.ok) {
    noteFailure(
      trashed.error || `Couldn't trash the Basecamp entry for ${subject}.`,
      "Trash the entry on the Video Editing Team production schedule.",
      subject
    );
    return { ok: false, error: trashed.error, entryId };
  }
  clearFailure(FAILURE_KIND, subject);
  return { ok: true, entryId };
}

export interface BackfillResult {
  ok: boolean;
  created: number;
  failed: number;
  skipped: number;
  error: string | null;
}

export async function backfillProductionSchedule(
  today = appDateTime().date
): Promise<BackfillResult> {
  const rows = getDb()
    .prepare(
      `SELECT id FROM scheduled_sends
       WHERE cancelled_at IS NULL
         AND send_date >= ?
         AND TRIM(IFNULL(basecamp_schedule_entry_id, '')) = ''
         AND ${PRODUCTION_PREDICATE}
       ORDER BY send_date ASC, send_time ASC`
    )
    .all(today) as { id: string }[];
  if (!rows.length) return { ok: true, created: 0, failed: 0, skipped: 0, error: null };
  if (!gateway().connected()) {
    return {
      ok: false,
      created: 0,
      failed: 0,
      skipped: rows.length,
      error: SCHEDULE_UNREACHABLE_ADMIN,
    };
  }
  let created = 0;
  let failed = 0;
  let skipped = 0;
  let error: string | null = null;
  for (const row of rows) {
    const result = await syncProductionScheduleEntry(row.id);
    if (result.skipped) skipped += 1;
    else if (result.ok && result.entryId) created += 1;
    else if (result.ok) skipped += 1;
    else {
      failed += 1;
      error = error || result.error || "A production could not be added to Basecamp.";
    }
  }
  return { ok: failed === 0, created, failed, skipped, error };
}

