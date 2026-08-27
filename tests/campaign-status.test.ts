import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  OPERATOR_STATUS_OPTIONS,
  isInternallyApproved,
  matchesCampaignStatusFilter,
  operatorStatusLabel,
  operatorStatusValue,
  statusAfterMarkRevisionDone,
  statusAfterReviewerComment,
  statusAfterReviewLinkView,
  storedStatusForOperatorChoice,
} from "../src/lib/campaign-status";

test("operator status options use Sent for approval and workflow order", () => {
  assert.deepEqual(
    OPERATOR_STATUS_OPTIONS.map((o) => o.value),
    [
      "draft",
      "internal_review",
      "needs_revisions_internal",
      "approved_internally",
      "in_review",
      "needs_changes",
      "approved",
      "scheduled",
      "sent",
    ]
  );
  assert.deepEqual(
    OPERATOR_STATUS_OPTIONS.map((o) => o.label),
    [
      "Draft",
      "Internal Review",
      "Needs revisions (internal)",
      "Approved Internally",
      "Sent for approval",
      "Needs Changes",
      "Approved",
      "Scheduled",
      "Sent",
    ]
  );
  assert.equal(operatorStatusLabel("in_review"), "Sent for approval");
  assert.equal(operatorStatusLabel("internal_review"), "Internal Review");
  assert.equal(
    operatorStatusLabel("needs_revisions_internal"),
    "Needs revisions (internal)"
  );
  assert.equal(operatorStatusLabel("needs_changes"), "Needs Changes");
  assert.equal(
    operatorStatusLabel("approved", "internal"),
    "Approved Internally"
  );
  assert.equal(operatorStatusLabel("approved", "client"), "Approved");
  assert.notEqual(operatorStatusLabel("in_review"), operatorStatusLabel("internal_review"));
  assert.notEqual(
    operatorStatusLabel("needs_changes"),
    operatorStatusLabel("needs_revisions_internal")
  );
});

test("review-link views and reviewer comments keep internal work off Sent for approval", () => {
  assert.equal(statusAfterReviewLinkView("draft", "internal"), "internal_review");
  assert.equal(statusAfterReviewLinkView("draft", "external"), null);
  assert.equal(statusAfterReviewLinkView("internal_review", "internal"), null);
  assert.equal(statusAfterReviewLinkView("internal_review", "external"), null);
  assert.equal(statusAfterReviewLinkView("in_review", "internal"), null);

  assert.equal(
    statusAfterReviewerComment("internal_review", "internal"),
    "needs_revisions_internal"
  );
  assert.equal(
    statusAfterReviewerComment("draft", "internal"),
    "needs_revisions_internal"
  );
  assert.equal(statusAfterReviewerComment("in_review", "internal"), null);
  assert.equal(statusAfterReviewerComment("in_review", "external"), "needs_changes");
  assert.equal(statusAfterReviewerComment("internal_review", "external"), "needs_changes");
  assert.equal(statusAfterReviewerComment("approved", "internal"), null);

  assert.equal(statusAfterMarkRevisionDone("needs_revisions_internal"), "internal_review");
  assert.equal(statusAfterMarkRevisionDone("needs_changes"), "in_review");
  assert.equal(statusAfterMarkRevisionDone("draft"), "in_review");
});

