import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  BOARD_COLUMNS,
  OPERATOR_STATUS_OPTIONS,
  STATUS_BUCKETS,
  boardColumnId,
  compareDoneNewestFirst,
  doneSentInstant,
  groupCampaignsByBoard,
  isDoneCampaignStatus,
  isDoneListStatus,
  isInternallyApproved,
  LIST_STATUS_OPTIONS,
  listStageFromStatusParam,
  listStatusFromStatusParam,
  matchesCampaignStatusFilter,
  matchesListBucket,
  resolveListStatusFilter,
  matchesStatusBucket,
  operatorStatusLabel,
  operatorStatusValue,
  statusAfterMarkRevisionDone,
  statusAfterReviewerComment,
  statusAfterReviewLinkView,
  statusBucketId,
  storedStatusForOperatorChoice,
} from "../src/lib/campaign-status";
import { pickDisplayedSendAt } from "../src/lib/send-display";

test("every operator status sits in one plain-language bucket", () => {
  for (const opt of OPERATOR_STATUS_OPTIONS) {
    const hits = STATUS_BUCKETS.filter((b) => b.values.includes(opt.value));
    assert.equal(hits.length, 1, opt.value);
  }
  assert.equal(statusBucketId("draft"), "in_progress");
  assert.equal(statusBucketId("needs_changes"), "in_progress");
  assert.equal(statusBucketId("approved", "internal"), "in_progress");
  assert.equal(statusBucketId("in_review"), "waiting");
  assert.equal(statusBucketId("approved", "client"), "ready");
  assert.equal(statusBucketId("scheduled"), "ready");
  assert.equal(statusBucketId("sent"), "sent");
  assert.equal(statusBucketId("live"), "sent");
  assert.equal(
    matchesStatusBucket({ status: "in_review" }, "waiting"),
    true
  );
  assert.equal(
    matchesStatusBucket({ status: "in_review" }, "in_progress"),
    false
  );
  assert.equal(matchesStatusBucket({ status: "draft" }, "all"), true);
  assert.equal(matchesListBucket({ status: "draft" }, "open"), true);
  assert.equal(matchesListBucket({ status: "in_review" }, "open"), true);
  assert.equal(matchesListBucket({ status: "sent" }, "open"), false);
  assert.equal(matchesListBucket({ status: "live" }, "open"), false);
  assert.equal(matchesListBucket({ status: "sent" }, "all"), true);
});

test("campaign list status filter is every working status, in workflow order", () => {
  assert.deepEqual(
    LIST_STATUS_OPTIONS.map((option) => option.value),
    OPERATOR_STATUS_OPTIONS.map((option) => option.value).filter(
      (value) => value !== "sent" && value !== "live"
    )
  );

  assert.equal(listStatusFromStatusParam("draft"), "draft");
  assert.equal(listStatusFromStatusParam("internal_review"), "internal_review");
  assert.equal(
    listStatusFromStatusParam("needs_revisions_internal"),
    "needs_revisions_internal"
  );
  assert.equal(listStatusFromStatusParam("approved_internally"), "approved_internally");
  assert.equal(listStatusFromStatusParam("in_review"), "in_review");
  assert.equal(listStatusFromStatusParam("needs_changes"), "needs_changes");
  assert.equal(listStatusFromStatusParam("approved"), "approved");
  assert.equal(listStatusFromStatusParam("scheduled"), "scheduled");
  assert.equal(listStatusFromStatusParam("all"), "all");
  assert.equal(listStatusFromStatusParam("open"), "all");
  assert.equal(listStatusFromStatusParam("sent"), "done");
  assert.equal(listStatusFromStatusParam("live"), "done");
  assert.equal(listStatusFromStatusParam("in_progress"), "ignore");
  assert.equal(listStatusFromStatusParam("waiting"), "ignore");
  assert.equal(listStatusFromStatusParam("ready"), "ignore");
  assert.equal(listStatusFromStatusParam("not-a-status"), "ignore");

  assert.equal(resolveListStatusFilter("draft", "scheduled"), "draft");
  assert.equal(resolveListStatusFilter("all", "scheduled"), "all");
  assert.equal(resolveListStatusFilter("open", "draft"), "all");
  assert.equal(resolveListStatusFilter(null, "needs_changes"), "needs_changes");
  assert.equal(resolveListStatusFilter("in_progress", "approved"), "approved");
  assert.equal(resolveListStatusFilter("waiting", undefined), "all");
  assert.equal(resolveListStatusFilter("sent", "draft"), "done");
  assert.equal(resolveListStatusFilter("live", undefined), "done");
});

