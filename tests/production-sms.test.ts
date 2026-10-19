import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizePhoneE164 } from "../src/lib/phone";
import {
  PRODUCTION_SMS_EVENTS,
  productionNoticeSendsSms,
  scheduleNudgeSmsBody,
  type ProductionNotice,
} from "../src/lib/production-sms";

const SMS_SOURCES = [
  "src/lib/extra-requests.ts",
  "src/lib/reminders.ts",
];

const NEVER_TEXT = [
  "src/lib/production-emails.ts",
  "src/lib/scheduling.ts",
  "src/lib/missed-production-window.ts",
  "src/app/api/cron/renotify/route.ts",
  "src/app/api/calendar/[id]/route.ts",
  "src/app/api/crew/[token]/approve/route.ts",
];

test("only the scheduling nudges are allowed to text", () => {
  const on = (Object.keys(PRODUCTION_SMS_EVENTS) as ProductionNotice[]).filter(
    (notice) => productionNoticeSendsSms(notice)
  );
  assert.deepEqual(on.sort(), ["cadence_reminder", "extra_invite", "first_invite"]);
  for (const notice of [
    "request_received",
    "confirmed",
    "renotify",
    "missed_window",
  ] as const) {
    assert.equal(productionNoticeSendsSms(notice), false);
  }

  const root = process.cwd();
  const callers = new Set<string>();
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
      const rel = path.relative(root, full);
      if (rel === "src/lib/production-sms.ts") continue;
      if (rel.startsWith("tests/")) continue;
      const text = fs.readFileSync(full, "utf8");
      if (text.includes("sendScheduleNudgeSms")) callers.add(rel);
    }
  }
  walk(path.join(root, "src"));
  assert.deepEqual([...callers].sort(), [...SMS_SOURCES].sort());

  for (const rel of NEVER_TEXT) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(text.includes("production-sms"), false, rel);
    assert.equal(text.includes("sendScheduleNudgeSms"), false, rel);
  }

  const sampleRoute = fs.readFileSync(
    path.join(root, "src/app/api/production/sms-sample/route.ts"),
    "utf8"
  );
  assert.match(sampleRoute, /sendSampleScheduleSms/);
  assert.equal(/if\s*\(\s*!?\s*scheduleSmsEnabled\s*\(/.test(sampleRoute), false);
  const desk = fs.readFileSync(
    path.join(root, "src/app/admin/production/page.tsx"),
    "utf8"
  );
  assert.match(desk, /\/api\/production\/sms-sample/);
});

test("phone numbers are stored as E.164", () => {
  assert.equal(normalizePhoneE164("(415) 555-0134"), "+14155550134");
  assert.equal(normalizePhoneE164("415.555.0134"), "+14155550134");
  assert.equal(normalizePhoneE164("14155550134"), "+14155550134");
  assert.equal(normalizePhoneE164("+1 415 555 0134"), "+14155550134");
  assert.equal(normalizePhoneE164("+14155550134"), "+14155550134");
  assert.equal(normalizePhoneE164("4155550134 x12"), "+14155550134");
  assert.equal(normalizePhoneE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhoneE164(""), null);
  assert.equal(normalizePhoneE164("555-0134"), null);
  assert.equal(normalizePhoneE164("not a phone"), null);
  assert.equal(normalizePhoneE164("+1 415"), null);
});

test("the sample link opens the scheduling page and cannot book anyone", async () => {
  const { sampleSchedulePreview } = await import("../src/lib/scheduling");
  const { SAMPLE_SCHEDULE_TOKEN } = await import("../src/lib/production-sms");
  assert.equal(SAMPLE_SCHEDULE_TOKEN, "sample");
  const preview = sampleSchedulePreview(new Date("2026-10-19T18:00:00Z"));
  assert.equal(preview.testLink, true);
  assert.equal(preview.status, "due");
  assert.equal(preview.client.name, "Test link");
  assert.ok(preview.window);
  const [y, m, d] = preview.window.start.split("-").map(Number);
  assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 1);
  assert.equal(
    preview.window.end,
    new Date(Date.UTC(y, m - 1, d + 4)).toISOString().slice(0, 10)
  );
  assert.ok(preview.window.start > preview.today);
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/schedule/[token]/route.ts"),
    "utf8"
  );
  assert.match(route, /SAMPLE_SCHEDULE_TOKEN/);
  assert.match(route, /Nothing was booked/);
});

