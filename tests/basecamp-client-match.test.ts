import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  basecampProjectChoices,
  isPersonOrInternalClientName,
  matchUnlinkedClients,
  normalizeClientMatchKey,
  type MatchClient,
  type MatchProject,
} from "../src/lib/basecamp-client-match";

const NORLO_PROJECT = "NORLO Peptides Growth OS – Powered by the Empire Method™";

function client(partial: Partial<MatchClient> & Pick<MatchClient, "id" | "name">): MatchClient {
  return {
    basecampProjectId: "",
    active: true,
    ...partial,
  };
}

function plan(clients: MatchClient[], projects: MatchProject[]) {
  return matchUnlinkedClients(clients, projects);
}

test("normalizeClientMatchKey folds case, punctuation, and, and legal suffixes", () => {
  assert.equal(normalizeClientMatchKey("NORLO Peptides"), "norlo peptides");
  assert.equal(normalizeClientMatchKey("  norlo   peptides "), "norlo peptides");
  assert.equal(normalizeClientMatchKey("NORLO Peptides,"), "norlo peptides");
  assert.equal(normalizeClientMatchKey("NORLO Peptides."), "norlo peptides");
  assert.equal(normalizeClientMatchKey(NORLO_PROJECT), "norlo peptides");
  assert.equal(normalizeClientMatchKey("NORLO Peptides, LLC"), "norlo peptides");
  assert.equal(normalizeClientMatchKey("NORLO Peptides L.L.C."), "norlo peptides");
  assert.equal(normalizeClientMatchKey("Acme, Inc."), "acme");
  assert.equal(normalizeClientMatchKey("Acme Incorporated"), "acme");
  assert.equal(normalizeClientMatchKey("Smith & Sons"), "smith and sons");
  assert.equal(normalizeClientMatchKey("Smith and Sons, Inc."), "smith and sons");
  assert.equal(normalizeClientMatchKey("Smith&Sons"), "smith and sons");
  assert.equal(normalizeClientMatchKey("Smith Co."), "smith");
  assert.equal(normalizeClientMatchKey("LMX Health - Marketing"), "lmx health");
  assert.equal(normalizeClientMatchKey("LMX Health – Marketing"), "lmx health");
  assert.equal(normalizeClientMatchKey("LMX Health Marketing"), "lmx health marketing");
  assert.equal(normalizeClientMatchKey("FloorCo Design"), "floorco design");
  assert.equal(normalizeClientMatchKey("Café Olé"), "cafe ole");
  assert.equal(normalizeClientMatchKey("D'Angelo's"), "dangelos");
  assert.equal(normalizeClientMatchKey("DAngelos"), "dangelos");
  assert.equal(normalizeClientMatchKey("LLC"), "llc");
  assert.equal(normalizeClientMatchKey(""), "");
  // A shorter name is not the same account.
  assert.notEqual(normalizeClientMatchKey("NORLO"), normalizeClientMatchKey("NORLO Peptides"));
});

test("matchUnlinkedClients saves only a single confident name", () => {
  const projects: MatchProject[] = [
    { id: "48158835", name: NORLO_PROJECT },
    { id: "200", name: "Smith and Sons Inc." },
    { id: "300", name: "Empire Leadership HQ" },
    { id: "400", name: "Acme LLC" },
    { id: "401", name: "Acme, Inc." },
    { id: "500", name: "NORLO Peptides West" },
  ];
  const clients = [
    client({ id: "norlo", name: "NORLO Peptides, LLC" }),
    client({ id: "smith", name: "Smith & Sons" }),
    client({ id: "short", name: "NORLO" }),
    client({ id: "hq", name: "Empire Leadership HQ" }),
    client({ id: "acme", name: "Acme" }),
    client({ id: "kept", name: "Already Linked", basecampProjectId: "999" }),
    client({ id: "blank", name: "   " }),
  ];

  const result = matchUnlinkedClients(clients, projects, {
    isInternal: (name) => name === "Empire Leadership HQ",
  });
  assert.deepEqual(
    result.matches.map((m) => [m.clientId, m.projectId]).sort(),
    [
      ["norlo", "48158835"],
      ["smith", "200"],
    ]
  );
  assert.equal(
    result.ambiguous.some((a) => a.clientId === "acme" && a.options.length === 2),
    true
  );
  assert.ok(result.unmatched.some((u) => u.clientId === "short"));
  assert.ok(result.unmatched.some((u) => u.clientId === "hq"));
  assert.equal(
    result.matches.some((m) => m.clientId === "kept" || m.clientId === "acme"),
    false
  );
});

