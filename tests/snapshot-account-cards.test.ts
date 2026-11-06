import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("snapshot client cards show this week's tasks and wins", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-cards-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const enrollment = await import("../src/lib/snapshot-enrollment");
  const snapshot = await import("../src/lib/snapshot");
  const depts = await import("../src/lib/snapshot-departments");
  const { currentWeek, addWeeks } = await import("../src/lib/week");
  const { SnapshotAccountGrid } = await import("../src/components/SnapshotAccountGrid");
  t.after(() => closeDbForTests());

  const client = revenue.createRevClient({
    name: "12 Volt Power",
    businessModel: "home_service",
  });
  revenue.updateRevClient(client.id, { tier: "tier1" });
  enrollment.enrollSnapshotClient(client.id, "kyle_morris");
  snapshot.createDeliverable({
    clientId: client.id,
    category: "Ads",
    name: "Weekly ad review",
    cadence: "Weekly",
    team: "ads",
  });

  const week = currentWeek();
  const prior = addWeeks(week, -1);
  for (let i = 0; i < 15; i++) {
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: i % 2 === 0 ? "ads" : "social",
      body: `Logged line ${i + 1}`,
    });
  }
  depts.addDepartmentItem({
    clientId: client.id,
    weekStart: prior,
    department: "ads",
    body: "Last week's line",
  });
  snapshot.addWin({
    clientId: client.id,
    body: "Closed two jobs",
    weekStart: week,
    happenedOn: week,
  });
  snapshot.addWin({
    clientId: client.id,
    body: "Booked the review",
    weekStart: week,
    happenedOn: week,
  });
  snapshot.addWin({
    clientId: client.id,
    body: "An older win",
    weekStart: prior,
    happenedOn: prior,
  });

  await t.test("the card counts this week's lines and wins, not the deliverable roster", () => {
    const card = snapshot.listAccountPickerCards().find((row) => row.id === client.id);
    assert.ok(card);
    assert.equal(card.tasks_started, 15);
    assert.equal(card.wins, 2);
    assert.equal(card.category, "Tier 1");
    assert.equal("deliverable_count" in card, false);
    assert.equal("behind_count" in card, false);
    assert.equal("description" in card, false);
  });

  await t.test("the card renders tasks started and wins, not deliverable tracking", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotAccountGrid, {
        accounts: [
          {
            id: client.id,
            name: "12 Volt Power",
            tasks_started: 15,
            wins: 2,
            logo_url: null,
            website: "",
            category: "Tier 1",
          },
        ],
      })
    );
    assert.match(html, /12 Volt Power/);
    assert.match(html, /Tier 1/);
    assert.match(html, /15 tasks started/);
    assert.match(html, /2 wins/);
    assert.doesNotMatch(html, /deliverable/i);
    assert.doesNotMatch(html, /Needs attention/);
    assert.doesNotMatch(html, /overdue/i);
  });
});

test("snapshot pages do not show How to fill or Behind report buttons", () => {
  const files = [
    "src/app/admin/snapshot/desk/page.tsx",
    "src/app/admin/snapshot/[id]/page.tsx",
    "src/app/admin/snapshot/[id]/backfill/page.tsx",
    "src/app/admin/snapshot/behind/page.tsx",
    "src/app/admin/snapshot/instructions/page.tsx",
    "src/app/admin/client-services/page.tsx",
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const actions = source.match(/className="page-actions"[\s\S]*?<\/div>/);
    assert.ok(actions, `${file} has page actions`);
    assert.doesNotMatch(actions[0], /How to fill/, file);
    assert.doesNotMatch(actions[0], /Behind report/, file);
  }
});