test("scheduling texts mirror the email and stay short", () => {
  const url = "https://desk.example/schedule/abc123";
  const next = scheduleNudgeSmsBody({
    kind: "cadence_reminder",
    contactName: "Jamie Lee",
    url,
  });
  assert.equal(
    next,
    `Hi Jamie, it's time to book your next MEG production. Pick a time here: ${url}`
  );
  const first = scheduleNudgeSmsBody({
    kind: "first_invite",
    contactName: "Jamie",
    url,
  });
  assert.match(first, /your first MEG production/);
  const extra = scheduleNudgeSmsBody({
    kind: "extra_invite",
    contactName: "Jamie",
    url,
  });
  assert.match(extra, /book a MEG production/);
  assert.equal(
    scheduleNudgeSmsBody({ kind: "cadence_reminder", contactName: "", url }),
    `Hi, it's time to book your next MEG production. Pick a time here: ${url}`
  );
  assert.equal(
    scheduleNudgeSmsBody({
      kind: "cadence_reminder",
      contactName: "jamie@client.com",
      url,
    }).startsWith("Hi,"),
    true
  );
  for (const body of [next, first, extra]) {
    assert.ok(body.length <= 300, body);
  }
  const huge = scheduleNudgeSmsBody({
    kind: "cadence_reminder",
    contactName: "Alexandria",
    url: `https://desk.example/schedule/${"a".repeat(400)}`,
  });
  assert.ok(huge.length <= 300);
  assert.ok(huge.includes("https://desk.example/schedule/"));
});

