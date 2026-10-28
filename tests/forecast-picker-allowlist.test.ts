import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  forecastPickerMatchRank,
  forecastPickerMatches,
  rankForecastPickerOptions,
} from "../src/lib/forecast-picker-search";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Partial text that is not merely the start of the full title, so a
// startsWith-only search would miss it. "leader" is the reported query.
const PARTIALS: Array<[string, string]> = [
  ["Department To-Do's Library", "todo"],
  ["EMPIRE Analytics", "analy"],
  ["Claude", "clau"],
  ["Test Poject", "poje"],
  ["Michael's Hub", "hub"],
  ["EOS EMPIRE", "empir"],
  ["MarTech Stack Recommendations", "stack"],
  ["MEG Marketing HQ", "market"],
  ["Marketing Empire Group HQ", "group"],
  ["SOPs & Job Descriptions", "sop"],
  ["MEG HQ Social", "social"],
  ["SEO HQ", "seo"],
  ["M.E.G Scripts & Prompts", "meg"],
  ["Email/SMS + Automation + Linkedin Department", "linkedin"],
  ["Social Media and Graphic Design Team", "graphic"],
  ["MEG Web HQ", "web"],
  ["MEG InFrame app", "inframe"],
  ["Video Editing Team", "edit"],
  ["Empire Ads Team", "ads"],
  ["Empire Leadership HQ", "leader"],
  ["EMPIRE Sales", "sales"],
  ["Kentina Passport Internal", "passport"],
  ["MY911 Internal Only", "911"],
  ["Amanda Barkey (EOS Implementer)", "barkey"],
  ["Deliverable Templates", "templ"],
  ["Temecula Limos Growth OS - Powered by the Empire Method", "limos"],
];

test("typing leader matches Leadership by word start, not only a full-title prefix", () => {
  assert.equal("Empire Leadership HQ".toLowerCase().startsWith("leader"), false);
  assert.equal(forecastPickerMatchRank("Empire Leadership HQ", "leader"), 1);
  assert.equal(forecastPickerMatchRank("Empire Leadership HQ", "LEADER"), 1);
  assert.equal(forecastPickerMatchRank("Empire Leadership HQ", "zzzz"), null);
  assert.equal(forecastPickerMatches("Department To-Do's Library", "todo"), true);
  assert.equal(forecastPickerMatchRank("Department To-Do's Library", "todo"), 2);
});

test("startup still defers Basecamp work and does not build the forecast picker", () => {
  for (const file of ["instrumentation.ts", "src/instrumentation.ts"]) {
    const boot = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(boot, /enqueueDeferredStartupJob/);
    assert.equal(boot.includes("forecastPickerForPerson"), false);
    assert.equal(boot.includes("listInternalProjects"), false);
  }
});

