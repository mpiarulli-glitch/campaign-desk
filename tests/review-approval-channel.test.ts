import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { approvalActivitySummary } from "../src/lib/activity-copy";

test("internal vs client approval channels", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-review-channel-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const { GET, POST } = await import("../src/app/api/review/[token]/route");

  function campaign() {
    return campaigns.createCampaign({
      title: "Welcome Series",
      clientName: "Vitatherapy",
      htmlContent: "<p>Hello</p>",
    });
  }

  async function postToken(token: string, body: Record<string, unknown>) {
    const req = new Request(`http://localhost/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req, { params: Promise.resolve({ token }) });
  }

  async function getToken(token: string) {
    const req = new Request(`http://localhost/api/review/${token}`);
    return GET(req, { params: Promise.resolve({ token }) });
  }

  await t.test("internal review token records approved_channel internal", async () => {
    const created = campaign();
    const res = await postToken(created.magic_token, {
      markApproved: true,
      approverName: "Morris Kyle",
    });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "approved");
    assert.equal(row.approved_channel, "internal");
    assert.equal(row.approved_by, "Morris Kyle");
    assert.equal(row.approval_thank_you_due_at, null);
  });

  await t.test("AM approve on one email still records approved internally when all are signed off", async () => {
    const created = campaign();
    const email = campaigns.listEmails(created.id)[0];
    const res = await postToken(created.magic_token, {
      approveEmail: email.id,
      approverName: "Morris Kyle",
    });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "approved");
    assert.equal(row.approved_channel, "internal");
    assert.equal(row.approval_thank_you_due_at, null);
    assert.equal(campaigns.listEmails(created.id)[0].approved_channel, "internal");
  });

  await t.test("external review token records approved_channel client", async () => {
    const created = campaign();
    getDb()
      .prepare(`UPDATE campaigns SET basecamp_card_id = ? WHERE id = ?`)
      .run("card-1", created.id);
    const res = await postToken(created.external_token, {
      markApproved: true,
      approverName: "Katie Jones",
    });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.approved_channel, "client");
    assert.equal(row.approved_by, "Katie Jones");
    assert.ok(row.approval_thank_you_due_at, "client approval schedules the thank-you");
  });

  await t.test("activity wording distinguishes internal from client", () => {
    const created = campaign();
    campaigns.markApproved(created.id, "Morris Kyle", "internal");
    const item = campaigns.listActivity().find((row) => row.kind === "approved" && row.id === created.id);
    assert.ok(item);
    assert.equal(item.approved_channel, "internal");
    assert.equal(item.actor, "Morris Kyle");
    assert.equal(
      approvalActivitySummary(item),
      "Morris Kyle approved Welcome Series internally"
    );

    const clientCamp = campaign();
    campaigns.markApproved(clientCamp.id, "Katie Jones", "client");
    const clientItem = campaigns
      .listActivity()
      .find((row) => row.kind === "approved" && row.id === clientCamp.id);
    assert.ok(clientItem);
    assert.equal(
      approvalActivitySummary(clientItem),
      "Vitatherapy approved Welcome Series"
    );
  });

  await t.test("internal markApproved does not schedule the client thank-you", () => {
    const created = campaign();
    getDb()
      .prepare(`UPDATE campaigns SET basecamp_card_id = ? WHERE id = ?`)
      .run("card-2", created.id);
    campaigns.markApproved(created.id, "Morris Kyle", "internal");
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.approved_channel, "internal");
    assert.equal(row.approval_thank_you_due_at, null);
    campaigns.scheduleApprovalThankYou(created.id);
    assert.equal(campaigns.getCampaignById(created.id)!.approval_thank_you_due_at, null);
    assert.equal(campaigns.listDueApprovalThankYous().length, 0);
  });

  await t.test("client review stays open after an internal approve", async () => {
    const created = campaign();
    campaigns.markApproved(created.id, "Morris Kyle", "internal");

    const internalGet = await getToken(created.magic_token);
    const internalPayload = await internalGet.json();
    assert.equal(internalPayload.campaign.status, "approved");
    assert.equal(internalPayload.campaign.internally_approved, true);

    const getRes = await getToken(created.external_token);
    assert.equal(getRes.status, 200);
    const payload = await getRes.json();
    assert.equal(payload.campaign.status, "in_review");
    assert.equal(payload.campaign.internally_approved, true);
    assert.equal(payload.campaign.approved_by, null);
    assert.equal(payload.emails[0].approved_at, null);

    const commentRes = await postToken(created.external_token, {
      authorName: "Katie Jones",
      body: "One small change on the headline.",
    });
    assert.equal(commentRes.status, 201);

    const approveRes = await postToken(created.external_token, {
      markApproved: true,
      approverName: "Katie Jones",
    });
    assert.equal(approveRes.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.approved_channel, "client");
    assert.equal(row.approved_by, "Katie Jones");
    assert.equal(campaigns.listEmails(created.id)[0].approved_channel, "client");
  });
});
