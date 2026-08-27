import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeGaps,
  cycleTracking,
  effectiveNurture,
  emptyTracking,
  formatSpend,
  isFunnelReady,
  landingHost,
  landingHref,
  looksLikeNurture,
  parseChannels,
  parseTracking,
  trackingPlan,
  trackingScore,
} from "../src/lib/ads";

test("channel and tracking parsers drop unknown values", () => {
  assert.deepEqual(parseChannels(["pmax", "lsa", "pmax", "nope"]), ["pmax", "lsa"]);
  assert.deepEqual(parseChannels('["search","pmax"]'), ["search", "pmax"]);
  assert.deepEqual(parseChannels("not-json"), []);

  const tracking = parseTracking({ gtm: "yes", ga4: "no", mystery: "yes", form_tracking: "maybe" });
  assert.equal(tracking.gtm, "yes");
  assert.equal(tracking.ga4, "no");
  assert.equal(tracking.form_tracking, "unknown");
  assert.equal(tracking.google_ads_tag, "unknown");
});

test("LSA requires call tracking; Meta requires the pixel", () => {
  const lsa = trackingPlan(["lsa"]);
  assert.ok(lsa.required.includes("call_tracking"));
  assert.ok(!lsa.required.includes("form_tracking"));
  assert.ok(lsa.required.includes("google_ads_tag"));

  const meta = trackingPlan(["meta"]);
  assert.ok(meta.required.includes("meta_pixel"));
  assert.ok(!meta.required.includes("google_ads_tag"));

  const search = trackingPlan(["search", "pmax"]);
  assert.ok(search.required.includes("form_tracking"));
  assert.ok(search.recommended.includes("enhanced_conversions"));
});

test("active ads without a landing page, budget, or conversion tag are blocked", () => {
  const gaps = computeGaps({
    status: "active",
    monthlySpendLimit: null,
    channels: ["pmax"],
    landingPageUrl: "",
    leadMagnet: "unknown",
    nurtureStatus: "unknown",
    tracking: emptyTracking(),
    conversionAction: "",
    lastReviewedAt: null,
    hasPpcInStrategy: true,
    nowMs: Date.parse("2026-08-27T12:00:00.000Z"),
  });
  const keys = gaps.map((g) => g.key);
  assert.ok(keys.includes("no_budget"));
  assert.ok(keys.includes("no_landing"));
  assert.ok(keys.includes("track_gtm"));
  assert.ok(keys.includes("track_google_ads_tag"));
  assert.ok(keys.includes("magnet_unknown"));
  assert.ok(keys.includes("nurture_unknown"));
  assert.ok(keys.includes("never_reviewed"));
  assert.equal(gaps.find((g) => g.key === "no_landing")?.severity, "block");
  assert.equal(gaps.find((g) => g.key === "nurture_unknown")?.severity, "watch");
});

test("ads off do not raise tracking gaps, but a PPC strategy still flags them", () => {
  const gaps = computeGaps({
    status: "off",
    monthlySpendLimit: null,
    channels: [],
    landingPageUrl: "",
    leadMagnet: "none",
    nurtureStatus: "none",
    tracking: emptyTracking(),
    conversionAction: "",
    lastReviewedAt: null,
    hasPpcInStrategy: true,
  });
  assert.deepEqual(
    gaps.map((g) => g.key),
    ["ppc_off"]
  );
});

test("a complete active funnel is ready", () => {
  const tracking = emptyTracking();
  tracking.gtm = "yes";
  tracking.ga4 = "yes";
  tracking.google_ads_tag = "yes";
  tracking.form_tracking = "yes";
  tracking.enhanced_conversions = "yes";
  tracking.thank_you_page = "yes";
  const input = {
    status: "active" as const,
    monthlySpendLimit: 2500,
    channels: ["pmax" as const],
    landingPageUrl: "https://example.com/offer",
    leadMagnet: "form" as const,
    nurtureStatus: "live" as const,
    tracking,
    conversionAction: "Form submit",
    lastReviewedAt: "2026-08-20T12:00:00.000Z",
    hasPpcInStrategy: true,
    nowMs: Date.parse("2026-08-27T12:00:00.000Z"),
  };
  const gaps = computeGaps(input);
  assert.equal(gaps.length, 0);
  assert.equal(isFunnelReady({ ...input, gaps }), true);
  assert.deepEqual(trackingScore(tracking, ["pmax"]), { done: 6, total: 6 });
});