test("allowlisted internal projects are returned and searchable when the service catalog omits them", async () => {
  const clientsLib = await import("../src/lib/basecamp-clients");
  const {
    FORECAST_EXTRA_PROJECT_NAMES,
    FORECAST_INTERNAL_PROJECT_NAMES,
    assembleForecastPickerProjects,
    buildForecastPicker,
    forecastAllowlistCovered,
  } = clientsLib;

  const named = new Set(PARTIALS.map(([name]) => name));
  for (const name of FORECAST_INTERNAL_PROJECT_NAMES) {
    assert.equal(named.has(name), true, name);
  }
  for (const name of FORECAST_EXTRA_PROJECT_NAMES) {
    assert.equal(
      PARTIALS.some(([project]) => project.toLowerCase().includes(name.toLowerCase())),
      true,
      name
    );
  }

  const service = [
    { id: 1001, name: "Northwind Growth OS" },
    { id: 1003, name: "Harbor Dental Growth OS" },
    { id: 1005, name: "MEG Web HQ" },
    { id: 1006, name: "Jack" },
  ];
  const person = [
    { id: 4242, name: "Empire Leadership HQ" },
    { id: 9001, name: "Michael's Private Notes" },
    ...FORECAST_INTERNAL_PROJECT_NAMES.filter(
      (name) => name !== "MEG Web HQ" && name !== "Empire Leadership HQ"
    ).map((name, index) => ({ id: 5000 + index, name })),
  ];
  // Person already has Leadership. The owner's copy must not replace that id.
  const owner = [
    { id: 9999, name: "Empire Leadership HQ" },
    {
      id: 7777,
      name: "Temecula Limos Growth OS - Powered by the Empire Method",
    },
    { id: 8888, name: "Owner Only Side Project" },
  ];

  assert.equal(forecastAllowlistCovered(service), false);
  const projects = assembleForecastPickerProjects(service, person, owner);
  assert.equal(
    projects.find((project) => project.name === "Empire Leadership HQ")?.id,
    "4242"
  );
  assert.equal(
    projects.some((project) => project.name === "Michael's Private Notes"),
    false
  );
  assert.equal(
    projects.some((project) => project.name === "Owner Only Side Project"),
    false
  );
  assert.equal(
    projects.find((project) => /Temecula Limos/.test(project.name))?.id,
    "7777"
  );
  assert.equal(projects.find((project) => project.name === "MEG Web HQ")?.id, "1005");

  const picker = buildForecastPicker(
    [
      {
        id: "c-north",
        name: "Northwind",
        basecamp_project_id: "1001",
        active: 1,
      },
    ],
    projects
  );

  assert.ok(picker.clients.some((client) => client.id === "c-north" && !client.unlinked));
  const harbor = picker.clients.find((client) => client.id === "project:1003");
  assert.ok(harbor);
  assert.equal(harbor.unlinked, true);
  assert.match(harbor.name, /Harbor Dental/);
  const jack = picker.clients.find((client) => client.id === "project:1006");
  assert.ok(jack);
  assert.equal(jack.unlinked, true);

  const internalNames = new Set(picker.internals.map((project) => project.name));
  for (const name of FORECAST_INTERNAL_PROJECT_NAMES) {
    assert.equal(internalNames.has(name), true, name);
    assert.equal(
      picker.clients.some((client) => client.name === name),
      false,
      name
    );
  }
  assert.ok(
    picker.internals.some((project) => /Temecula Limos/.test(project.name))
  );
  assert.equal(
    picker.clients.some((client) => /Temecula Limos/.test(client.name)),
    false
  );

  const choices = [
    ...picker.clients.map((client) => ({ ...client, internal: false })),
    ...picker.internals.map((project) => ({
      id: `internal:${project.id}`,
      name: project.name,
      internal: true,
    })),
  ];
  for (const [name, query] of PARTIALS) {
    const hits = rankForecastPickerOptions(choices, query);
    assert.ok(
      hits.some((hit) => hit.name === name || hit.name.includes(name)),
      `${query} should find ${name}, got ${hits.map((hit) => hit.name).join(", ")}`
    );
  }
  const leadership = rankForecastPickerOptions(choices, "leader");
  assert.equal(leadership.length > 0, true);
  assert.equal(leadership[0].name, "Empire Leadership HQ");
  assert.equal(leadership[0].id, "internal:4242");
  assert.equal(
    (leadership[0] as { internal?: boolean }).internal,
    true
  );
  assert.equal(rankForecastPickerOptions(choices, "harbor").some((hit) => /Harbor/.test(hit.name)), true);
  assert.equal(rankForecastPickerOptions(choices, "zzzz-not-a-project").length, 0);

  // Service already has every allowlisted name: the person's other id is ignored.
  const complete: Array<{ id: number; name: string }> = FORECAST_INTERNAL_PROJECT_NAMES.map(
    (name, index) => ({
      id: 7000 + index,
      name,
    })
  );
  complete.push({
    id: 7100,
    name: "Temecula Limos Growth OS - Powered by the Empire Method",
  });
  assert.equal(forecastAllowlistCovered(complete), true);
  const kept = assembleForecastPickerProjects(
    complete,
    [{ id: 1, name: "Empire Leadership HQ" }],
    []
  );
  assert.equal(
    kept.find((project) => project.name === "Empire Leadership HQ")?.id,
    String(7000 + FORECAST_INTERNAL_PROJECT_NAMES.indexOf("Empire Leadership HQ"))
  );
});
