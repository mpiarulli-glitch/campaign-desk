import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("internal Basecamp projects stay out of client import and show in forecast", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bc-clients-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  try {
    const { isInternalProject, filterInternalProjects, clientNameFor, clientsOnAccessibleProjects } =
      await import("../src/lib/basecamp-clients");

    assert.equal(isInternalProject("Empire Leadership HQ"), true);
    assert.equal(isInternalProject("MEG Web HQ"), true);
    assert.equal(isInternalProject("Humble Somm Growth OS"), false);

    const visible = filterInternalProjects([
      { id: 1, name: "Empire Leadership HQ" },
      { id: 2, name: "Humble Somm Growth OS - Powered by the Empire Method" },
      { id: 3, name: "MEG Web HQ" },
    ]);
    assert.deepEqual(
      visible.map((p) => p.name),
      ["Empire Leadership HQ", "MEG Web HQ"]
    );

    // A person who is only on Web HQ must not see Leadership HQ just because
    // it is on the internal allowlist — membership is the filter.
    assert.deepEqual(
      filterInternalProjects([{ id: 3, name: "MEG Web HQ" }]).map((p) => p.name),
      ["MEG Web HQ"]
    );

    const accessible = clientsOnAccessibleProjects(
      [
        { id: "c1", name: "Humble Somm", basecamp_project_id: "111" },
        { id: "c2", name: "Secret Client", basecamp_project_id: "999" },
        { id: "c3", name: "Unlinked", basecamp_project_id: "" },
      ],
      new Set(["111"])
    );
    assert.deepEqual(
      accessible.map((c) => c.name),
      ["Humble Somm", "Unlinked"]
    );

    assert.equal(
      clientNameFor("Humble Somm Growth OS - Powered by the Empire Method"),
      "Humble Somm"
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
