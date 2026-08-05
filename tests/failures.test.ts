import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts resolves its file from process.cwd() when it is first imported, so this
// suite chdirs to a throwaway directory and imports dynamically, the same way
// tests/users.test.ts does. Everything lives inside one top-level test because
// tsx compiles to CJS here, where top-level await is unavailable.

test("failures surface", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-failures-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const failures = await import("../src/lib/failures");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("nothing is wrong to begin with", () => {
    assert.equal(failures.openFailureCount(), 0);
    assert.deepEqual(failures.listOpenFailures(), []);
  });

  await t.test("records a failure", () => {
    failures.recordFailure({
      kind: "basecamp_card",
      subject: "Guardian Plumbers",
      detail: "403 from Basecamp",
      hint: "Add the mascot to the project",
    });
    const open = failures.listOpenFailures();
    assert.equal(open.length, 1);
    assert.equal(open[0].subject, "Guardian Plumbers");
    assert.equal(open[0].seen_count, 1);
    assert.equal(open[0].hint, "Add the mascot to the project");
  });

  await t.test("the same failure repeating is one row with a count", () => {
    // The whole point of the dedupe: a nightly job failing for a month must not
    // bury everything else under thirty identical rows.
    failures.recordFailure({
      kind: "basecamp_card",
      subject: "Guardian Plumbers",
      detail: "403 from Basecamp again",
    });
    const open = failures.listOpenFailures();
    assert.equal(open.length, 1);
    assert.equal(open[0].seen_count, 2);
    // The newest detail wins: a changed message usually means a changed cause.
    assert.equal(open[0].detail, "403 from Basecamp again");
  });

  await t.test("a different kind for the same client is its own row", () => {
    failures.recordFailure({
      kind: "email",
      subject: "Guardian Plumbers",
      detail: "Resend refused it",
    });
    assert.equal(failures.openFailureCount(), 2);
  });

  await t.test("success clears the matching failure", () => {
    failures.clearFailure("basecamp_card", "Guardian Plumbers");
    const open = failures.listOpenFailures();
    assert.equal(open.length, 1);
    assert.equal(open[0].kind, "email");
  });

  await t.test("clearing something that is not failing is harmless", () => {
    failures.clearFailure("basecamp_card", "Nobody At All");
    assert.equal(failures.openFailureCount(), 1);
  });

  await t.test("a cleared failure can come back", () => {
    // It has to: the app retries, and a still-broken thing must resurface
    // rather than stay hidden because it was dismissed once.
    failures.recordFailure({
      kind: "basecamp_card",
      subject: "Guardian Plumbers",
      detail: "403 again",
    });
    assert.equal(failures.openFailureCount(), 2);
  });

  await t.test("dismiss hides it and is not repeatable", () => {
    const target = failures
      .listOpenFailures()
      .find((f) => f.kind === "email")!;
    assert.equal(failures.dismissFailure(target.id), true);
    assert.equal(failures.dismissFailure(target.id), false);
    assert.equal(failures.openFailureCount(), 1);
  });

  await t.test("dismissing an unknown id reports nothing happened", () => {
    assert.equal(failures.dismissFailure("does-not-exist"), false);
  });

  await t.test("long details are capped so one row cannot swamp the panel", () => {
    failures.recordFailure({
      kind: "basecamp_campfire",
      subject: "Long One",
      detail: "x".repeat(5000),
    });
    const row = failures.listOpenFailures().find((f) => f.subject === "Long One")!;
    assert.equal(row.detail.length, 500);
  });
});