test("two clients that normalize to one project are both left blank", () => {
  const result = plan(
    [
      client({ id: "a", name: "NORLO Peptides" }),
      client({ id: "b", name: "NORLO Peptides LLC" }),
    ],
    [{ id: "1", name: NORLO_PROJECT }]
  );
  assert.equal(result.matches.length, 0);
  assert.equal(result.ambiguous.length, 2);
});

test("a project already on another client is not taken by a second name match", () => {
  const result = plan(
    [
      client({ id: "has", name: "Other", basecampProjectId: "1" }),
      client({ id: "wants", name: "NORLO Peptides" }),
    ],
    [{ id: "1", name: "NORLO Peptides" }]
  );
  assert.equal(result.matches.length, 0);
  assert.ok(result.unmatched.some((u) => u.clientId === "wants"));
});

test("inactive clients are not matched, but their project id stays reserved", () => {
  const result = plan(
    [
      client({ id: "old", name: "NORLO Peptides", active: false, basecampProjectId: "1" }),
      client({ id: "new", name: "NORLO Peptides" }),
    ],
    [{ id: "1", name: "NORLO Peptides Growth OS" }]
  );
  assert.equal(result.matches.length, 0);
});

test("a curated alias is confident even when the titles differ", () => {
  const result = matchUnlinkedClients(
    [client({ id: "h", name: "Hendos Barrel House" })],
    [{ id: "47628800", name: "HBH warehouse" }],
    { aliases: { "47628800": "Hendos Barrel House" } }
  );
  assert.equal(result.matches[0]?.projectId, "47628800");
});

test("internal projects are omitted from the picker, duplicate titles keep their id", () => {
  const choices = basecampProjectChoices(
    [
      { id: "3", name: "Empire Leadership HQ" },
      { id: "1", name: "Acme Growth OS" },
      { id: "2", name: "Acme Growth OS" },
      { id: "4", name: "NORLO Peptides" },
    ],
    (name) => name === "Empire Leadership HQ"
  );
  assert.deepEqual(
    choices.map((c) => c.name),
    ["Acme Growth OS (#1)", "Acme Growth OS (#2)", "NORLO Peptides"]
  );
});

test("a teammate or internal workspace is not a client to link", () => {
  const internal = (name: string) => name === "Empire Leadership HQ";
  assert.equal(isPersonOrInternalClientName("Carlos", ["Carlos", "Sylvia"], internal), true);
  assert.equal(isPersonOrInternalClientName("carlos", ["Carlos"], internal), true);
  assert.equal(isPersonOrInternalClientName("Carlos Cleaning", ["Carlos"], internal), false);
  assert.equal(isPersonOrInternalClientName("Empire Leadership HQ", [], internal), true);
  assert.equal(isPersonOrInternalClientName("NORLO Peptides", ["Carlos"], internal), false);

  const skipped = matchUnlinkedClients(
    [client({ id: "carlos", name: "Carlos", eligible: false })],
    [{ id: "1", name: "Carlos" }]
  );
  assert.equal(skipped.matches.length, 0);
  assert.equal(skipped.unmatched.length, 0);
});

