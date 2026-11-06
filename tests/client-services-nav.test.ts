import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("Client Services uses a person icon and the cards are this week's activity", () => {
  const access = fs.readFileSync(new URL("../src/lib/access.ts", import.meta.url), "utf8");
  const shell = fs.readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  const page = fs.readFileSync(
    new URL("../src/app/admin/client-services/page.tsx", import.meta.url),
    "utf8"
  );
  const grid = fs.readFileSync(
    new URL("../src/components/SnapshotAccountGrid.tsx", import.meta.url),
    "utf8"
  );

  const hub = access.slice(
    access.indexOf('key: "page.client_services_hub"'),
    access.indexOf('key: "page.client_services"')
  );
  assert.match(hub, /icon: "person"/);
  assert.doesNotMatch(hub, /icon: "mail"/);
  assert.match(shell, /person: <>/);
  assert.match(page, /Weekly snapshots\. Send the Friday ask from here\./);
  assert.doesNotMatch(page, /deliverable setup/i);
  assert.match(page, /SnapshotAccountGrid/);
  assert.match(grid, /tasks started/);
  assert.match(grid, /wins/);
  assert.doesNotMatch(grid, /deliverables tracked/i);
  assert.doesNotMatch(grid, /Needs attention/);
});
