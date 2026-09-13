import assert from "node:assert/strict";
import test from "node:test";
import {
  ghlCampaignSendAt,
  resolveAnalyticsRange,
} from "../src/lib/ghl-email-analytics";
import {
  campaignCountsInEmailTotals,
  formatGhlCampaignStatusLabel,
  resolveGhlCampaignSentCount,
  rollupEmailEngagement,
} from "../src/lib/ghl-email-campaign-status";

test("resolveAnalyticsRange maps presets from today", () => {
  const now = new Date("2026-08-31T15:00:00Z");
  assert.deepEqual(resolveAnalyticsRange("1m", null, null, now), {
    start: "2026-07-31",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("3m", null, null, now), {
    start: "2026-05-31",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("6m", null, null, now), {
    start: "2026-02-28",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("12m", null, null, now), {
    start: "2025-08-31",
    end: "2026-08-31",
  });
});

test("resolveAnalyticsRange accepts a custom inclusive window", () => {
  const now = new Date("2026-08-31T15:00:00Z");
  assert.deepEqual(resolveAnalyticsRange("custom", "2026-01-01", "2026-03-15", now), {
    start: "2026-01-01",
    end: "2026-03-15",
  });
  assert.throws(() => resolveAnalyticsRange("custom", "", "2026-03-15", now));
  assert.throws(() => resolveAnalyticsRange("custom", "2026-04-01", "2026-03-15", now));
});

test("ghlCampaignSendAt uses the blast send time, not when it was queued", () => {
  const queuedAt = "2026-09-09T23:05:00.000Z";
  const sendMs = Date.parse("2026-09-18T16:00:00.000Z");

  assert.equal(
    ghlCampaignSendAt({
      createdAt: queuedAt,
      dateAdded: queuedAt,
      scheduledAt: queuedAt,
      scheduledTimestamp: sendMs,
    }),
    "2026-09-18T16:00:00.000Z"
  );

  assert.equal(
    ghlCampaignSendAt({
      createdAt: queuedAt,
      timeZone: "America/Los_Angeles",
      scheduleConfig: { sendAt: "2026-09-18 09:00 AM" },
    }),
    "2026-09-18T16:00:00.000Z"
  );

  assert.equal(
    ghlCampaignSendAt({
      createdAt: queuedAt,
      scheduledAt: queuedAt,
    }),
    null
  );

  assert.equal(
    ghlCampaignSendAt({
      createdAt: queuedAt,
      scheduledAt: "2026-09-20T16:00:00.000Z",
    }),
    "2026-09-20T16:00:00.000Z"
  );
});

test("scheduled / queued never treat audience size as sent", () => {
  // Ecoworkz-style: 6443 on the list, 0% opens, still Scheduled.
  assert.equal(resolveGhlCampaignSentCount("scheduled", 0, 6443, false), 0);
  assert.equal(resolveGhlCampaignSentCount("scheduled", 0, 6443, true), 0);
  // GHL echoes audience into stats.sent while status is still scheduled.
  assert.equal(resolveGhlCampaignSentCount("scheduled", 6443, 6443, true, 0), 0);
  assert.equal(resolveGhlCampaignSentCount("pending", 6443, 6443, true, 0), 0);
  assert.equal(resolveGhlCampaignSentCount("processing", 0, 6443, false), 0);
  assert.equal(resolveGhlCampaignSentCount("queued", 0, 9000, false), 0);
  assert.equal(resolveGhlCampaignSentCount("draft", 0, 100, false), 0);
  assert.equal(resolveGhlCampaignSentCount("cancelled", 50, 6443, true), 0);
});

test("real stats.sent wins, including mid-flight processing", () => {
  assert.equal(resolveGhlCampaignSentCount("processing", 1200, 6443, true, 0), 1200);
  assert.equal(resolveGhlCampaignSentCount("complete", 5100, 6443, true, 200), 5100);
  assert.equal(resolveGhlCampaignSentCount("sent", 4800, 6443, true, 100), 4800);
});

test("complete with stats saying 0 sent does not fall back to audience", () => {
  assert.equal(resolveGhlCampaignSentCount("complete", 0, 6443, true), 0);
  // No stats yet for a completed-looking row — still don't invent volume.
  assert.equal(resolveGhlCampaignSentCount("complete", 0, 6443, false), 0);
});

test("complete + audience-sized sent + zero engagement is treated as unsent", () => {
  // Mis-labeled Ecoworkz September rows: status complete, sent=6443, 0 opens.
  assert.equal(resolveGhlCampaignSentCount("complete", 6443, 6443, true, 0), 0);
  assert.equal(resolveGhlCampaignSentCount("sent", 6443, 6443, true, 0), 0);
  // Real send below audience with opens still counts.
  assert.equal(resolveGhlCampaignSentCount("complete", 5100, 6443, true, 800), 5100);
});

test("open-rate totals ignore scheduled and zero-engagement rows", () => {
  assert.equal(
    campaignCountsInEmailTotals({
      status: "scheduled",
      sent: 0,
      statsAvailable: false,
    }),
    false
  );
  assert.equal(
    campaignCountsInEmailTotals({
      status: "complete",
      sent: 5100,
      statsAvailable: true,
      opened: 1200,
    }),
    true
  );
  assert.equal(
    campaignCountsInEmailTotals({
      status: "complete",
      sent: 6443,
      statsAvailable: true,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
    }),
    false
  );
  assert.equal(
    campaignCountsInEmailTotals({
      status: "complete",
      sent: 0,
      statsAvailable: true,
    }),
    false
  );
  assert.equal(
    campaignCountsInEmailTotals({
      status: "complete",
      sent: 5100,
      statsAvailable: false,
      opened: 10,
    }),
    false
  );
  assert.equal(formatGhlCampaignStatusLabel("scheduled"), "Scheduled");
  assert.equal(formatGhlCampaignStatusLabel("complete"), "Sent");
  assert.equal(formatGhlCampaignStatusLabel("processing"), "Sending");
});

test("rollup open rate is not diluted by scheduled audience rows", () => {
  const rollup = rollupEmailEngagement([
    {
      status: "complete",
      sent: 1000,
      delivered: 980,
      opened: 400,
      clicked: 40,
      statsAvailable: true,
    },
    {
      // Would drop average from ~40.8% to ~5.5% if counted as 6443 sent / 0 opens.
      status: "scheduled",
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      statsAvailable: false,
    },
    {
      // Mis-labeled complete with audience stamp + zero engagement.
      status: "complete",
      sent: 6443,
      delivered: 6443,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
      statsAvailable: true,
    },
  ]);
  assert.equal(rollup.campaigns, 1);
  assert.equal(rollup.sent, 1000);
  assert.equal(rollup.openRate, 40.8);
  assert.equal(rollup.clickRate, 4.1);
});
