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

  const { closeDbForTests } = await import("../src/lib/db");
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
