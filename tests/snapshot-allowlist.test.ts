import assert from "node:assert/strict";
import test from "node:test";
import {
  SNAPSHOT_ALLOWLIST_NAMES,
  allowlistPhraseMatches,
  isSnapshotAllowlisted,
  unmatchedAllowlistNames,
} from "../src/lib/snapshot-allowlist";

const LOCAL_DB_NAMES = [
  "12 Volt Power",
  "Chaparral Junk Removal & Handyman Services",
  "CISCo Restaurant + Bar",
  "Ecoworkz",
  "Hendos Barrel House",
  "HR Innovator Group",
  "Krak Boba Corporate",
  "Krak Boba Temecula",
  "Looda House Pawn",
  "Pacific Coast Generation",
  "Pipe It Right",
  "Scott Cole Plumbing",
  "Sierra Sprinkler",
  "Titan Tent & Event Rentals",
  "Trailhead Family Chiropractic",
  "Vitatherapy Wellness Medspa",
];

test("Michael's phrases match the stored names, including typos and punctuation", () => {
  assert.equal(allowlistPhraseMatches("Pacific Coast Generation", "Pacific Coast Generation"), true);
  assert.equal(allowlistPhraseMatches("Hendo's Barrel House", "Hendos Barrel House"), true);
  assert.equal(allowlistPhraseMatches("CISCo Restauraunt + Bar", "CISCo Restaurant + Bar"), true);
  assert.equal(allowlistPhraseMatches("Vitatherapy Wellness Spa", "Vitatherapy Wellness Medspa"), true);
  assert.equal(allowlistPhraseMatches("Ecoworkz", "Ecoworkz"), true);
  assert.equal(allowlistPhraseMatches("12 Volt Power", "12 Volt Power"), true);
  assert.equal(allowlistPhraseMatches("Our Watch / tim thompson", "Our Watch"), true);
  assert.equal(allowlistPhraseMatches("Our Watch / tim thompson", "Tim Thompson"), true);
});

test("nearby clients are not pulled in", () => {
  assert.equal(isSnapshotAllowlisted("Krak Boba Temecula"), false);
  assert.equal(isSnapshotAllowlisted("Chaparral Junk Removal & Handyman Services"), false);
  assert.equal(isSnapshotAllowlisted("Scott Cole Plumbing"), false);
  assert.equal(isSnapshotAllowlisted("Krak Boba Corporate"), true);
});

test("unmatched allowlist entries stay on the list until those clients exist", () => {
  const unmatched = unmatchedAllowlistNames(LOCAL_DB_NAMES);
  assert.deepEqual(unmatched, [
    "Betterlife Coach",
    "Our Watch / tim thompson",
    "CIPO Cloud Software",
    "Guardian Plumbers",
    "Kentina Hospitality",
  ]);
  assert.equal(SNAPSHOT_ALLOWLIST_NAMES.length, 15);
  assert.equal(LOCAL_DB_NAMES.filter(isSnapshotAllowlisted).length, 10);
});

test("listAccounts and the behind report hide everyone off the allowlist", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-allow-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const now = nowIso();
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("on", "Pipe It Right", now, now);
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("off", "Chaparral Junk Removal & Handyman Services", now, now);
  const names = snapshot.listAccounts().map((a) => a.name);
  assert.deepEqual(names, ["Pipe It Right"]);
  assert.equal(snapshot.getVisibleSnapshotAccount("on")?.name, "Pipe It Right");
  assert.equal(snapshot.getVisibleSnapshotAccount("off"), null);
  assert.deepEqual(snapshot.behindReportAllClients(), []);
});
