import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizePhoneE164 } from "../src/lib/phone";
import {
  interpretSmsSendPayload,
  parseLocationPhoneNumber,
  pickContactMatchingEmailAndPhone,
} from "../src/lib/ghl";
import {
  PRODUCTION_SMS_EVENTS,
  formatSampleLog,
  formatSendLog,
  groupSmsFailureAlert,
  guardProductionSms,
  interpretA2p,
  lastTextView,
  plainSmsFailure,
  pollMessageDelivery,
  productionNoticeSendsSms,
  scheduleNudgeSmsBody,
  scheduleSmsCopy,
  smsDndState,
  smsPreflightError,
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
  assert.match(sampleRoute, /includeLink/);
  assert.equal(/if\s*\(\s*!?\s*scheduleSmsEnabled\s*\(/.test(sampleRoute), false);
  const desk = fs.readFileSync(
    path.join(root, "src/app/admin/production/page.tsx"),
    "utf8"
  );
  assert.match(desk, /\/api\/production\/sms-sample/);
  assert.match(desk, /sample-omit-link/);
  assert.match(desk, /includeLink: !sampleOmitLink/);
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

test("scheduling texts name the brand, offer STOP, and keep the full link", () => {
  const url = "https://desk.example/schedule/abc123";
  const stop = " Reply STOP to opt out.";
  const next = scheduleNudgeSmsBody({
    kind: "cadence_reminder",
    contactName: "Jamie Lee",
    url,
  });
  assert.equal(
    next,
    `Marketing Empire Group: Hi Jamie, it's time to schedule your next production. Pick a time here: ${url}${stop}`
  );
  assert.ok(next.length <= 160);
  const first = scheduleNudgeSmsBody({
    kind: "first_invite",
    contactName: "Jamie",
    url,
  });
  assert.match(first, /^Marketing Empire Group: /);
  assert.match(first, /your first production/);
  assert.ok(first.endsWith(stop));
  const extra = scheduleNudgeSmsBody({
    kind: "extra_invite",
    contactName: "Jamie",
    url,
  });
  assert.match(extra, /schedule a production/);
  assert.ok(extra.endsWith(stop));
  assert.equal(
    scheduleNudgeSmsBody({ kind: "cadence_reminder", contactName: "", url }),
    `Marketing Empire Group: Hi, it's time to schedule your next production. Pick a time here: ${url}${stop}`
  );
  assert.equal(
    scheduleNudgeSmsBody({
      kind: "cadence_reminder",
      contactName: "jamie@client.com",
      url,
    }).startsWith("Marketing Empire Group: Hi,"),
    true
  );
  const longUrl = `https://hub.marketingempiregroup.com/schedule/${"a".repeat(24)}`;
  for (const kind of ["cadence_reminder", "first_invite", "extra_invite"] as const) {
    const body = scheduleNudgeSmsBody({ kind, contactName: "Michael", url: longUrl });
    assert.ok(body.startsWith("Marketing Empire Group: "), kind);
    assert.ok(body.endsWith(stop), kind);
    assert.ok(body.includes(longUrl), kind);
    assert.ok(body.length <= 160, `${kind} is ${body.length}: ${body}`);
  }
  const huge = scheduleNudgeSmsBody({
    kind: "cadence_reminder",
    contactName: "Alexandria",
    url: `https://desk.example/schedule/${"a".repeat(400)}`,
  });
  assert.ok(huge.includes(`https://desk.example/schedule/${"a".repeat(400)}`));
  assert.ok(huge.endsWith(stop));
});

test("every scheduling text goes through the compliance guard", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/production-sms.ts"),
    "utf8"
  );
  const nudge = src.slice(
    src.indexOf("export function scheduleNudgeSmsBody"),
    src.indexOf("function sampleScheduleSmsBody")
  );
  const sample = src.slice(
    src.indexOf("function sampleScheduleSmsBody"),
    src.indexOf("export const SAMPLE_SCHEDULE_TOKEN")
  );
  assert.match(nudge, /return scheduleSmsCopy/);
  assert.match(sample, /return scheduleSmsCopy/);
  const live = src.slice(src.indexOf("async function liveDeliver"), src.indexOf("type SmsClient"));
  const stub = src.slice(
    src.indexOf("async function stubDeliver"),
    src.indexOf("export async function sendSampleScheduleSms")
  );
  assert.ok(live.indexOf("guardProductionSms") !== -1);
  assert.ok(live.indexOf("guardProductionSms") < live.indexOf("sendLocationSms"));
  assert.ok(stub.indexOf("guardProductionSms") < stub.indexOf("args.transport"));
  assert.equal(src.split("sendLocationSms(").length, 2);

  const url = "https://hub.marketingempiregroup.com/schedule/sample";
  const bodies = [
    scheduleNudgeSmsBody({ kind: "first_invite", contactName: "Michael", url }),
    scheduleNudgeSmsBody({ kind: "extra_invite", contactName: "Michael", url }),
    scheduleNudgeSmsBody({ kind: "cadence_reminder", contactName: "Michael", url }),
    scheduleSmsCopy({ kind: "sample", contactName: "Michael", url, includeLink: true }),
    scheduleSmsCopy({ kind: "sample", contactName: "Michael", includeLink: false }),
  ];
  for (const body of bodies) {
    assert.equal(guardProductionSms(body), body);
    assert.ok(body.startsWith("Marketing Empire Group: "));
    assert.ok(body.endsWith(" Reply STOP to opt out."));
  }
  assert.equal(
    guardProductionSms("Hi there, book a time."),
    "Marketing Empire Group: Hi there, book a time. Reply STOP to opt out."
  );
});

test("a shared phone uses the contact that also matches the email", () => {
  const contacts = [
    { id: "piarulli", email: "michael@marketingempiregroup.com", phone: "+1 (951) 383-9888" },
    { id: "test", email: "test@example.com", phone: "9513839888" },
  ];
  assert.equal(
    pickContactMatchingEmailAndPhone(contacts, "+19513839888", "Michael@MarketingEmpireGroup.com"),
    "piarulli"
  );
  assert.equal(
    pickContactMatchingEmailAndPhone(contacts, "+19513839888", "test@example.com"),
    "test"
  );
  assert.equal(pickContactMatchingEmailAndPhone(contacts, "+19513839888", ""), null);
  assert.equal(
    pickContactMatchingEmailAndPhone(contacts, "+19513839888", "someone-else@example.com"),
    null
  );
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
  assert.equal(
    failures.some((f) => f.kind === "production_sms" && f.subject === "Sample Co"),
    false
  );

  const sent = await sms.sendScheduleNudgeSms({
    kind: "cadence_reminder",
    client: row(),
    url: "https://desk.example/schedule/tok",
    dedupeKey: "cadence:c:window:today",
    transport,
  });
  assert.equal(sent.status, "sent");
  if (sent.status === "sent") assert.equal(sent.phone, "+14155550134");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\|Marketing Empire Group: /);
  assert.match(calls[0], /your next production/);
  assert.match(calls[0], /Reply STOP to opt out\.$/);

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
  assert.match(calls[1], /\|Marketing Empire Group: /);
  assert.match(calls[1], /your first production/);
  assert.match(calls[1], /Reply STOP to opt out\.$/);

  delete process.env.PRODUCTION_SMS_ENABLED;
  const sample = await sms.sendSampleScheduleSms({
    phone: "(415) 555-0199",
    contactName: "Michael",
    transport,
  });
  assert.equal(sample.status, "sent");
  if (sample.status === "sent") assert.equal(sample.phone, "+14155550199");
  assert.match(calls[2], /\|Marketing Empire Group: Hi Michael,/);
  assert.match(calls[2], /it's time to schedule your production/);
  assert.match(calls[2], /\/schedule\/sample Reply STOP to opt out\.$/);
  assert.equal(process.env.PRODUCTION_SMS_ENABLED, undefined);
  if (sample.status === "sent") {
    assert.match(sample.message || "", /^Marketing Empire Group: Hi Michael,/);
    assert.match(sample.message || "", /\/schedule\/sample/);
    assert.ok((sample.message || "").endsWith(" Reply STOP to opt out."));
  }
  const noLink = await sms.sendSampleScheduleSms({
    phone: "(415) 555-0199",
    contactName: "Michael",
    includeLink: false,
    transport,
  });
  assert.equal(noLink.status, "sent");
  assert.match(calls[3], /\|Marketing Empire Group: Hi Michael, it's time to schedule your production\./);
  assert.match(calls[3], /Reply STOP to opt out\.$/);
  assert.equal(calls[3].includes("http"), false);
  const sampleRow = getDb()
    .prepare(`SELECT dedupe_key FROM production_sms_sends WHERE phone = ?`)
    .get("+14155550199");
  assert.equal(sampleRow, undefined);
});

test("a failed sample is one plain sentence and one log line", async () => {
  const noNumber = plainSmsFailure({
    status: "failed",
    error: "This sub-account has no phone number, so a text cannot be sent.",
    locationName: "Marketing Empire Group",
  });
  assert.match(noNumber || "", /has no texting number, so GHL can't send texts yet/);
  assert.match(noNumber || "", /Add an SMS number/);

  assert.match(
    plainSmsFailure({ status: "failed", error: "This contact is Do Not Disturb for SMS (active)." }) || "",
    /Do Not Disturb/
  );
  assert.match(
    plainSmsFailure({ status: "failed", error: "30034 A2P Registration Pending" }) || "",
    /isn't approved for US business texts/
  );
  assert.equal(plainSmsFailure({ status: "sent", delivery: "delivered" }), null);
  assert.equal(
    plainSmsFailure({ status: "failed", delivery: "undelivered", error: "30007" }),
    "The carrier blocked this text as possible spam. Try the version without the link, or adjust the wording."
  );

  const line = formatSampleLog({
    status: "failed",
    error: "Bearer secret-token\nThis sub-account has no phone number.",
    fromNumber: "",
    locationName: "Marketing Empire Group",
  });
  assert.match(line, /^\[production-sms\] sample status=failed /);
  assert.match(line, /from=-/);
  assert.match(line, /location="Marketing Empire Group"/);
  assert.match(line, /no texting number/);
  assert.equal(line.includes("\n"), false);
  assert.equal(line.includes("secret-token"), false);

  assert.equal(
    smsPreflightError({
      numbers: [],
      a2p: { state: "unknown", detail: "" },
    }),
    "This sub-account has no phone number, so a text cannot be sent."
  );
  const parsed = parseLocationPhoneNumber({
    phoneNumber: "+19515550100",
    capabilities: { sms: true },
    provider: "twilio",
  });
  assert.equal(parsed?.sms, true);
  assert.equal(parsed?.smsKnown, true);
  assert.equal(
    smsDndState({ contact: { dndSettings: { SMS: { status: "active" } } } }).blocked,
    true
  );
  assert.equal(interpretA2p({ campaigns: [] }).state, "blocked");
  assert.equal(interpretSmsSendPayload({ success: false, message: "No number" }).error, "No number");
  assert.ok(interpretSmsSendPayload({ messageId: "abc", msg: "queued" }).messageId);

  const reads = [{ status: "pending" }, { status: "undelivered", error: "30034", from: "+15550001111" }];
  const snapshot = await pollMessageDelivery({
    read: async () => reads.shift() || { status: "undelivered" },
    sleep: async () => {},
  });
  assert.equal(snapshot.status, "undelivered");
  assert.equal(snapshot.fromNumber, "+15550001111");
  assert.equal(snapshot.error, "30034");
});

test("delivery status maps to a plain card line", () => {
  assert.equal(
    lastTextView({ phone: "", status: "" }).line,
    "Last text: Not sent (no phone)"
  );
  assert.equal(
    lastTextView({ phone: "+19513839888", status: "delivered" }).line,
    "Last text: Delivered"
  );
  const blocked = lastTextView({
    phone: "+19513839888",
    status: "undelivered",
    errorCode: "30007",
    errorText: "30007",
  });
  assert.equal(blocked.line, "Last text: Blocked by carrier");
  assert.equal(
    blocked.detail,
    "The carrier blocked this text as possible spam. Try the version without the link, or adjust the wording."
  );
  assert.equal(
    lastTextView({ phone: "+19513839888", status: "undelivered", errorText: "30003" }).line,
    "Last text: Unreachable"
  );
  assert.equal(
    lastTextView({ phone: "+19513839888", status: "failed", errorText: "30005" }).line,
    "Last text: Unknown number"
  );
  assert.equal(
    lastTextView({
      phone: "+19513839888",
      status: "failed",
      errorText: "This contact is Do Not Disturb for SMS (active).",
    }).line,
    "Last text: Do Not Disturb"
  );
  assert.equal(
    plainSmsFailure({ status: "failed", error: "30003" }),
    "The carrier couldn't reach this phone. Check the number, then try again."
  );
  assert.equal(
    plainSmsFailure({ status: "failed", error: "30005" }),
    "The carrier doesn't recognize this number. Check it, then try again."
  );
});

test("text failures group into one alert per run", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-sms-alert-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  closeDbForTests();
  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const sms = await import("../src/lib/production-sms");
  const grouped = groupSmsFailureAlert([
    { client: "North Co", reason: "The carrier blocked this text as possible spam. Try the version without the link, or adjust the wording." },
    { client: "South Co", reason: "The carrier couldn't reach this phone. Check the number, then try again." },
    { client: "East Co", reason: "The carrier doesn't recognize this number. Check it, then try again." },
  ]);
  assert.ok(grouped);
  assert.equal(grouped.subject, "3 scheduling texts didn't go through");
  assert.match(grouped.text, /North Co:/);
  assert.match(grouped.text, /South Co:/);
  assert.match(grouped.text, /East Co:/);
  assert.equal(grouped.text.split("\n").length, 3);

  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const alert = await sms.alertSmsFailures(
    [
      { client: "North Co", reason: grouped.text.split("\n")[0].slice("North Co: ".length), dedupeKey: "north" },
      { client: "South Co", reason: "The carrier couldn't reach this phone. Check the number, then try again.", dedupeKey: "south" },
    ],
    async (input) => {
      sent.push(input);
      return true;
    }
  );
  assert.equal(sent.length, 1);
  assert.equal(alert?.subject, sent[0].subject);
  assert.match(sent[0].text, /North Co:/);
  assert.match(sent[0].text, /South Co:/);
  assert.equal(sent[0].to, "mpiarulli@marketingempiregroup.com");
  const rows = getDb()
    .prepare(`SELECT subject, detail FROM app_failures WHERE kind = 'production_sms'`)
    .all() as Array<{ subject: string; detail: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, "Scheduling texts");
  assert.match(rows[0].detail, /North Co:/);
  assert.match(rows[0].detail, /South Co:/);

  getDb()
    .prepare(
      `INSERT INTO production_sms_sends
        (dedupe_key, client_id, client_name, phone, kind, body, created_at, message_id, status, error_code, error_text, updated_at, checked_at, final_at, alerted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "cadence:queued",
      "c1",
      "West Co",
      "+14155550100",
      "cadence_reminder",
      "hidden body",
      nowIso(),
      "msg_1",
      "queued",
      "",
      "",
      nowIso(),
      "",
      "",
      ""
    );
  const noticed = await sms.refreshSmsDeliveries({
    minAgeMs: 0,
    read: async () => ({ status: "undelivered", error: "30007" }),
  });
  assert.equal(noticed.length, 1);
  assert.equal(noticed[0].client, "West Co");
  assert.match(noticed[0].reason, /blocked this text as possible spam/);
  const stored = getDb()
    .prepare(`SELECT status, error_code FROM production_sms_sends WHERE dedupe_key = ?`)
    .get("cadence:queued") as { status: string; error_code: string };
  assert.equal(stored.status, "undelivered");
  assert.equal(stored.error_code, "30007");
  const line = formatSendLog({
    client: "West Co",
    status: "undelivered",
    code: "30007",
    messageId: "msg_1",
  });
  assert.match(line, /^\[production-sms\] send /);
  assert.match(line, /status=undelivered/);
  assert.match(line, /code=30007/);
  assert.equal(line.includes("hidden body"), false);
  assert.equal(line.includes("Bearer"), false);
});