test("operator status helpers distinguish approved internally from approved", () => {
  assert.equal(operatorStatusValue("approved", "internal"), "approved_internally");
  assert.equal(operatorStatusValue("approved", "client"), "approved");
  assert.equal(operatorStatusValue("approved", null), "approved");
  assert.equal(operatorStatusValue("in_review", null), "in_review");
  assert.equal(operatorStatusValue("internal_review", null), "internal_review");
  assert.equal(operatorStatusValue("needs_revisions_internal", null), "needs_revisions_internal");

  assert.equal(isInternallyApproved("approved", "internal"), true);
  assert.equal(isInternallyApproved("approved_internally", null), true);
  assert.equal(isInternallyApproved("approved", "client"), false);
  assert.equal(isInternallyApproved("in_review", "internal"), false);

  assert.equal(storedStatusForOperatorChoice("approved_internally"), "approved");
  assert.equal(storedStatusForOperatorChoice("approved"), "approved");
  assert.equal(storedStatusForOperatorChoice("internal_review"), "internal_review");
  assert.equal(
    storedStatusForOperatorChoice("needs_revisions_internal"),
    "needs_revisions_internal"
  );
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

  await t.test("new campaigns start as Draft", () => {
    const created = campaign();
    assert.equal(created.status, "draft");
    assert.equal(operatorStatusLabel(created.status), "Draft");
  });

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

  await t.test("picking Scheduled without a send datetime does not change status", () => {
    const created = campaign();
    assert.equal(campaigns.applyOperatorCampaignStatus(created.id, "scheduled"), null);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "draft");
  });

  await t.test("picking Internal Review stores that status, not client Sent for approval", () => {
    const created = campaign();
    const row = campaigns.applyOperatorCampaignStatus(created.id, "internal_review");
    assert.ok(row);
    assert.equal(row.status, "internal_review");
    assert.equal(row.approved_channel, null);
    assert.equal(operatorStatusValue(row.status, row.approved_channel), "internal_review");
  });

  await t.test("opening the internal review link from draft stores Internal Review, not Sent for approval", async () => {
    const created = campaign();
    const res = await getToken(created.magic_token);
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "internal_review");
    assert.notEqual(row.status, "in_review");
    assert.equal(operatorStatusLabel(row.status), "Internal Review");
  });

  await t.test("opening the internal review link keeps Internal Review", async () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "internal_review");
    await getToken(created.magic_token);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "internal_review");
  });

  await t.test("opening the client review link from draft does not mark Sent for approval", async () => {
    const created = campaign();
    await getToken(created.external_token);
    assert.equal(campaigns.getCampaignById(created.id)!.status, "draft");
  });

  await t.test("internal review feedback stores Needs revisions (internal)", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "internal_review");
    campaigns.addComment({
      campaignId: created.id,
      body: "Fix the hero headline.",
      type: "general",
      channel: "internal",
    });
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "needs_revisions_internal");
    assert.notEqual(row.status, "needs_changes");
    assert.notEqual(row.status, "in_review");
    assert.equal(operatorStatusLabel(row.status), "Needs revisions (internal)");
  });

  await t.test("internal review link comment stores Needs revisions (internal)", async () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "internal_review");
    const res = await postToken(created.magic_token, {
      authorName: "Cassidy Merideth",
      body: "Swap the CTA.",
    });
    assert.equal(res.status, 201);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "needs_revisions_internal");
    assert.notEqual(row.status, "in_review");
  });

  await t.test("client review feedback stores Needs Changes, not internal revisions", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "in_review");
    campaigns.addComment({
      campaignId: created.id,
      body: "Please change the date.",
      type: "general",
      channel: "external",
    });
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "needs_changes");
    assert.notEqual(row.status, "needs_revisions_internal");
    assert.equal(operatorStatusLabel(row.status), "Needs Changes");
  });

  await t.test("internal notes on a client-sent package do not pull it off Sent for approval", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "in_review");
    campaigns.addComment({
      campaignId: created.id,
      body: "Team note while the client has it.",
      type: "general",
      channel: "internal",
    });
    assert.equal(campaigns.getCampaignById(created.id)!.status, "in_review");
  });

  await t.test("marking internal revisions done returns to Internal Review, not Sent for approval", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "needs_revisions_internal");
    const row = campaigns.markRevisionDone(created.id);
    assert.ok(row);
    assert.equal(row.status, "internal_review");
    assert.notEqual(row.status, "in_review");
  });

  await t.test("marking client revisions done returns to Sent for approval", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "needs_changes");
    const row = campaigns.markRevisionDone(created.id);
    assert.ok(row);
    assert.equal(row.status, "in_review");
  });
});
