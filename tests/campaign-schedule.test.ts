import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { zonedLocalToUtc } from "../src/lib/forecast-time";

test("campaign send datetime is stored as UTC from Pacific wall clock", () => {
  assert.equal(
    zonedLocalToUtc("2026-08-25", "10:00", "America/Los_Angeles")?.toISOString(),
    "2026-08-25T17:00:00.000Z"
  );
  assert.equal(
    zonedLocalToUtc("2026-01-15", "10:00", "America/Los_Angeles")?.toISOString(),
    "2026-01-15T18:00:00.000Z"
  );
});

test("scheduling a campaign stores a send instant and cron flips it to Sent", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-campaign-schedule-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const calendar = await import("../src/lib/calendar");
  const revenue = await import("../src/lib/revenue");
  const schedule = await import("../src/lib/campaign-schedule");

  function campaign(clientId?: string | null) {
    return campaigns.createCampaign({
      title: "April newsletter",
      clientName: "Vitatherapy",
      clientId: clientId ?? null,
      htmlContent: "<p>Hello</p>",
    });
  }

  await t.test("future datetime stays scheduled", () => {
    const created = campaign();
    const result = schedule.scheduleCampaign(created.id, {
      sendDate: "2100-06-15",
      sendTime: "09:30",
    });
    assert.ok("campaign" in result);
    if (!("campaign" in result)) return;
    assert.equal(result.flippedToSent, false);
    assert.equal(result.campaign.status, "scheduled");
    assert.equal(
      result.campaign.scheduled_send_at,
      schedule.parseCampaignSendAt("2100-06-15", "09:30")
    );
    assert.equal(result.campaign.scheduled_send_id, null);
  });

  await t.test("past datetime is marked Sent immediately", () => {
    const created = campaign();
    const result = schedule.scheduleCampaign(created.id, {
      sendDate: "2020-01-15",
      sendTime: "09:00",
    });
    assert.ok("campaign" in result);
    if (!("campaign" in result)) return;
    assert.equal(result.flippedToSent, true);
    assert.equal(result.campaign.status, "sent");
    assert.ok(result.campaign.scheduled_send_at);
  });

  await t.test("missing datetime is refused", () => {
    const created = campaign();
    const result = schedule.scheduleCampaign(created.id, {
      sendDate: "",
      sendTime: "09:00",
    });
    assert.deepEqual(result, {
      error: "Pick the date and time this campaign will send.",
    });
    assert.equal(campaigns.getCampaignById(created.id)!.status, "draft");
  });

  await t.test("matching calendar send is offered and updated, not duplicated", () => {
    const client = revenue.createRevClient({
      name: "Vitatherapy",
      businessModel: "home_service",
    });
    const created = campaign(client.id);
    const send = calendar.createSend({
      clientId: client.id,
      title: "April newsletter",
      sendDate: "2100-07-01",
      sendTime: "11:00",
      status: "planned",
      assetType: "email_campaign",
    });

    const hint = schedule.suggestedSendForCampaign(
      campaigns.getCampaignById(created.id)!
    );
    assert.ok(hint);
    assert.equal(hint.source, "calendar");
    assert.equal(hint.sendId, send.id);
    assert.equal(hint.sendDate, "2100-07-01");
    assert.equal(hint.sendTime, "11:00");

    const result = schedule.scheduleCampaign(created.id, {
      sendDate: "2100-07-02",
      sendTime: "14:00",
      sendId: send.id,
    });
    assert.ok("campaign" in result);
    if (!("campaign" in result)) return;
    assert.equal(result.campaign.status, "scheduled");
    assert.equal(result.campaign.scheduled_send_id, send.id);

    const updated = calendar.getSend(send.id)!;
    assert.equal(updated.send_date, "2100-07-02");
    assert.equal(updated.send_time, "14:00");
    assert.equal(updated.status, "scheduled");
    assert.equal(
      (
        getDb()
          .prepare(`SELECT COUNT(*) AS n FROM scheduled_sends WHERE client_id = ?`)
          .get(client.id) as { n: number }
      ).n,
      1
    );
  });

  await t.test("cron flips due scheduled campaigns and their calendar send", () => {
    const client = revenue.createRevClient({
      name: "Cron Client",
      businessModel: "home_service",
    });
    const created = campaigns.createCampaign({
      title: "Due send",
      clientName: client.name,
      clientId: client.id,
      htmlContent: "<p>Hi</p>",
    });
    const send = calendar.createSend({
      clientId: client.id,
      title: "Due send",
      sendDate: "2020-02-01",
      sendTime: "08:00",
      status: "scheduled",
    });
    const scheduled = schedule.scheduleCampaign(created.id, {
      sendDate: "2099-08-01",
      sendTime: "08:00",
      sendId: send.id,
    });
    assert.ok("campaign" in scheduled);

    const dry = schedule.runScheduledCampaignSends({
      dryRun: true,
      asOf: "2099-08-01T16:00:00.000Z",
    });
    assert.equal(dry.due, 1);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "scheduled");

    const live = schedule.runScheduledCampaignSends({
      asOf: "2099-08-01T16:00:00.000Z",
    });
    assert.equal(live.flipped.length, 1);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "sent");
    assert.equal(calendar.getSend(send.id)!.status, "sent");
  });

  await t.test("cron leaves future scheduled campaigns alone", () => {
    const created = campaign();
    schedule.scheduleCampaign(created.id, {
      sendDate: "2100-12-01",
      sendTime: "09:00",
    });
    const result = schedule.runScheduledCampaignSends({
      asOf: "2026-08-25T17:00:00.000Z",
    });
    assert.equal(result.flipped.some((row) => row.id === created.id), false);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "scheduled");
  });

  await t.test("leaving Scheduled for Draft clears the stored send instant", () => {
    const created = campaign();
    schedule.scheduleCampaign(created.id, {
      sendDate: "2100-09-01",
      sendTime: "10:00",
    });
    const row = campaigns.applyOperatorCampaignStatus(created.id, "draft");
    assert.ok(row);
    assert.equal(row.status, "draft");
    assert.equal(row.scheduled_send_at, null);
    assert.equal(row.scheduled_send_id, null);
  });
});
