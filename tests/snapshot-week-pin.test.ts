import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Friday snapshot links stay on the week they were sent for. Opening an older
// email must not swap in the current week's saved work.

test("snapshot share links encode the Monday they were sent for", async () => {
  const link = await import("../src/lib/snapshot-link");
  assert.equal(
    link.snapshotSharePath("tok_1", "2026-11-13"),
    "/snapshot/tok_1?week=2026-11-09"
  );
  assert.equal(
    link.snapshotShareUrl("https://hub.example.com/", "tok_1", "2026-11-09"),
    "https://hub.example.com/snapshot/tok_1?week=2026-11-09"
  );
  assert.equal(link.weekFromSnapshotSearch("?week=2026-11-13"), "2026-11-09");
  assert.equal(link.weekFromSnapshotSearch(""), null);
  assert.equal(link.weekFromSnapshotSearch("?week=nope"), null);

  const weeks = ["2026-10-05", "2026-10-26", "2026-11-09"];
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-10-26", -1), "2026-10-05");
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-10-26", 1), "2026-11-09");
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-10-05", -1), null);
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-11-09", 1), null);
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-10-12", -1), "2026-10-05");
  assert.equal(link.adjacentClientSnapshotWeek(weeks, "2026-10-12", 1), "2026-10-26");

  const send = fs.readFileSync(new URL("../src/lib/client-services.ts", import.meta.url), "utf8");
  assert.match(send, /snapshotShareUrl\(appUrl, token, weekStart\)/);
  const page = fs.readFileSync(
    new URL("../src/app/snapshot/[token]/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(page, /weekFromSnapshotSearch\(window\.location\.search\)/);
  assert.match(page, /adjacentClientSnapshotWeek/);
  assert.match(page, /Choose a snapshot week/);
  assert.match(page, /Saved week/);
});

test("a client snapshot opens the pinned week and only that client's saved work", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-week-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { mondayOf } = await import("../src/lib/week");
  const link = await import("../src/lib/snapshot-link");
  const pin = await import("../src/lib/snapshot-week-pin");
  const revenue = await import("../src/lib/revenue");
  const snapshot = await import("../src/lib/snapshot");
  const depts = await import("../src/lib/snapshot-departments");
  const cs = await import("../src/lib/client-services");
  const enrollment = await import("../src/lib/snapshot-enrollment");
  const route = await import("../src/app/api/snapshot/shared/[token]/route");

  const THIS = mondayOf(new Date());
  const OCT = "2026-10-05";
  const SEP = "2026-09-07";
  assert.ok(THIS > OCT, `fixture weeks must sit before the current week (${THIS})`);

  const acme = revenue.createRevClient({ name: "Acme Fixture", businessModel: "home_service" });
  const bravo = revenue.createRevClient({ name: "Bravo Fixture", businessModel: "home_service" });
  const cleo = revenue.createRevClient({ name: "Cleo Fixture", businessModel: "home_service" });
  const drew = revenue.createRevClient({ name: "Drew Fixture", businessModel: "home_service" });

  const acmeToken = snapshot.getOrCreateToken(acme.id)!;
  const bravoToken = snapshot.getOrCreateToken(bravo.id)!;
  const cleoToken = snapshot.getOrCreateToken(cleo.id)!;
  const drewToken = snapshot.getOrCreateToken(drew.id)!;

  depts.addDepartmentItem({
    clientId: acme.id,
    weekStart: OCT,
    department: "social",
    body: "October recap for Acme",
    status: "completed",
  });
  depts.addDepartmentItem({
    clientId: acme.id,
    weekStart: THIS,
    department: "social",
    body: "November launch for Acme",
    status: "in_progress",
  });
  snapshot.addWin({ clientId: acme.id, body: "October win for Acme", weekStart: OCT, happenedOn: OCT });
  snapshot.addWin({ clientId: acme.id, body: "November win for Acme", weekStart: THIS, happenedOn: THIS });

  depts.addDepartmentItem({
    clientId: bravo.id,
    weekStart: SEP,
    department: "seo",
    body: "Secret September for Bravo",
  });

  depts.addDepartmentItem({
    clientId: cleo.id,
    weekStart: OCT,
    department: "ads",
    body: "Only send week for Cleo",
    status: "completed",
  });
  depts.addDepartmentItem({
    clientId: cleo.id,
    weekStart: THIS,
    department: "ads",
    body: "Current fill for Cleo that the old link must not show",
  });
  cs.recordOutreach({
    clientId: cleo.id,
    clientName: cleo.name,
    weekStart: OCT,
    month: "2026-09",
    channel: "email",
    amSlug: "cassidy",
    amLabel: "Cassidy",
    sentTo: "cleo@example.com",
  });
  cs.recordOutreach({
    clientId: cleo.id,
    clientName: cleo.name,
    weekStart: OCT,
    month: "2026-09",
    channel: "basecamp",
    amSlug: "cassidy",
    amLabel: "Cassidy",
    sentTo: "Cleo",
  });

  cs.recordOutreach({
    clientId: drew.id,
    clientName: drew.name,
    weekStart: SEP,
    month: "2026-08",
    channel: "email",
    amSlug: "",
    amLabel: "",
    sentTo: "drew@example.com",
  });
  cs.recordOutreach({
    clientId: drew.id,
    clientName: drew.name,
    weekStart: OCT,
    month: "2026-09",
    channel: "email",
    amSlug: "",
    amLabel: "",
    sentTo: "drew@example.com",
  });
  depts.addDepartmentItem({
    clientId: drew.id,
    weekStart: SEP,
    department: "video",
    body: "September for Drew",
  });
  depts.addDepartmentItem({
    clientId: drew.id,
    weekStart: THIS,
    department: "video",
    body: "Current for Drew",
  });

  type Payload = {
    week: string;
    pinned: boolean;
    weeks: string[];
    departments: Array<{ slug: string; label: string; items: Array<{ body: string }> }>;
    wins: Array<{ body: string; week_start?: string }>;
    error?: string;
  };

  async function open(token: string, week?: string): Promise<{ status: number; body: Payload }> {
    const url = new URL(`https://hub.test/api/snapshot/shared/${token}`);
    if (week !== undefined) url.searchParams.set("week", week);
    const res = await route.GET(new Request(url), { params: Promise.resolve({ token }) });
    return { status: res.status, body: (await res.json()) as Payload };
  }

  function bodies(body: Payload): string[] {
    return body.departments.flatMap((note) => note.items.map((item) => item.body));
  }

  await t.test("a pinned past week returns that week's saved lines, not the current week", async () => {
    const past = await open(acmeToken, OCT);
    assert.equal(past.status, 200);
    assert.equal(past.body.week, OCT);
    assert.equal(past.body.pinned, true);
    assert.deepEqual(bodies(past.body), ["October recap for Acme"]);
    assert.deepEqual(
      past.body.wins.map((win) => win.body),
      ["October win for Acme"]
    );
    assert.equal(past.body.departments.some((note) => note.items.length === 0), false);
    assert.deepEqual(
      past.body.departments.map((note) => note.slug),
      ["social"]
    );
    assert.equal(bodies(past.body).includes("November launch for Acme"), false);
    assert.equal(bodies(past.body).includes("Secret September for Bravo"), false);

    const current = await open(acmeToken, THIS);
    assert.equal(current.body.week, THIS);
    assert.deepEqual(bodies(current.body), ["November launch for Acme"]);
    assert.deepEqual(
      current.body.wins.map((win) => win.body),
      ["November win for Acme"]
    );
    assert.equal(bodies(current.body).includes("October recap for Acme"), false);
  });

  await t.test("a Friday date in the link resolves to that week's Monday", async () => {
    const opened = await open(acmeToken, "2026-10-07");
    assert.equal(opened.status, 200);
    assert.equal(opened.body.week, OCT);
    assert.deepEqual(bodies(opened.body), ["October recap for Acme"]);
  });

  await t.test("the week list is only this client's snapshots", async () => {
    const opened = await open(acmeToken, OCT);
    assert.equal(opened.body.weeks.includes(OCT), true);
    assert.equal(opened.body.weeks.includes(THIS), true);
    assert.equal(opened.body.weeks.includes(SEP), false);
    assert.deepEqual(pin.clientSnapshotWeeks(bravo.id), [SEP, THIS].sort());
    assert.equal(pin.clientSnapshotWeeks(acme.id).includes(SEP), false);
    const bravoView = await open(bravoToken, SEP);
    assert.equal(bravoView.status, 200);
    assert.deepEqual(bodies(bravoView.body), ["Secret September for Bravo"]);
    assert.equal(bodies(bravoView.body).includes("October recap for Acme"), false);
  });

  await t.test("an old link with one send week opens that week", async () => {
    assert.deepEqual(pin.sentSnapshotWeeks(cleo.id), [OCT]);
    const opened = await open(cleoToken);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.pinned, false);
    assert.equal(opened.body.week, OCT);
    assert.deepEqual(bodies(opened.body), ["Only send week for Cleo"]);
    assert.equal(bodies(opened.body).includes("Current fill for Cleo that the old link must not show"), false);
  });

  await t.test("an old link sent across more than one week stays on the current week", async () => {
    const opened = await open(drewToken);
    assert.equal(opened.body.pinned, false);
    assert.equal(opened.body.week, THIS);
    assert.deepEqual(bodies(opened.body), ["Current for Drew"]);
    assert.equal(bodies(opened.body).includes("September for Drew"), false);
    const past = await open(drewToken, SEP);
    assert.equal(past.body.week, SEP);
    assert.deepEqual(bodies(past.body), ["September for Drew"]);
  });

  await t.test("an old link with no send record still opens the current week", async () => {
    const opened = await open(acmeToken);
    assert.equal(opened.body.pinned, false);
    assert.equal(opened.body.week, THIS);
    assert.deepEqual(bodies(opened.body), ["November launch for Acme"]);
  });

  await t.test("a bad week is refused and an unknown token stays unknown", async () => {
    const bad = await open(acmeToken, "not-a-date");
    assert.equal(bad.status, 400);
    const missing = await open("no-such-token");
    assert.equal(missing.status, 404);
  });

  await t.test("the Friday copy and the services row use the pinned link and do not send", async () => {
    const pinned = link.snapshotShareUrl("https://hub.example.com", acmeToken, "2026-10-07");
    assert.equal(pinned, `https://hub.example.com/snapshot/${acmeToken}?week=${OCT}`);
    const ask = {
      month: "2026-10",
      monthLabel: "October 2026",
      unansweredLeads: [],
      revenueIn: true,
      revenueAmount: null,
    };
    const client = revenue.getRevClient(acme.id)!;
    const mail = cs.weeklyAskEmail({
      client,
      am: { slug: "cassidy", label: "Cassidy", email: "c@meg.test" },
      ask,
      link: pinned,
    });
    assert.match(mail.html, new RegExp(`href="${pinned.replace(/[?]/g, "\\?")}"`));
    assert.match(mail.text, new RegExp(`Open your snapshot: ${pinned.replace(/[?]/g, "\\?")}`));
    const card = cs.weeklyAskMessageContent({
      ask,
      link: pinned,
      mention:
        '<bc-attachment sgid="client" content-type="application/vnd.basecamp.mention"></bc-attachment>',
      amLabel: "Cassidy",
    });
    assert.match(card.body, new RegExp(`href="${pinned.replace(/[?]/g, "\\?")}"`));

    process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.com";
    enrollment.enrollSnapshotClient(acme.id);
    const row = cs.clientServiceRows().find((item) => item.clientId === acme.id);
    assert.ok(row);
    assert.equal(
      row.snapshotUrl,
      link.snapshotShareUrl("https://hub.example.com", acmeToken, THIS)
    );
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
});