test("detected nurture fills in an unset status", () => {
  assert.equal(effectiveNurture("unknown", "live"), "live");
  assert.equal(effectiveNurture("none", "live"), "none");
  assert.equal(looksLikeNurture("Welcome / nurture flow", "welcome"), true);
  assert.equal(looksLikeNurture("Birthday SMS"), false);
  assert.equal(cycleTracking("unknown"), "yes");
  assert.equal(cycleTracking("yes"), "no");
  assert.equal(cycleTracking("no"), "unknown");
  assert.equal(formatSpend(1500), "$1,500/mo");
  assert.equal(formatSpend(null), "—");
  assert.equal(landingHref("www.acme.com/offer"), "https://www.acme.com/offer");
  assert.equal(landingHost("https://www.acme.com/offer"), "acme.com");
});

test("dashboard lists every active client and upserts a snapshot", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-ads-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const ads = await import("../src/lib/ads-dashboard");
  const now = nowIso();
  const db = getDb();

  db.prepare(
    `INSERT INTO rev_clients (id, name, active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  ).run("cl_acme", "Acme Plumbing", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  ).run("cl_quiet", "Quiet Co", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`
  ).run("cl_old", "Closed Shop", now, now);
  db.prepare(
    `INSERT INTO client_strategies (client_id, channels, updated_at)
     VALUES (?, ?, ?)`
  ).run("cl_acme", JSON.stringify(["ppc", "email"]), now);
  db.prepare(
    `INSERT INTO lifecycle_automations
       (id, client_id, name, platform, kind, status, account_ref, description, link, created_at, updated_at)
     VALUES (?, ?, ?, 'ghl', 'welcome', 'live', '', '', '', ?, ?)`
  ).run("auto_1", "cl_acme", "Lead nurture", now, now);

  const empty = ads.buildAdsDashboard();
  assert.equal(empty.rows.length, 2);
  assert.ok(empty.rows.every((r) => r.clientId !== "cl_old"));
  const acme = empty.rows.find((r) => r.clientId === "cl_acme")!;
  assert.equal(acme.status, "unknown");
  assert.equal(acme.nurtureStatus, "live");
  assert.equal(acme.nurtureSource, "detected");
  assert.equal(acme.nurtureDetectedLabel, "Lead nurture");
  assert.ok(acme.gaps.some((g) => g.key === "unset"));

  const saved = ads.upsertAdsAccount("cl_acme", {
    status: "active",
    monthlySpendLimit: 2000,
    channels: ["pmax", "lsa"],
    landingPageUrl: "https://acme.test/quote",
    leadMagnet: "form",
    nurtureStatus: "live",
    conversionAction: "Form submit",
    tracking: {
      gtm: "yes",
      ga4: "yes",
      google_ads_tag: "yes",
      call_tracking: "yes",
      form_tracking: "yes",
      enhanced_conversions: "yes",
      thank_you_page: "yes",
    },
    markReviewed: true,
  });
  assert.ok(saved);
  assert.equal(saved.status, "active");
  assert.equal(saved.monthlySpendLimit, 2000);
  assert.deepEqual(saved.channels, ["pmax", "lsa"]);
  assert.equal(saved.ready, true);
  assert.equal(saved.gaps.length, 0);

  const parsed = ads.parseAdsPatch({ monthlySpendLimit: "", status: "paused" });
  assert.ok(!("error" in parsed));
  const paused = ads.upsertAdsAccount("cl_acme", parsed);
  assert.equal(paused?.status, "paused");
  assert.equal(paused?.monthlySpendLimit, null);
  assert.ok(paused?.gaps.some((g) => g.key === "paused"));
  assert.ok(paused?.gaps.some((g) => g.key === "no_budget"));

  assert.equal(ads.upsertAdsAccount("missing", { status: "off" }), null);
  assert.deepEqual(ads.parseAdsPatch({ status: "running" }), { error: "Invalid ads status" });
});
