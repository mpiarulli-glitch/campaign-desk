import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { formatPacificSend } from "../src/lib/period";

test("client send schedule is stored per package and hidden from other review tokens", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-client-send-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const campaigns = await import("../src/lib/campaigns");
  const calendar = await import("../src/lib/calendar");
  const revenue = await import("../src/lib/revenue");
  const schedule = await import("../src/lib/client-send-schedule");
  const sendTimes = await import("../src/lib/campaign-schedule");

  const clientA = revenue.createRevClient({
    name: "Pipe It Right Plumbing",
    businessModel: "home_service",
  });
  const packageA = campaigns.createCampaign({
    title: "October Emails",
    clientName: clientA.name,
    clientId: clientA.id,
    emailTitle: "01. Protected Quote",
    htmlContent: "<p>One</p>",
  });
  const second = campaigns.addEmail({
    campaignId: packageA.id,
    title: "02. 5 Signs You Have A Cracked Pipe",
    htmlContent: "<p>Two</p>",
  });
  const third = campaigns.addEmail({
    campaignId: packageA.id,
    title: "03. Diamond Club Membership",
    htmlContent: "<p>Three</p>",
  });
  assert.ok(second && third);
  campaigns.updateCampaign(packageA.id, { status: "internal_review" });

  const clientB = revenue.createRevClient({
    name: "Other Client",
    businessModel: "home_service",
  });
  const packageB = campaigns.createCampaign({
    title: "November Emails",
    clientName: clientB.name,
    clientId: clientB.id,
    emailTitle: "Secret offer",
    htmlContent: "<p>Hidden</p>",
  });

  const firstId = campaigns.listEmails(packageA.id)[0]!.id;
  const saved = schedule.setClientSendSchedule(packageA.id, [
    { emailId: firstId, sendDate: "2026-10-14", sendTime: "09:00" },
    { emailId: second.id, sendDate: "2026-10-21", sendTime: "15:30" },
    { emailId: third.id, sendDate: "", sendTime: "" },
  ]);
  assert.ok(!("error" in saved));

  const secretIso = sendTimes.parseCampaignSendAt("2026-11-02", "08:15");
  schedule.setClientSendSchedule(packageB.id, [
    {
      emailId: campaigns.listEmails(packageB.id)[0]!.id,
      sendDate: "2026-11-02",
      sendTime: "08:15",
    },
  ]);

  await t.test("times are UTC and only the named package emails come back", () => {
    const rows = schedule.publicSendScheduleForToken(packageA.external_token);
    assert.ok(rows);
    assert.deepEqual(
      rows.map((row) => row.title),
      [
        "01. Protected Quote",
        "02. 5 Signs You Have A Cracked Pipe",
        "03. Diamond Club Membership",
      ]
    );
    assert.equal(rows[0]?.scheduledSendAt, sendTimes.parseCampaignSendAt("2026-10-14", "09:00"));
    assert.equal(rows[1]?.scheduledSendAt, sendTimes.parseCampaignSendAt("2026-10-21", "15:30"));
    assert.equal(rows[2]?.scheduledSendAt, null);
    assert.equal(
      campaigns.getCampaignById(packageA.id)?.status,
      "internal_review"
    );
    const dumped = JSON.stringify(rows);
    assert.equal(dumped.includes(packageB.id), false);
    assert.equal(dumped.includes(campaigns.listEmails(packageB.id)[0]!.id), false);
    assert.equal(dumped.includes(secretIso || "no-secret"), false);
    assert.equal(dumped.toLowerCase().includes("note"), false);
  });

  await t.test("a blank time stays unscheduled and is not invented", () => {
    const again = schedule.setClientSendSchedule(packageA.id, [
      { emailId: third.id, sendDate: "", sendTime: "" },
    ]);
    assert.ok(!("error" in again));
    const rows = schedule.publicSendScheduleForToken(packageA.external_token);
    assert.equal(rows?.find((row) => row.id === third.id)?.scheduledSendAt, null);
    assert.equal(
      rows?.find((row) => row.id === firstId)?.scheduledSendAt,
      sendTimes.parseCampaignSendAt("2026-10-14", "09:00")
    );
  });

  await t.test("package A token cannot read package B", () => {
    const fromA = schedule.publicSendScheduleForToken(packageA.external_token);
    const fromB = schedule.publicSendScheduleForToken(packageB.external_token);
    assert.ok(fromA && fromB);
    const aIds = new Set(fromA.map((row) => row.id));
    for (const row of fromB) {
      assert.equal(aIds.has(row.id), false);
    }
    assert.equal(fromB[0]?.scheduledSendAt, secretIso);
    assert.equal(JSON.stringify(fromA).includes(secretIso || ""), false);
    assert.equal(schedule.publicSendScheduleForToken("not-a-real-token"), null);

    const before = campaigns.getEmailById(fromB[0]!.id)?.scheduled_send_at;
    const rejected = schedule.setClientSendSchedule(packageA.id, [
      { emailId: fromB[0]!.id, sendDate: "2099-01-01", sendTime: "09:00" },
    ]);
    assert.deepEqual(rejected, { error: "That email is not in this package." });
    assert.equal(campaigns.getEmailById(fromB[0]!.id)?.scheduled_send_at, before);
    assert.equal(
      campaigns.getEmailById(firstId)?.scheduled_send_at,
      sendTimes.parseCampaignSendAt("2026-10-14", "09:00")
    );
  });

  await t.test("a linked calendar send is the time when the email has none", () => {
    const client = revenue.createRevClient({
      name: "Calendar Client",
      businessModel: "home_service",
    });
    const created = campaigns.createCampaign({
      title: "Spring note",
      clientName: client.name,
      clientId: client.id,
      emailTitle: "Protected Quote",
      htmlContent: "<p>Cal</p>",
    });
    const extra = campaigns.addEmail({
      campaignId: created.id,
      title: "Unlinked email",
      htmlContent: "<p>No</p>",
    });
    assert.ok(extra);
    calendar.createSend({
      clientId: client.id,
      title: "Protected Quote",
      sendDate: "2026-10-14",
      sendTime: "09:00",
      status: "planned",
      assetType: "email_campaign",
    });
    calendar.createSend({
      clientId: client.id,
      title: "Date only",
      sendDate: "2026-10-16",
      sendTime: "",
      status: "planned",
    });
    const rows = schedule.publicSendScheduleForToken(created.external_token);
    assert.equal(
      rows?.find((row) => row.title === "Protected Quote")?.scheduledSendAt,
      sendTimes.parseCampaignSendAt("2026-10-14", "09:00")
    );
    assert.equal(
      rows?.find((row) => row.title === "Unlinked email")?.scheduledSendAt,
      null
    );
    assert.equal(JSON.stringify(rows).includes(packageB.id), false);
    assert.equal(
      campaigns.getEmailById(campaigns.listEmails(created.id)[0]!.id)?.scheduled_send_at,
      null
    );
  });
});

test("pacific send label is the date and time without repeating the zone", () => {
  const label = formatPacificSend("2026-10-14T16:00:00.000Z").replace(/\s+/g, " ");
  assert.equal(label, "Wed, Oct 14, 2026 at 9:00 AM");
  assert.equal(/pacific|\bPT\b/i.test(label), false);
});
