import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The add-task list used to be "clients this person is a member of, plus a
// hardcoded internal allowlist". A Basecamp project with no client row, or one
// the person had not been added to, never appeared. These cases are the account
// catalog instead: every project, including ones Campaign Desk does not know yet.

test("forecast picker offers every Basecamp project", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-projects-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const clientsLib = await import("../src/lib/basecamp-clients");
  const { createRevClient, listRevClients, updateRevClient } = await import("../src/lib/revenue");
  const access = await import("../src/lib/access");

  const jack = access.subjectFor("jack");
  assert.equal(jack.role, "forecast");
  assert.equal(access.allows(jack, "page.forecast"), true);
  assert.equal(access.canSeeForecastOf(jack, "jack"), true);
  assert.equal(access.allows(jack, "tool.forecast_all"), false);

  assert.equal(clientsLib.forecastPickerProjectId("project:48628386"), "48628386");
  assert.equal(clientsLib.forecastPickerProjectId("internal:42"), "42");
  assert.equal(clientsLib.forecastPickerProjectId("client_abc"), null);
  assert.equal(clientsLib.forecastPickerProjectId("project:nope"), null);

  const linked = createRevClient({ name: "Northwind", businessModel: "b2b" });
  updateRevClient(linked.id, { basecampProjectId: "1001" });
  const blank = createRevClient({ name: "Pinnacle Roofing", businessModel: "home_service" });
  const secret = createRevClient({ name: "Secret Client", businessModel: "b2b" });
  updateRevClient(secret.id, { basecampProjectId: "9999" });

  const projects = [
    { id: 1001, name: "Northwind Growth OS" },
    { id: 1002, name: "Pinnacle Roofing Growth OS - Powered by the Empire Method" },
    { id: 1003, name: "Harbor Dental Growth OS" },
    { id: 1004, name: "Empire Leadership HQ" },
    { id: 1005, name: "MEG Web HQ" },
    ...Array.from({ length: 40 }, (_, i) => ({
      id: 2000 + i,
      name: `Client Project ${String(i + 1).padStart(2, "0")}`,
    })),
  ];

  const picker = clientsLib.buildForecastPicker(
    listRevClients(false).map((c) => ({
      id: c.id,
      name: c.name,
      basecamp_project_id: c.basecamp_project_id || "",
      active: c.active,
    })),
    projects
  );

  assert.ok(picker.clients.some((c) => c.id === linked.id && !c.unlinked));
  assert.equal(
    picker.clients.some((c) => c.id === "project:1001"),
    false,
    "a linked project is the client row, not a second choice"
  );
  const pinnacle = picker.clients.find((c) => c.id === "project:1002");
  assert.ok(pinnacle);
  assert.equal(pinnacle.unlinked, true);
  assert.match(pinnacle.name, /Pinnacle Roofing/);
  const harbor = picker.clients.find((c) => c.id === "project:1003");
  assert.ok(harbor);
  assert.match(harbor.name, /Harbor Dental/);
  assert.equal(
    picker.clients.some((c) => /Empire Leadership|MEG Web HQ/.test(c.name)),
    false
  );
  assert.deepEqual(
    picker.internals.map((p) => p.id).sort(),
    ["1004", "1005"]
  );
  // Secret Client's project is not in this person's membership. It still shows.
  assert.ok(picker.clients.some((c) => c.id === secret.id));
  assert.ok(picker.clients.filter((c) => c.unlinked).length >= 41);

  const linkedByName = clientsLib.ensureForecastClientForProject(projects[1]);
  assert.equal(linkedByName.created, false);
  assert.equal(linkedByName.linked, true);
  assert.equal(linkedByName.clientId, blank.id);
  assert.equal(
    listRevClients(true).find((c) => c.id === blank.id)?.basecamp_project_id,
    "1002"
  );

  const before = listRevClients(true).length;
  const created = clientsLib.ensureForecastClientForProject(projects[2]);
  assert.equal(created.created, true);
  assert.equal(created.linked, true);
  assert.equal(created.clientName, "Harbor Dental");
  const createdRow = listRevClients(true).find((c) => c.id === created.clientId);
  assert.equal(createdRow?.basecamp_project_id, "1003");
  assert.equal(createdRow?.production_enrolled, 0);
  assert.equal(createdRow?.active, 1);
  assert.equal(listRevClients(true).length, before + 1);

  const again = clientsLib.ensureForecastClientForProject(projects[2]);
  assert.equal(again.created, false);
  assert.equal(again.clientId, created.clientId);
  assert.equal(listRevClients(true).length, before + 1);

  const internal = clientsLib.ensureForecastClientForProject({
    id: 1004,
    name: "Empire Leadership HQ",
  });
  assert.equal(internal.internal, true);
  assert.equal(internal.created, false);
  assert.equal(internal.clientId, "");
  assert.equal(
    listRevClients(true).some((c) => c.name === "Empire Leadership HQ"),
    false
  );

  const personNamed = clientsLib.ensureForecastClientForProject({ id: 3001, name: "Jack" });
  assert.equal(personNamed.created, false);
  assert.equal(personNamed.clientId, "");

  const taken = createRevClient({ name: "Taken Name", businessModel: "b2b" });
  updateRevClient(taken.id, { basecampProjectId: "8888" });
  const collision = clientsLib.ensureForecastClientForProject({
    id: 3002,
    name: "Taken Name Growth OS",
  });
  assert.equal(collision.created, false);
  assert.equal(collision.clientId, "");
  assert.equal(listRevClients(true).filter((c) => c.name === "Taken Name").length, 1);
  assert.equal(
    listRevClients(true).find((c) => c.id === taken.id)?.basecamp_project_id,
    "8888"
  );
});