test("old status links map onto the stage dropdown", () => {
  assert.equal(listStageFromStatusParam("all"), "all");
  assert.equal(listStageFromStatusParam("open"), "all");
  assert.equal(listStageFromStatusParam("in_progress"), "in_progress");
  assert.equal(listStageFromStatusParam("draft"), "in_progress");
  assert.equal(listStageFromStatusParam("approved_internally"), "in_progress");
  assert.equal(listStageFromStatusParam("in_review"), "waiting");
  assert.equal(listStageFromStatusParam("approved"), "ready");
  assert.equal(listStageFromStatusParam("scheduled"), "ready");
  assert.equal(listStageFromStatusParam("sent"), null);
  assert.equal(listStageFromStatusParam("live"), null);
  assert.equal(listStageFromStatusParam("not-a-status"), null);
});

test("sent and live are done, and the board keeps only in-progress stages", () => {
  assert.equal(isDoneCampaignStatus("sent"), true);
  assert.equal(isDoneCampaignStatus("live"), true);
  assert.equal(isDoneCampaignStatus("draft"), false);
  assert.equal(isDoneCampaignStatus("scheduled"), false);
  assert.equal(isDoneListStatus("sent"), true);
  assert.equal(isDoneListStatus("live"), true);
  assert.equal(isDoneListStatus("draft"), false);

  const covered = BOARD_COLUMNS.flatMap((column) => column.values);
  assert.deepEqual(
    covered,
    OPERATOR_STATUS_OPTIONS.map((option) => option.value).filter(
      (value) => value !== "sent" && value !== "live"
    )
  );
  assert.equal(boardColumnId("sent"), null);
  assert.equal(boardColumnId("live"), null);
  assert.equal(boardColumnId("draft"), "draft");
  assert.equal(boardColumnId("approved", "internal"), "approved_internally");

  const grouped = groupCampaignsByBoard([
    { id: "a", status: "draft" },
    { id: "b", status: "in_review" },
    { id: "c", status: "approved", approved_channel: "internal" },
    { id: "d", status: "live" },
    { id: "e", status: "sent" },
    { id: "f", status: "needs_changes" },
    { id: "g", status: "nope" },
  ]);
  assert.deepEqual(
    grouped.map((column) => column.id),
    BOARD_COLUMNS.map((column) => column.id)
  );
  assert.equal(
    grouped.some((column) => column.id === "sent"),
    false
  );
  const byId = new Map(grouped.map((column) => [column.id, column.items.map((item) => item.id)]));
  assert.deepEqual(byId.get("draft"), ["a"]);
  assert.deepEqual(byId.get("in_review"), ["b"]);
  assert.deepEqual(byId.get("approved_internally"), ["c"]);
  assert.deepEqual(byId.get("needs_changes"), ["f"]);
  assert.equal(
    grouped.reduce((sum, column) => sum + column.items.length, 0),
    4
  );
});

test("done campaigns sort newest sent first", () => {
  assert.equal(
    doneSentInstant({
      next_send_at: "2026-10-02T00:00:00.000Z",
      next_send_upcoming: false,
      scheduled_send_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-10-03T00:00:00.000Z",
    }),
    "2026-10-02T00:00:00.000Z"
  );
  assert.equal(
    doneSentInstant({
      next_send_at: "2026-11-01T00:00:00.000Z",
      next_send_upcoming: true,
      scheduled_send_at: "2026-09-01T00:00:00.000Z",
    }),
    "2026-09-01T00:00:00.000Z"
  );
  assert.equal(
    doneSentInstant({ updated_at: "2026-08-01T00:00:00.000Z" }),
    "2026-08-01T00:00:00.000Z"
  );
  assert.equal(doneSentInstant({}), null);
  const order = [
    "2026-01-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
    null,
    "2026-03-01T00:00:00.000Z",
  ].sort(compareDoneNewestFirst);
  assert.deepEqual(order, [
    "2026-06-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    null,
  ]);
});

