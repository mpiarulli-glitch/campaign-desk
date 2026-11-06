import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("the client portal only receives the week being viewed", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-wins-"));
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
    name: "Ecoworkz",
    businessModel: "home_service",
  });
  snapshot.addWin({
    clientId: client.id,
    body: "Optimized Google Search ads",
    happenedOn: "2026-10-20",
    weekStart: "2026-10-19",
  });
  snapshot.addWin({
    clientId: client.id,
    body: "1 positive email response this week",
    happenedOn: "2026-11-04",
    weekStart: "2026-11-02",
  });

  await t.test("this week is one win, and the older win stays stored", () => {
    const shown = snapshot.winsForClientWeek(client.id, "2026-11-02");
    assert.deepEqual(
      shown.map((win) => win.body),
      ["1 positive email response this week"]
    );
    assert.equal(snapshot.listWins(client.id).length, 2);
    const prior = snapshot.winsForClientWeek(client.id, "2026-10-19");
    assert.deepEqual(
      prior.map((win) => win.body),
      ["Optimized Google Search ads"]
    );
  });
});
