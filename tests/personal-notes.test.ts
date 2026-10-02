import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("personal notes stay with their owner", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-notes-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const notes = await import("../src/lib/personal-notes");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("a note is private to the person who wrote it", () => {
    const ada = notes.createPersonalNote("ada", { title: "Call list", body: "Roy, then Jack" });
    const beau = notes.createPersonalNote("beau", { title: "Secret", body: "not for Ada" });

    assert.equal(notes.listPersonalNotes("ada").length, 1);
    assert.equal(notes.listPersonalNotes("ada")[0].id, ada.id);
    assert.equal(notes.getPersonalNote("ada", beau.id), null);
    assert.equal(notes.updatePersonalNote("ada", beau.id, { title: "stolen" }), null);
    assert.equal(notes.deletePersonalNote("ada", beau.id), false);
    assert.equal(notes.getPersonalNote("beau", beau.id)?.title, "Secret");
    assert.equal(notes.getPersonalNote("beau", beau.id)?.body, "not for Ada");
  });

  await t.test("pinned notes sit above newer ones", () => {
    const older = notes.createPersonalNote("cara", { title: "Older", body: "keep" });
    const newer = notes.createPersonalNote("cara", { title: "Newer", body: "fresh" });
    getDb().prepare(`UPDATE personal_notes SET updated_at = ? WHERE id = ?`).run(
      "2026-01-01T00:00:00.000Z",
      older.id
    );
    getDb().prepare(`UPDATE personal_notes SET updated_at = ? WHERE id = ?`).run(
      "2026-06-01T00:00:00.000Z",
      newer.id
    );

    assert.deepEqual(
      notes.listPersonalNotes("cara").map((note) => note.id),
      [newer.id, older.id]
    );

    const pinned = notes.updatePersonalNote("cara", older.id, { pinned: true });
    assert.equal(pinned?.pinned, 1);
    assert.deepEqual(
      notes.listPersonalNotes("cara").map((note) => note.id),
      [older.id, newer.id]
    );
  });

  await t.test("a partial edit leaves the rest of the note alone", () => {
    const note = notes.createPersonalNote("dana", {
      title: "  Launch plan  ",
      body: "  keep the indent\n",
    });
    assert.equal(note.title, "Launch plan");
    assert.equal(note.body, "  keep the indent\n");

    const renamed = notes.updatePersonalNote("dana", note.id, { title: "Launch" });
    assert.equal(renamed?.title, "Launch");
    assert.equal(renamed?.body, "  keep the indent\n");
    assert.equal(renamed?.pinned, 0);
  });

  await t.test("titles and bodies are clipped, and a blank owner is refused", () => {
    const title = "n".repeat(notes.NOTE_TITLE_MAX + 40);
    const body = "b".repeat(notes.NOTE_BODY_MAX + 10);
    const note = notes.createPersonalNote("erin", { title, body });
    assert.equal(note.title.length, notes.NOTE_TITLE_MAX);
    assert.equal(note.body.length, notes.NOTE_BODY_MAX);
    assert.equal(notes.deletePersonalNote("erin", note.id), true);
    assert.equal(notes.getPersonalNote("erin", note.id), null);

    assert.throws(() => notes.createPersonalNote("", { title: "nope" }));
    assert.throws(() => notes.createPersonalNote("ada:impersonated", { title: "nope" }));
  });

  await t.test("the public shape omits the owner", () => {
    const note = notes.createPersonalNote("fran", { title: "Mine", body: "yes" });
    const shown = notes.publicNote(note);
    assert.equal("owner" in shown, false);
    assert.equal(shown.id, note.id);
    assert.equal(shown.title, "Mine");
  });
});
