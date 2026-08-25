import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  isInternallyApproved,
  matchesCampaignStatusFilter,
  operatorStatusValue,
  storedStatusForOperatorChoice,
} from "../src/lib/campaign-status";

test("operator status helpers distinguish approved internally from approved", () => {
  assert.equal(operatorStatusValue("approved", "internal"), "approved_internally");
  assert.equal(operatorStatusValue("approved", "client"), "approved");
  assert.equal(operatorStatusValue("approved", null), "approved");
  assert.equal(operatorStatusValue("in_review", null), "in_review");
  assert.equal(operatorStatusValue("internal_review", null), "internal_review");

  assert.equal(isInternallyApproved("approved", "internal"), true);
  assert.equal(isInternallyApproved("approved_internally", null), true);
  assert.equal(isInternallyApproved("approved", "client"), false);
  assert.equal(isInternallyApproved("in_review", "internal"), false);

  assert.equal(storedStatusForOperatorChoice("approved_internally"), "approved");
  assert.equal(storedStatusForOperatorChoice("approved"), "approved");
  assert.equal(storedStatusForOperatorChoice("internal_review"), "internal_review");
  assert.equal(storedStatusForOperatorChoice("in_review"), "in_review");

  const internal = { status: "approved", approved_channel: "internal" };
  const client = { status: "approved", approved_channel: "client" };
  const legacy = { status: "approved", approved_channel: null };
  assert.equal(matchesCampaignStatusFilter(internal, "approved_internally"), true);
  assert.equal(matchesCampaignStatusFilter(internal, "approved"), false);
  assert.equal(matchesCampaignStatusFilter(client, "approved"), true);
  assert.equal(matchesCampaignStatusFilter(client, "approved_internally"), false);
  assert.equal(matchesCampaignStatusFilter(legacy, "approved"), true);
  assert.equal(matchesCampaignStatusFilter(legacy, "approved_internally"), false);
});

test("operator status picker writes approved internally vs client approved", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-op-status-"));
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
      title: "April newsletter",
      clientName: "Vitatherapy",
      htmlContent: "<p>Hello</p>",
    });
  }

  async function getToken(token: string) {
    const req = new Request(`http://localhost/api/review/${token}`);
    return GET(req, { params: Promise.resolve({ token }) });
  }

  async function postToken(token: string, body: Record<string, unknown>) {
    const req = new Request(`http://localhost/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req, { params: Promise.resolve({ token }) });
  }

  await t.test("picking Approved internally stores channel internal and skips thank-you", () => {
    const created = campaign();
    getDb()
      .prepare(`UPDATE campaigns SET basecamp_card_id = ? WHERE id = ?`)
      .run("card-op-1", created.id);
    const row = campaigns.applyOperatorCampaignStatus(
      created.id,
      "approved_internally",
      "Morris Kyle"
    );
    assert.ok(row);
    assert.equal(row.status, "approved");
    assert.equal(row.approved_channel, "internal");
    assert.equal(row.approved_by, "Morris Kyle");
    assert.equal(row.approval_thank_you_due_at, null);
    assert.equal(operatorStatusValue(row.status, row.approved_channel), "approved_internally");
    assert.equal(campaigns.listEmails(created.id)[0].approved_channel, "internal");
  });

  await t.test("picking Approved stores channel client, distinct from internal", () => {
    const created = campaign();
    getDb()
      .prepare(`UPDATE campaigns SET basecamp_card_id = ? WHERE id = ?`)
      .run("card-op-2", created.id);
    const row = campaigns.applyOperatorCampaignStatus(created.id, "approved");
    assert.ok(row);
    assert.equal(row.status, "approved");
    assert.equal(row.approved_channel, "client");
    assert.equal(row.approval_thank_you_due_at, null);
    assert.equal(operatorStatusValue(row.status, row.approved_channel), "approved");
  });

  await t.test("client review stays open after picking Approved internally", async () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "approved_internally", "Morris Kyle");

    const getRes = await getToken(created.external_token);
    const payload = await getRes.json();
    assert.equal(payload.campaign.status, "in_review");
    assert.equal(payload.campaign.internally_approved, true);

    const commentRes = await postToken(created.external_token, {
      authorName: "Katie Jones",
      body: "Looks good after the internal pass.",
    });
    assert.equal(commentRes.status, 201);
  });

  await t.test("unknown status choice is rejected", () => {
    const created = campaign();
    assert.equal(campaigns.applyOperatorCampaignStatus(created.id, "approved_by_boss"), null);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "draft");
  });

  await t.test("picking Internal review stores that status, not client In review", () => {
    const created = campaign();
    const row = campaigns.applyOperatorCampaignStatus(created.id, "internal_review");
    assert.ok(row);
    assert.equal(row.status, "internal_review");
    assert.equal(row.approved_channel, null);
    assert.equal(operatorStatusValue(row.status, row.approved_channel), "internal_review");
  });
});
