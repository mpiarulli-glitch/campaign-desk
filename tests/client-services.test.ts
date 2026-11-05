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

  // Names must match the snapshot allowlist — Friday ask only covers those accounts.
  const acme = revenue.createRevClient({ name: "Guardian Plumbers", businessModel: "home_service" });
  const quiet = revenue.createRevClient({ name: "Ecoworkz", businessModel: "home_service" });
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

  await t.test("the ask is from Marketing Empire Group, replies go to the manager", () => {
    const sender = cs.senderFor({ slug: "cassidy", label: "Cassidy", email: "c@meg.test" });
    assert.equal(
      sender.from,
      "Marketing Empire Group <hello@marketingempiregroup.com>"
    );
    assert.equal(sender.replyTo, "c@meg.test");
  });

  await t.test("a manager with no address still sends, with no reply-to", () => {
    const sender = cs.senderFor({ slug: "cassidy", label: "Cassidy", email: "" });
    assert.equal(
      sender.from,
      "Marketing Empire Group <hello@marketingempiregroup.com>"
    );
    assert.equal(sender.replyTo, undefined);
  });

  await t.test("no account manager falls back to the agency default", () => {
    assert.deepEqual(cs.senderFor(null), { from: undefined, replyTo: undefined });
  });

  await t.test("missing revenue is something to ask about", () => {
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

  await t.test("an unanswered lead does not keep the ask open once revenue is in", () => {
    snapshot.upsertRevenueReport({
      clientId: acme.id,
      month: "2026-07",
      amount: 42000,
      note: "",
    });
    const ask = cs.weeklyAskFor(acme.id, "2026-08-21");
    assert.ok(ask);
    assert.equal(ask.unansweredLeads.length, 1);
    assert.equal(ask.revenueIn, true);
    assert.equal(cs.hasSomethingToAsk(ask), false);
    const row = cs.clientServiceRows("2026-08-21").find((r) => r.clientId === acme.id);
    assert.equal(row?.leadsWaiting, 1);
    assert.equal(row?.submitted, true);
  });

  await t.test("the client link no longer records a lead outcome", async () => {
    const route = await import("../src/app/api/snapshot/shared/[token]/lead/route");
    const token = snapshot.getOrCreateToken(acme.id);
    const lead = snapshot.listLeads(acme.id)[0];
    assert.equal(lead.converted, "unknown");
    const res = await route.POST(
      new Request("http://localhost/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, converted: "yes", clientNote: "Closed it" }),
      }),
      { params: Promise.resolve({ token: token || "" }) }
    );
    assert.equal(res.status, 410);
    const stored = snapshot.listLeads(acme.id).find((row) => row.id === lead.id);
    assert.equal(stored?.converted, "unknown");
    assert.equal(stored?.client_note || "", "");
    const missing = await route.POST(
      new Request("http://localhost/lead", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ token: "not-a-token" }) }
    );
    assert.equal(missing.status, 404);
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
    // Revenue is still owed, so Submitted does not outrank the delivery states.
    // An unanswered lead must not be what holds the row open.
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
      clientName: "Ecoworkz",
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
    assert.equal(mail.subject, "Your New Weekly Snapshot is ready.");
    assert.match(mail.html, /Hi Tim,/);
    assert.match(mail.html, /ready to review/);
    assert.match(mail.html, /See what went on across your account this week/);
    assert.match(mail.html, /https:\/\/hub\.example\.com\/snapshot\/tok/);
    assert.match(mail.text, /Cassidy/);
    assert.doesNotMatch(mail.text, /lead/i);
    assert.doesNotMatch(mail.text, /revenue/i);
    // The bulletproof button needs its VML twin to render in Outlook.
    assert.match(mail.html, /v:roundrect/);
  });

  await t.test("email and Basecamp never preview outstanding leads or revenue", () => {
    const client = revenue.getRevClient(acme.id)!;
    const ask = {
      month: "2026-07",
      monthLabel: "July 2026",
      unansweredLeads: [{ id: "l1" }] as never[],
      revenueIn: false,
      revenueAmount: null,
    };
    const mail = cs.weeklyAskEmail({
      client,
      am: null,
      ask: ask as never,
      link: "https://hub.example.com/snapshot/tok",
    });
    assert.match(mail.text, /ready to review/);
    assert.doesNotMatch(mail.text, /revenue/i);
    assert.doesNotMatch(mail.text, /lead/i);

    const card = cs.weeklyAskMessageContent({
      ask: ask as never,
      link: "https://hub.example.com/snapshot/tok",
      mention: "@Tim",
      amMention: '<bc-attachment sgid="am-sgid" content-type="application/vnd.basecamp.mention"></bc-attachment>',
      amLabel: "Kyle Morris",
      sylviaMention:
        '<bc-attachment sgid="sylvia-sgid" content-type="application/vnd.basecamp.mention"></bc-attachment>',
    });
    assert.equal(card.title, "Your weekly snapshot is ready");
    assert.match(card.body, /ready to review/);
    assert.match(card.body, /See what went on across your account this week/);
    assert.match(card.body, /am-sgid/);
    assert.match(card.body, /sylvia-sgid/);
    assert.match(card.body, /CC:/);
    assert.doesNotMatch(card.body, /Thanks, Kyle Morris/);
    assert.doesNotMatch(card.body, /lead/i);
    assert.doesNotMatch(card.body, /revenue/i);
  });

  await t.test("weekly snapshot always CCs Sylvia's inbox", () => {
    assert.equal(cs.WEEKLY_SNAPSHOT_CC_EMAIL, "sartiga@marketingempiregroup.com");
  });

  await t.test("account manager resolves to the mapped Basecamp person", () => {
    const people = [
      {
        id: 1,
        name: "Kyle Onstott",
        email_address: "kyle.o@test",
        attachable_sgid: "wrong",
      },
      {
        id: 2,
        name: "Morris Kyle",
        email_address: "kyle.m@test",
        attachable_sgid: "morris",
      },
      {
        id: 3,
        name: "Cassidy Merideth",
        email_address: "c@test",
        attachable_sgid: "cass",
      },
    ];
    const morris = cs.resolveAccountManagerOnProject(people as never[], "Kyle", {
      slug: "kyle_morris",
      label: "Kyle Morris",
      email: "kyle@meg.test",
    });
    assert.equal(morris?.name, "Morris Kyle");
    assert.equal(morris?.id, 2);

    const cassidy = cs.resolveAccountManagerOnProject(people as never[], "Cassidy");
    assert.equal(cassidy?.name, "Cassidy Merideth");
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

  await t.test("the sweep never sends, even when CLIENT_SERVICES_SENDING is on", async () => {
    process.env.CLIENT_SERVICES_SENDING = "on";
    process.env.RESEND_API_KEY = "re_test_key";
    const volt = revenue.createRevClient({
      name: "12 Volt Power",
      businessModel: "home_service",
    });
    revenue.updateRevClient(volt.id, {
      contactName: "Pat Volt",
      contactEmail: "pat@volt.test",
      accountManager: "Cassidy",
      basecampProjectId: "424242",
    });
    snapshot.addLead({
      clientId: volt.id,
      firstName: "Ada",
      lastName: "Volt",
      email: "ada@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-03",
      notes: "",
    });
    const pipe = revenue.createRevClient({
      name: "Pipe It Right",
      businessModel: "home_service",
    });
    revenue.updateRevClient(pipe.id, {
      contactName: "Pat Pipe",
      contactEmail: "pat@pipe.test",
    });
    snapshot.addLead({
      clientId: pipe.id,
      firstName: "Una",
      lastName: "Nswered",
      email: "una@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-03",
      notes: "",
    });
    snapshot.upsertRevenueReport({
      clientId: pipe.id,
      month: "2026-07",
      amount: 1000,
      note: "",
    });
    const kentina = revenue.createRevClient({
      name: "Kentina Hospitality",
      businessModel: "home_service",
    });
    revenue.updateRevClient(kentina.id, {
      contactName: "Ken Tina",
      contactEmail: "ken@kentina.test",
      outreachPaused: true,
    });
    snapshot.addLead({
      clientId: kentina.id,
      firstName: "Guest",
      lastName: "One",
      email: "guest@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-03",
      notes: "",
    });

    const weekStart = cs.currentWeekStart("2026-08-21");
    const before = cs.outreachForWeek(weekStart).length;
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${String(input)}`);
      return new Response("sweep must not send", { status: 500 });
    }) as typeof fetch;
    try {
      const result = await cs.runWeeklyAsks({ today: "2026-08-21" });
      assert.equal(result.dryRun, true);
      assert.equal(result.sendingEnabled, true);
      assert.equal(result.skipped.paused >= 1, true, "Kentina stays paused");
      const asked = result.sent.find((row) => row.clientId === volt.id);
      assert.ok(asked, "missing revenue is still reported");
      assert.equal(
        result.sent.some((row) => row.clientId === pipe.id),
        false,
        "an unanswered lead is not something to ask once revenue is in"
      );
      assert.equal(asked.email.skipped, "dry run");
      assert.equal(asked.basecamp.skipped, "dry run");
      assert.equal(
        result.sent.some((row) => row.clientId === kentina.id),
        false,
        "a paused client is not sent"
      );
      assert.equal(calls.length, 0, "the sweep must not call Resend or Basecamp");
      assert.equal(cs.outreachForWeek(weekStart).length, before);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RESEND_API_KEY;
      delete process.env.CLIENT_SERVICES_SENDING;
    }
  });

  await t.test("a manual send still delivers when CLIENT_SERVICES_SENDING is off", async () => {
    delete process.env.CLIENT_SERVICES_SENDING;
    process.env.RESEND_API_KEY = "re_test_key";
    const client = revenue.getRevClient(
      revenue
        .listRevClients()
        .find((row) => row.name === "12 Volt Power")!.id
    )!;
    const weekStart = cs.currentWeekStart("2026-08-21");
    const before = cs.outreachForWeek(weekStart).length;
    getDb()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('basecamp_tokens', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(
        JSON.stringify({
          access_token: "test-token",
          refresh_token: "test-refresh",
          expires_at: Date.now() + 86_400_000,
        }),
        nowIso()
      );

    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("api.resend.com/emails")) {
        return new Response(JSON.stringify({ id: "email-manual-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/projects/424242/people.json")) {
        return new Response(
          JSON.stringify([
            {
              id: 11,
              name: "Pat Volt",
              email_address: "pat@volt.test",
              attachable_sgid: "sgid-pat",
            },
            {
              id: 22,
              name: "Cassidy Merideth",
              email_address: "cassidy@meg.test",
              attachable_sgid: "sgid-cassidy",
            },
            {
              id: 33,
              name: "Sylvia Artiga",
              email_address: "sylvia@meg.test",
              attachable_sgid: "sgid-sylvia",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/circles/people.json")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/projects/424242.json")) {
        return new Response(
          JSON.stringify({
            dock: [{ id: 77, name: "message_board", enabled: true }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/message_boards/77/messages.json") && method === "POST") {
        return new Response(
          JSON.stringify({ id: 9001, app_url: "https://3.basecamp.com/p/9001" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    }) as typeof fetch;

    try {
      const result = await cs.sendWeeklyAsk({
        client,
        weekStart,
        appUrl: "https://hub.example.com",
      });
      assert.equal(result.email.ok, true);
      assert.equal(result.email.skipped, undefined);
      assert.equal(result.basecamp.ok, true);
      assert.equal(result.basecamp.skipped, undefined);
      assert.equal(
        calls.some((line) => line.startsWith("POST ") && line.includes("api.resend.com/emails")),
        true
      );
      assert.equal(
        calls.some(
          (line) => line.startsWith("POST ") && line.includes("/message_boards/77/messages.json")
        ),
        true
      );
      const after = cs.outreachForWeek(weekStart);
      assert.equal(after.length, before + 2);
      assert.equal(
        after.some((row) => row.client_id === client.id && row.channel === "email"),
        true
      );
      assert.equal(
        after.some((row) => row.client_id === client.id && row.channel === "basecamp"),
        true
      );
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RESEND_API_KEY;
    }
  });

  await t.test("the sweep does not ask the same client twice in a week", async () => {
    const before = cs.outreachForWeek(cs.currentWeekStart("2026-08-21")).length;
    const result = await cs.runWeeklyAsks({ dryRun: true, today: "2026-08-21" });
    // Ecoworkz was already contacted above; Guardian has nothing outstanding.
    assert.equal(result.skipped.alreadySent >= 1, true);
    assert.equal(
      cs.outreachForWeek(cs.currentWeekStart("2026-08-21")).length,
      before,
      "a dry run must not write an outreach row"
    );
  });

  await t.test("the cron endpoint refuses a live send even when sending is on", async () => {
    process.env.CLIENT_SERVICES_SENDING = "on";
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.RESEND_API_KEY = "re_test_key";
    const cipo = revenue.createRevClient({
      name: "CIPO Cloud Software",
      businessModel: "home_service",
    });
    revenue.updateRevClient(cipo.id, {
      contactName: "Cipo Cloud",
      contactEmail: "cipo@cloud.test",
      accountManager: "Cassidy",
      basecampProjectId: "515151",
    });
    snapshot.addLead({
      clientId: cipo.id,
      firstName: "Sky",
      lastName: "Cloud",
      email: "sky@lead.test",
      phone: "",
      source: "form",
      receivedOn: "2026-08-04",
      notes: "",
    });

    const weekStart = cs.currentWeekStart("2026-08-21");
    const before = cs.outreachForWeek(weekStart).length;
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${String(input)}`);
      return new Response("cron must not send", { status: 500 });
    }) as typeof fetch;

    try {
      const route = await import("../src/app/api/cron/weekly-snapshot/route");
      const res = await route.POST(
        new Request(
          "https://hub.example.com/api/cron/weekly-snapshot?dryRun=0&today=2026-08-21",
          {
            method: "POST",
            headers: { Authorization: "Bearer cron-test-secret" },
          }
        )
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        dryRun: boolean;
        sendingEnabled: boolean;
        sent: Array<{ clientId: string; email: { skipped?: string }; basecamp: { skipped?: string } }>;
        skipped: { paused: number };
      };
      assert.equal(body.dryRun, true);
      assert.equal(body.sendingEnabled, true);
      const asked = body.sent.find((row) => row.clientId === cipo.id);
      assert.ok(asked);
      assert.equal(asked.email.skipped, "dry run");
      assert.equal(asked.basecamp.skipped, "dry run");
      assert.equal(calls.length, 0);
      assert.equal(cs.outreachForWeek(weekStart).length, before);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RESEND_API_KEY;
      delete process.env.CLIENT_SERVICES_SENDING;
      delete process.env.CRON_SECRET;
    }
  });
});