test("linking fills blanks once, skips guesses, and survives a second run", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bc-link-"));
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.log = () => {};
  console.error = () => {};
  console.info = () => {};
  console.warn = () => {};
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
    console.info = originalInfo;
    console.warn = originalWarn;
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const links = await import("../src/lib/basecamp-client-links");
  const { createRevClient, getRevClient, updateRevClient } = await import("../src/lib/revenue");
  links.resetBasecampProjectCacheForTests();

  const norlo = createRevClient({ name: "NORLO Peptides, LLC", businessModel: "ecomm" });
  const smith = createRevClient({ name: "Smith & Sons", businessModel: "b2b" });
  const guess = createRevClient({ name: "NORLO", businessModel: "ecomm" });
  const kept = createRevClient({ name: "Keep Me", businessModel: "ecomm" });
  updateRevClient(kept.id, { basecampProjectId: "999" });
  const hidden = createRevClient({ name: "Hidden Co", businessModel: "ecomm" });
  updateRevClient(hidden.id, { active: false });
  const acme = createRevClient({ name: "Acme", businessModel: "ecomm" });

  const projects = [
    { id: 48158835, name: NORLO_PROJECT },
    { id: 200, name: "Smith and Sons, Inc." },
    { id: 300, name: "Empire Leadership HQ" },
    { id: 400, name: "Acme LLC" },
    { id: 401, name: "Acme, Inc." },
    { id: 111, name: "Keep Me Growth OS" },
    { id: 700, name: "Hidden" },
  ];
  let calls = 0;
  const loadProjects = async () => {
    calls += 1;
    return projects;
  };
  const deps = {
    connected: () => true,
    loadProjects,
    now: () => 1_000,
    force: true,
  };

  const first = await links.linkMissingBasecampProjects(deps);
  assert.equal(first.ok, true);
  assert.equal(first.error, null);
  assert.equal(getRevClient(norlo.id)?.basecamp_project_id, "48158835");
  assert.equal(getRevClient(smith.id)?.basecamp_project_id, "200");
  assert.equal(getRevClient(guess.id)?.basecamp_project_id, "");
  assert.equal(getRevClient(kept.id)?.basecamp_project_id, "999");
  assert.equal(getRevClient(hidden.id)?.basecamp_project_id, "");
  assert.equal(getRevClient(acme.id)?.basecamp_project_id, "");
  assert.equal(
    links.listForecastClientsMissingBasecamp().some((c) => c.id === hidden.id),
    false
  );
  assert.ok(links.listForecastClientsMissingBasecamp().some((c) => c.id === guess.id));
  assert.equal(
    first.projects.some((p) => p.name === "Empire Leadership HQ"),
    false
  );

  const again = await links.linkMissingBasecampProjects({ ...deps, force: false, now: () => 2_000 });
  assert.equal(again.ok, true);
  assert.equal(again.fromCache, true);
  assert.equal(again.linked.length, 0);
  assert.equal(calls, 1);
  assert.equal(getRevClient(norlo.id)?.basecamp_project_id, "48158835");

  const later = createRevClient({ name: "Later Labs LLC", businessModel: "b2b" });
  projects.push({ id: 800, name: "Later Labs" });
  const cached = await links.linkMissingBasecampProjects({
    ...deps,
    force: false,
    now: () => 3_000,
  });
  // The cached listing does not include Later Labs yet, so the new client stays flagged.
  assert.equal(getRevClient(later.id)?.basecamp_project_id, "");
  assert.equal(cached.fromCache, true);
  assert.ok(links.listForecastClientsMissingBasecamp().some((c) => c.id === later.id));

  const fresh = await links.linkMissingBasecampProjects({
    ...deps,
    force: true,
    now: () => 3_000 + links.BASECAMP_PROJECT_CACHE_MS + 1,
  });
  assert.equal(fresh.fromCache, false);
  assert.equal(calls, 2);
  assert.equal(getRevClient(later.id)?.basecamp_project_id, "800");

  const dry = createRevClient({ name: "Dry Run Co", businessModel: "ecomm" });
  projects.push({ id: 801, name: "Dry Run" });
  const preview = await links.linkMissingBasecampProjects({
    ...deps,
    dryRun: true,
    force: true,
    now: () => 9_000_000,
  });
  assert.equal(preview.dryRun, true);
  assert.ok(preview.linked.some((row) => row.clientId === dry.id));
  assert.equal(getRevClient(dry.id)?.basecamp_project_id, "");

  const down = await links.linkMissingBasecampProjects({
    ...deps,
    force: true,
    connected: () => false,
  });
  assert.equal(down.ok, false);
  assert.match(down.error || "", /King Kashflow/);
  assert.equal(getRevClient(dry.id)?.basecamp_project_id, "");

  const empty = await links.linkMissingBasecampProjects({
    ...deps,
    force: true,
    connected: () => true,
    loadProjects: async () => [],
  });
  assert.equal(empty.ok, false);
  assert.match(empty.error || "", /didn't return any projects/);

  const thrown = await links.linkMissingBasecampProjects({
    ...deps,
    force: true,
    loadProjects: async () => {
      throw new Error("Basecamp not connected");
    },
  });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error || "", /isn't connected/);

  const picked = await links.linkClientToBasecampProject(guess.id, "500", {
    connected: () => true,
    force: true,
    loadProjects: async () => [{ id: "500", name: "NORLO West" }],
  });
  assert.equal(picked.ok, true);
  assert.equal(getRevClient(guess.id)?.basecamp_project_id, "500");
  const secondPick = await links.linkClientToBasecampProject(guess.id, "501", {
    connected: () => true,
    force: true,
    loadProjects: async () => [{ id: "501", name: "Other" }],
  });
  assert.equal(secondPick.ok, false);
  assert.equal(getRevClient(guess.id)?.basecamp_project_id, "500");

  const internalPick = await links.linkClientToBasecampProject(acme.id, "300", {
    connected: () => true,
    force: true,
    loadProjects: async () => [{ id: "300", name: "Empire Leadership HQ" }],
  });
  assert.equal(internalPick.ok, false);
  assert.equal(getRevClient(acme.id)?.basecamp_project_id, "");

  const carlos = createRevClient({ name: "Carlos", businessModel: "b2b" });
  const carlosCleaning = createRevClient({
    name: "Carlos Cleaning",
    businessModel: "home_service",
  });
  const withPeople = await links.linkMissingBasecampProjects({
    connected: () => true,
    force: true,
    now: () => 20_000_000,
    loadProjects: async () => [
      { id: "910", name: "Carlos" },
      { id: "911", name: "Carlos Cleaning" },
    ],
  });
  assert.equal(withPeople.ok, true);
  assert.equal(getRevClient(carlos.id)?.basecamp_project_id, "");
  assert.equal(getRevClient(carlosCleaning.id)?.basecamp_project_id, "911");
  assert.equal(
    links.listForecastClientsMissingBasecamp().some((row) => row.id === carlos.id),
    false
  );

  links.resetBasecampProjectCacheForTests();
  let silentCalls = 0;
  const firstSilent = await links.linkMissingBasecampProjects({
    silent: true,
    now: () => 30_000_000,
    connected: () => true,
    loadProjects: async () => {
      silentCalls += 1;
      throw new Error("Basecamp not connected");
    },
  });
  assert.equal(firstSilent.ok, false);
  assert.equal(silentCalls, 1);
  const secondSilent = await links.linkMissingBasecampProjects({
    silent: true,
    now: () => 30_000_000 + 1_000,
    connected: () => true,
    loadProjects: async () => {
      silentCalls += 1;
      throw new Error("Basecamp not connected");
    },
  });
  assert.equal(secondSilent.ok, true);
  assert.equal(secondSilent.skipped, true);
  assert.equal(silentCalls, 1);
});
