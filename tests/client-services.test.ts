import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("weekly snapshot outreach", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-client-services-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.EMAIL_FROM = "Marketing Empire Group <hello@marketingempiregroup.com>";
  process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.com";

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const cs = await import("../src/lib/client-services");
  const revenue = await import("../src/lib/revenue");
  const snapshot = await import("../src/lib/snapshot");

  const acme = revenue.createRevClient({ name: "Acme Plumbing", businessModel: "home_service" });
  const quiet = revenue.createRevClient({ name: "Quiet Co", businessModel: "home_service" });
  revenue.updateRevClient(acme.id, {
    contactName: "Tim Thompson",
    contactEmail: "tim@acme.test",
    accountManager: "Cassidy",
  });
  revenue.updateRevClient(quiet.id, {
    contactName: "Dana Reyes",
    contactEmail: "dana@quiet.test",
    outreachPaused: true,
  });

  await t.test("the account manager resolves from free text", () => {
    const client = revenue.getRevClient(acme.id)!;
    const am = cs.accountManagerFor(client);
    assert.equal(am?.slug, "cassidy");
    assert.equal(am?.label, "Cassidy");
  });

  await t.test("an unknown account manager is not an error", () => {
    const client = revenue.getRevClient(quiet.id)!;
    assert.equal(cs.accountManagerFor(client), null);
  });

  await t.test("the manager's name fronts the agency's verified address", () => {
    const sender = cs.senderFor({ slug: "cassidy", label: "Cassidy", email: "c@meg.test" });
    assert.equal(
      sender.from,
      "Cassidy (Marketing Empire Group) <hello@marketingempiregroup.com>"
    );
    assert.equal(sender.replyTo, "c@meg.test");
  });

  await t.test("a manager with no address still sends, with no reply-to", () => {
    const sender = cs.senderFor({ slug: "cassidy", label: "Cassidy", email: "" });
    assert.match(sender.from || "", /^Cassidy /);
    assert.equal(sender.replyTo, undefined);
  });

  await t.test("no account manager falls back to the agency default", () => {
    assert.deepEqual(cs.senderFor(null), { from: undefined, replyTo: undefined });
  });

  await t.test("an unanswered lead is something to ask about", () => {
    snapshot.addLead({
      clientId: acme.id,
      firstName: "Jo",
      lastName: "Blogs",
      email: "jo@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-03",
      notes: "",
    });
    const ask = cs.weeklyAskFor(acme.id, "2026-08-21");
    assert.ok(ask);
    assert.equal(ask.unansweredLeads.length, 1);
    assert.equal(ask.revenueIn, false);
    assert.equal(cs.hasSomethingToAsk(ask), true);
  });

  await t.test("answering everything leaves nothing to ask", () => {
    const leads = snapshot.listLeads(acme.id);
    snapshot.answerLead(acme.id, leads[0].id, "yes");
    snapshot.upsertRevenueReport({
      clientId: acme.id,
      month: "2026-07",
      amount: 42000,
      note: "",
    });
    const ask = cs.weeklyAskFor(acme.id, "2026-08-21");
    assert.ok(ask);
    assert.equal(ask.unansweredLeads.length, 0);
    assert.equal(ask.revenueIn, true);
    assert.equal(cs.hasSomethingToAsk(ask), false);
  });

  await t.test("a client who answered everything reads as submitted", () => {
    const rows = cs.clientServiceRows("2026-08-21");
    const row = rows.find((r) => r.clientId === acme.id);
    assert.ok(row);
    assert.equal(row.submitted, true);
    assert.equal(row.status, "submitted");
    assert.equal(row.accountManager, "Cassidy");
  });

  await t.test("a paused client is called paused, not merely unsent", () => {
    const row = cs.clientServiceRows("2026-08-21").find((r) => r.clientId === quiet.id);
    assert.ok(row);
    assert.equal(row.paused, true);
    assert.equal(row.status, "paused");
  });

  await t.test("the pipeline advances as events arrive", () => {
    const weekStart = cs.currentWeekStart("2026-08-21");
    // Give Quiet Co something outstanding so it is not short-circuited by
    // "submitted", which deliberately outranks every delivery state.
    snapshot.addLead({
      clientId: quiet.id,
      firstName: "Sam",
      lastName: "Reed",
      email: "sam@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-03",
      notes: "",
    });
    revenue.updateRevClient(quiet.id, { outreachPaused: false });

    cs.recordOutreach({
      clientId: quiet.id,
      clientName: "Quiet Co",
      weekStart,
      month: "2026-07",
      channel: "email",
      amSlug: "",
      amLabel: "",
      sentTo: "dana@quiet.test",
      providerMessageId: "resend-abc",
    });

    let row = cs.clientServiceRows("2026-08-21").find((r) => r.clientId === quiet.id)!;
    assert.equal(row.status, "sent");

    assert.equal(cs.markOutreachEvent("resend-abc", "delivered", nowIso()), true);
    row = cs.clientServiceRows("2026-08-21").find((r) => r.clientId === quiet.id)!;
    assert.equal(row.status, "delivered");

    assert.equal(cs.markOutreachEvent("resend-abc", "opened", nowIso()), true);
    row = cs.clientServiceRows("2026-08-21").find((r) => r.clientId === quiet.id)!;
    assert.equal(row.status, "opened");
    assert.ok(row.emailOpenedAt);
  });

  await t.test("a repeated open keeps the first timestamp", () => {
    const before = getDb()
      .prepare(`SELECT opened_at FROM snapshot_outreach WHERE provider_message_id = ?`)
      .get("resend-abc") as { opened_at: string };
    cs.markOutreachEvent("resend-abc", "opened", "2099-01-01T00:00:00.000Z");
    const after = getDb()
      .prepare(`SELECT opened_at FROM snapshot_outreach WHERE provider_message_id = ?`)
      .get("resend-abc") as { opened_at: string };
    assert.equal(after.opened_at, before.opened_at);
  });

  await t.test("an event for somebody else's email matches nothing", () => {
    assert.equal(cs.markOutreachEvent("not-a-real-id", "opened", nowIso()), false);
  });

  await t.test("the summary counts the week", () => {
    const rows = cs.clientServiceRows("2026-08-21");
    const summary = cs.clientServiceSummary(rows, "2026-08-21");
    assert.equal(summary.clients, rows.length);
    assert.equal(summary.submitted, 1);
    assert.equal(summary.sent, 1);
    assert.equal(summary.opened, 1);
  });

  await t.test("the email names the manager and links the snapshot", () => {
    const client = revenue.getRevClient(acme.id)!;
    const ask = {
      month: "2026-07",
      monthLabel: "July 2026",
      unansweredLeads: [],
      revenueIn: false,
      revenueAmount: null,
    };
    const mail = cs.weeklyAskEmail({
      client,
      am: { slug: "cassidy", label: "Cassidy", email: "c@meg.test" },
      ask,
      link: "https://hub.example.com/snapshot/tok",
    });
    assert.match(mail.subject, /July 2026/);
    assert.match(mail.html, /Hi Tim,/);
    assert.match(mail.html, /https:\/\/hub\.example\.com\/snapshot\/tok/);
    assert.match(mail.text, /Cassidy/);
    // The bulletproof button needs its VML twin to render in Outlook.
    assert.match(mail.html, /v:roundrect/);
  });

  await t.test("the ask only mentions what is actually outstanding", () => {
    const client = revenue.getRevClient(acme.id)!;
    const mail = cs.weeklyAskEmail({
      client,
      am: null,
      ask: {
        month: "2026-07",
        monthLabel: "July 2026",
        unansweredLeads: [],
        revenueIn: true,
        revenueAmount: 1000,
      },
      link: "https://hub.example.com/snapshot/tok",
    });
    assert.doesNotMatch(mail.text, /revenue/i);
    assert.doesNotMatch(mail.text, /lead/i);
  });

  await t.test("sending is off unless explicitly switched on", () => {
    const prior = process.env.CLIENT_SERVICES_SENDING;
    delete process.env.CLIENT_SERVICES_SENDING;
    assert.equal(cs.sendingEnabled(), false, "must default to off");
    process.env.CLIENT_SERVICES_SENDING = "off";
    assert.equal(cs.sendingEnabled(), false);
    process.env.CLIENT_SERVICES_SENDING = "no";
    assert.equal(cs.sendingEnabled(), false, "anything unrecognised is off");
    process.env.CLIENT_SERVICES_SENDING = "on";
    assert.equal(cs.sendingEnabled(), true);
    process.env.CLIENT_SERVICES_SENDING = "true";
    assert.equal(cs.sendingEnabled(), true);
    if (prior === undefined) delete process.env.CLIENT_SERVICES_SENDING;
    else process.env.CLIENT_SERVICES_SENDING = prior;
  });

  await t.test("with sending off, a send writes nothing and says why", async () => {
    delete process.env.CLIENT_SERVICES_SENDING;
    const weekStart = cs.currentWeekStart("2026-08-21");
    const before = cs.outreachForWeek(weekStart).length;
    const client = revenue.getRevClient(acme.id)!;

    const result = await cs.sendWeeklyAsk({
      client,
      weekStart,
      appUrl: "https://hub.example.com",
    });

    assert.equal(result.email.skipped, "sending disabled");
    assert.equal(
      cs.outreachForWeek(weekStart).length,
      before,
      "a held send must not log an outreach row, or the week looks spent"
    );
  });

  await t.test("a held sweep reports that nothing left", async () => {
    delete process.env.CLIENT_SERVICES_SENDING;
    const result = await cs.runWeeklyAsks({ today: "2026-08-21" });
    assert.equal(result.sendingEnabled, false);
    for (const row of result.sent) {
      assert.notEqual(
        row.email.skipped,
        undefined,
        `${row.clientName} should have been held, not sent`
      );
    }
  });

  await t.test("the sweep does not ask the same client twice in a week", async () => {
    const before = cs.outreachForWeek(cs.currentWeekStart("2026-08-21")).length;
    const result = await cs.runWeeklyAsks({ dryRun: true, today: "2026-08-21" });
    // Quiet Co was already contacted above; Acme has nothing outstanding.
    assert.equal(result.skipped.alreadySent >= 1, true);
    assert.equal(
      cs.outreachForWeek(cs.currentWeekStart("2026-08-21")).length,
      before,
      "a dry run must not write an outreach row"
    );
  });
});