test("texts fall back, dedupe, and never throw when the send fails", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-sms-"));
  const originalCwd = process.cwd();
  const env = {
    enabled: process.env.PRODUCTION_SMS_ENABLED,
    location: process.env.PRODUCTION_SMS_LOCATION_ID,
  };
  process.chdir(tmp);
  const { closeDbForTests, getDb } = await import("../src/lib/db");
  closeDbForTests();
  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    if (env.enabled === undefined) delete process.env.PRODUCTION_SMS_ENABLED;
    else process.env.PRODUCTION_SMS_ENABLED = env.enabled;
    if (env.location === undefined) delete process.env.PRODUCTION_SMS_LOCATION_ID;
    else process.env.PRODUCTION_SMS_LOCATION_ID = env.location;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const sms = await import("../src/lib/production-sms");
  const { createRevClient, updateRevClient, getRevClient } = await import(
    "../src/lib/revenue"
  );
  const client = createRevClient({ name: "Sample Co", businessModel: "home_service" });
  const saved = updateRevClient(client.id, {
    contactName: "Jamie Lee",
    contactPhone: "(415) 555-0134",
  });
  assert.equal(saved?.contact_phone, "+14155550134");
  assert.throws(
    () => updateRevClient(client.id, { contactPhone: "555-0134" }),
    /area code/
  );
  assert.equal(getRevClient(client.id)?.contact_phone, "+14155550134");
  const cleared = updateRevClient(client.id, { contactPhone: "  " });
  assert.equal(cleared?.contact_phone, "");
  updateRevClient(client.id, { contactPhone: "4155550134" });

  const row = () => getRevClient(client.id)!;
  const calls: string[] = [];
  const transport = async (input: { phone: string; message: string }) => {
    calls.push(`${input.phone}|${input.message}`);
    return { messageId: "m1" };
  };

  delete process.env.PRODUCTION_SMS_ENABLED;
  process.env.PRODUCTION_SMS_LOCATION_ID = "loc_test";
  const disabled = await sms.sendScheduleNudgeSms({
    kind: "cadence_reminder",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "cadence:c:2026-10-20:2026-10-19",
    transport,
  });
  assert.deepEqual(disabled, { status: "skipped", reason: "disabled" });
  assert.equal(calls.length, 0);

  process.env.PRODUCTION_SMS_ENABLED = "1";
  delete process.env.PRODUCTION_SMS_LOCATION_ID;
  const noLocation = await sms.sendScheduleNudgeSms({
    kind: "first_invite",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "extra:req:2026-10-19",
    transport,
  });
  assert.deepEqual(noLocation, { status: "skipped", reason: "no_location" });
  assert.equal(calls.length, 0);

  process.env.PRODUCTION_SMS_LOCATION_ID = "loc_test";
  const noPhone = await sms.sendScheduleNudgeSms({
    kind: "extra_invite",
    client: { ...row(), contact_phone: "" },
    url: "https://desk.example/schedule/tok",
    dedupeKey: "extra:req2:2026-10-19",
    transport,
  });
  assert.deepEqual(noPhone, { status: "skipped", reason: "no_phone" });

  const badPhone = await sms.sendScheduleNudgeSms({
    kind: "cadence_reminder",
    client: { ...row(), contact_phone: "555" },
    url: "https://desk.example/schedule/tok",
    dedupeKey: "cadence:bad",
    transport,
  });
  assert.deepEqual(badPhone, { status: "skipped", reason: "invalid_phone" });
  assert.equal(calls.length, 0);

  const failures = getDb()
    .prepare(`SELECT kind, subject FROM app_failures WHERE dismissed_at IS NULL`)
    .all() as Array<{ kind: string; subject: string }>;
  assert.ok(failures.some((f) => f.kind === "production_sms" && f.subject === "Sample Co"));

  const sent = await sms.sendScheduleNudgeSms({
    kind: "cadence_reminder",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "cadence:c:window:today",
    transport,
  });
  assert.deepEqual(sent, { status: "sent", phone: "+14155550134" });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /your next MEG production/);

  const again = await sms.sendScheduleNudgeSms({
    kind: "cadence_reminder",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "cadence:c:window:today",
    transport,
  });
  assert.deepEqual(again, { status: "skipped", reason: "duplicate" });
  assert.equal(calls.length, 1);

  const boom = async () => {
    throw new Error("gateway down");
  };
  const failed = await sms.sendScheduleNudgeSms({
    kind: "first_invite",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "extra:fail:today",
    transport: boom,
  });
  assert.equal(failed.status, "failed");
  const stored = getDb()
    .prepare(`SELECT dedupe_key FROM production_sms_sends WHERE dedupe_key = ?`)
    .get("extra:fail:today");
  assert.equal(stored, undefined);

  const retried = await sms.sendScheduleNudgeSms({
    kind: "first_invite",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "extra:fail:today",
    transport,
  });
  assert.equal(retried.status, "sent");
  assert.match(calls[1], /your first MEG production/);

  delete process.env.PRODUCTION_SMS_ENABLED;
  const sample = await sms.sendSampleScheduleSms({
    phone: "(415) 555-0199",
    contactName: "Michael",
    transport,
  });
  assert.equal(sample.status, "sent");
  if (sample.status === "sent") assert.equal(sample.phone, "+14155550199");
  assert.match(calls[2], /Hi Michael, it's time to schedule your production/);
  assert.match(calls[2], /\/schedule\/sample$/);
  assert.equal(process.env.PRODUCTION_SMS_ENABLED, undefined);
  if (sample.status === "sent") {
    assert.match(sample.message || "", /Hi Michael, it's time to schedule your production/);
    assert.match(sample.message || "", /\/schedule\/sample$/);
  }
  const sampleRow = getDb()
    .prepare(`SELECT dedupe_key FROM production_sms_sends WHERE phone = ?`)
    .get("+14155550199");
  assert.equal(sampleRow, undefined);
});