test("list send date prefers the next upcoming instant", () => {
  const now = "2026-10-17T00:00:00.000Z";
  assert.deepEqual(
    pickDisplayedSendAt(
      ["2026-09-01T00:00:00.000Z", "2026-10-22T16:00:00.000Z", null],
      now
    ),
    { at: "2026-10-22T16:00:00.000Z", upcoming: true }
  );
  assert.deepEqual(
    pickDisplayedSendAt(
      ["2026-10-28T15:00:00.000Z", "2026-11-03T16:00:00.000Z"],
      now
    ),
    { at: "2026-10-28T15:00:00.000Z", upcoming: true }
  );
  assert.deepEqual(
    pickDisplayedSendAt(["2026-04-10T16:00:00.000Z", "2026-07-15T16:00:00.000Z"], now),
    { at: "2026-07-15T16:00:00.000Z", upcoming: false }
  );
  assert.deepEqual(pickDisplayedSendAt([null, ""], now), {
    at: null,
    upcoming: false,
  });
});

test("operator status options use Sent for approval and workflow order", () => {
  assert.deepEqual(
    OPERATOR_STATUS_OPTIONS.map((o) => o.value),
    [
      "draft",
      "internal_review",
      "needs_revisions_internal",
      "revisions_made",
      "approved_internally",
      "in_review",
      "needs_changes",
      "approved",
      "scheduled",
      "sent",
      "live",
    ]
  );
  assert.deepEqual(
    OPERATOR_STATUS_OPTIONS.map((o) => o.label),
    [
      "Draft",
      "Internal Review",
      "Needs revisions (internal)",
      "Revisions made",
      "Approved Internally",
      "Sent for approval",
      "Needs Changes",
      "Approved",
      "Scheduled",
      "Sent",
      "Live",
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

  assert.equal(statusAfterMarkRevisionDone("needs_revisions_internal"), "revisions_made");
  assert.equal(statusAfterMarkRevisionDone("internal_review"), "revisions_made");
  assert.equal(statusAfterMarkRevisionDone("revisions_made"), "revisions_made");
  assert.equal(statusAfterReviewerComment("revisions_made", "internal"), "needs_revisions_internal");
  assert.equal(statusAfterReviewerComment("revisions_made", "external"), "needs_changes");
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

  await t.test("marking internal revisions done stores Revisions made, not Sent for approval", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "needs_revisions_internal");
    const row = campaigns.markRevisionDone(created.id);
    assert.ok(row);
    assert.equal(row.status, "revisions_made");
    assert.equal(operatorStatusLabel(row.status), "Revisions made");
    assert.notEqual(row.status, "in_review");
    assert.notEqual(row.status, "internal_review");
  });

  await t.test("another round of internal feedback after Revisions made returns to Needs revisions", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "revisions_made");
    campaigns.addComment({
      campaignId: created.id,
      body: "One more change on the offer.",
      type: "general",
      channel: "internal",
    });
    const noted = campaigns.getCampaignById(created.id)!;
    assert.equal(noted.status, "needs_revisions_internal");
    const again = campaigns.markRevisionDone(created.id);
    assert.ok(again);
    assert.equal(again.status, "revisions_made");
  });

  await t.test("the client link hides Revisions made the same way as other internal work", async () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "revisions_made");
    const external = await getToken(created.external_token);
    const externalPayload = await external.json();
    assert.equal(externalPayload.campaign.status, "in_review");
    const internal = await getToken(created.magic_token);
    const internalPayload = await internal.json();
    assert.equal(internalPayload.campaign.status, "revisions_made");
    assert.equal(campaigns.getCampaignById(created.id)!.status, "revisions_made");
  });

  await t.test("marking client revisions done returns to Sent for approval", () => {
    const created = campaign();
    campaigns.applyOperatorCampaignStatus(created.id, "needs_changes");
    const row = campaigns.markRevisionDone(created.id);
    assert.ok(row);
    assert.equal(row.status, "in_review");
  });
});
