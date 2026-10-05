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
    const {
      isInternalProject,
      isForecastExtraProject,
      filterInternalProjects,
      clientNameFor,
      clientsOnAccessibleProjects,
    } = await import("../src/lib/basecamp-clients");

    assert.equal(isInternalProject("Empire Leadership HQ"), true);
    assert.equal(isInternalProject("MEG Web HQ"), true);
    assert.equal(isInternalProject("Humble Somm Growth OS"), false);
    assert.equal(isInternalProject("Temecula Limos"), false);
    assert.equal(
      isForecastExtraProject("Temecula Limos Growth OS - Powered by the Empire Method"),
      true
    );

    const visible = filterInternalProjects([
      { id: 1, name: "Empire Leadership HQ" },
      { id: 2, name: "Humble Somm Growth OS - Powered by the Empire Method" },
      { id: 3, name: "MEG Web HQ" },
      { id: 4, name: "Temecula Limos Growth OS - Powered by the Empire Method" },
    ]);
    assert.deepEqual(
      visible.map((p) => p.name),
      [
        "Empire Leadership HQ",
        "MEG Web HQ",
        "Temecula Limos Growth OS - Powered by the Empire Method",
      ]
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
    assert.equal(
      clientNameFor("Krak Boba Piscataway Growth OS - Powered by the Empire Method"),
      "Krak Boba Piscataway"
    );

    const {
      pickBasecampProjectForClient,
      upsertForecastClientForProject,
      KRAK_BOBA_PISCATAWAY_CLIENT_NAME,
    } = await import("../src/lib/basecamp-clients");
    const { listRevClients } = await import("../src/lib/revenue");

    const piscataway = pickBasecampProjectForClient(
      [
        { id: 1, name: "Krak Boba Corporate Growth OS - Powered by the Empire Method" },
        { id: 2, name: "Krak Boba Piscataway Growth OS - Powered by the Empire Method" },
        { id: 3, name: "Krak Boba Oceanside Growth OS - Powered by the Empire Method" },
      ],
      KRAK_BOBA_PISCATAWAY_CLIENT_NAME
    );
    assert.deepEqual(piscataway, {
      id: "2",
      name: "Krak Boba Piscataway Growth OS - Powered by the Empire Method",
    });
    assert.equal(
      pickBasecampProjectForClient(
        [{ id: 1, name: "Krak Boba Corporate Growth OS" }],
        KRAK_BOBA_PISCATAWAY_CLIENT_NAME
      ),
      null
    );

    const upserted = upsertForecastClientForProject(
      piscataway!,
      KRAK_BOBA_PISCATAWAY_CLIENT_NAME
    );
    assert.equal(upserted.created, true);
    assert.equal(upserted.linked, true);
    assert.equal(upserted.clientName, "Krak Boba Piscataway");
    const row = listRevClients(true).find((c) => c.id === upserted.clientId);
    assert.equal(row?.name, "Krak Boba Piscataway");
    assert.equal(row?.basecamp_project_id, "2");
    assert.equal(row?.production_enrolled, 0);

    const again = upsertForecastClientForProject(
      piscataway!,
      KRAK_BOBA_PISCATAWAY_CLIENT_NAME
    );
    assert.equal(again.created, false);
    assert.equal(again.clientId, upserted.clientId);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
