import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("a saved weekly win can be edited without moving its week", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-win-edit-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const snapshot = await import("../src/lib/snapshot");
  t.after(() => closeDbForTests());

  const client = revenue.createRevClient({
    name: "Hendos Barrel House",
    businessModel: "home_service",
  });
  const posted = snapshot.addWin({
    clientId: client.id,
    body: "No new Web activity recorded this week",
    happenedOn: "2026-11-04",
    weekStart: "2026-11-02",
    loggedBy: "roy",
  });

  await t.test("editing the wording keeps the same week for the client portal", () => {
    const result = snapshot.updateWin(posted.id, {
      body: "Web activity: one landing page revision",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.win.body, "Web activity: one landing page revision");
    assert.equal(result.win.week_start, "2026-11-02");
    assert.equal(result.win.logged_by, "roy");
    assert.deepEqual(
      snapshot.winsForClientWeek(client.id, "2026-11-02").map((win) => win.body),
      ["Web activity: one landing page revision"]
    );
  });

  await t.test("deleting one win leaves the author, the other win, and sent outreach", () => {
    const teammate = snapshot.addWin({
      clientId: client.id,
      body: "Cassidy posted the onboarding note",
      happenedOn: "2026-11-05",
      weekStart: "2026-11-02",
      loggedBy: "cassidy",
    });
    const otherClient = revenue.createRevClient({
      name: "Other Fixture Account",
      businessModel: "home_service",
    });
    const otherWin = snapshot.addWin({
      clientId: otherClient.id,
      body: "Leave this win alone",
      happenedOn: "2026-11-03",
      weekStart: "2026-11-02",
      loggedBy: "luis_romero",
    });
    const db = getDb();
    db.prepare(
      `INSERT INTO snapshot_outreach
        (id, client_id, client_name, week_start, month, channel, am_slug, am_label, sent_to, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'email', 'cassidy', 'Cassidy', 'client@example.com', ?, ?)`
    ).run("outreach-1", client.id, client.name, "2026-11-02", "2026-10", "2026-11-06T12:00:00.000Z", "2026-11-06T12:00:00.000Z");

    assert.equal(snapshot.deleteWin(teammate.id), true);
    assert.equal(snapshot.listWins(client.id).some((win) => win.id === teammate.id), false);
    const kept = snapshot.listWins(client.id).find((win) => win.id === posted.id);
    assert.equal(kept?.logged_by, "roy");
    assert.equal(kept?.week_start, "2026-11-02");
    assert.equal(snapshot.listWins(otherClient.id)[0]?.id, otherWin.id);
    assert.equal(snapshot.listWins(otherClient.id)[0]?.logged_by, "luis_romero");
    const outreach = db
      .prepare(`SELECT sent_to, am_label FROM snapshot_outreach WHERE id = ?`)
      .get("outreach-1") as { sent_to: string; am_label: string };
    assert.equal(outreach.sent_to, "client@example.com");
    assert.equal(outreach.am_label, "Cassidy");
    assert.equal(snapshot.deleteWin(teammate.id), false);
  });

  await t.test("a blank edit is refused and the posted win stays", () => {
    const result = snapshot.updateWin(posted.id, { body: "   " });
    assert.deepEqual(result, { ok: false, error: "empty" });
    assert.equal(
      snapshot.winsForClientWeek(client.id, "2026-11-02")[0]?.body,
      "Web activity: one landing page revision"
    );
  });

  await t.test("the fill desk does not offer Send to client", () => {
    const desk = fs.readFileSync(
      new URL("../src/app/admin/snapshot/desk/page.tsx", import.meta.url),
      "utf8"
    );
    const services = fs.readFileSync(
      new URL("../src/app/admin/client-services/page.tsx", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(desk, /Send to client/);
    assert.match(services, /Send now/);
  });
});
