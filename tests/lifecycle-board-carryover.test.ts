import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Adding or removing a client on the Deliverables board is a standing decision:
// it carries into every later month, and leaves months already worked alone.
// The behaviour that matters is which cards a month's board shows, so this runs
// against listBoardCards with a real table rather than testing the writes.

function shift(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

test("board removals and adds carry forward, never backward", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-board-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const board = await import("../src/lib/lifecycle-board");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const db = getDb();
  const insertClient = db.prepare(
    `INSERT INTO rev_clients (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`
  );
  insertClient.run("cl_1", "Humble Somm", now, now);
  insertClient.run("cl_2", "Pipe It Right", now, now);

  const current = board.currentPeriod();
  const last = shift(current, -1);
  const next = shift(current, 1);
  const twoAhead = shift(current, 2);

  const names = (period: string) =>
    board.listBoardCards(period).map((c) => c.clientName).sort();

  // Open last month first, so it has real rows to protect.
  assert.deepEqual(names(last), ["Humble Somm", "Pipe It Right"]);

  await t.test("removing sweeps this month and every later one", () => {
    const card = board.listBoardCards(current).find((c) => c.clientId === "cl_1");
    assert.ok(card);
    assert.equal(board.deleteBoardCard(card.id), true);

    assert.deepEqual(names(current), ["Pipe It Right"]);
    assert.deepEqual(names(next), ["Pipe It Right"]);
    // A month never opened before must not be seeded back with the client.
    assert.deepEqual(names(twoAhead), ["Pipe It Right"]);
  });

  await t.test("a month already worked keeps its card", () => {
    assert.deepEqual(names(last), ["Humble Somm", "Pipe It Right"]);
  });

  await t.test("adding back from a future month leaves earlier months off", () => {
    assert.equal(board.addBoardCard("cl_1", next), true);

    assert.deepEqual(names(next), ["Humble Somm", "Pipe It Right"]);
    assert.deepEqual(names(twoAhead), ["Humble Somm", "Pipe It Right"]);
    // The months the removal already covered stay as they were.
    assert.deepEqual(names(current), ["Pipe It Right"]);
  });

  await t.test("removing on a past board changes only that card", () => {
    const card = board.listBoardCards(last).find((c) => c.clientId === "cl_2");
    assert.ok(card);
    assert.equal(board.deleteBoardCard(card.id), true);

    assert.deepEqual(names(last), ["Humble Somm"]);
    // Still a standing removal from now on, just not rewriting other history.
    assert.deepEqual(names(current), []);
    assert.deepEqual(names(next), ["Humble Somm"]);
  });
});
