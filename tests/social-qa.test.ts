import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "path";

test("social QA tracker", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-social-qa-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  const qa = await import("../src/lib/social-qa");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("a batch stores the sprout link and who created it", () => {
    const batch = qa.createSocialBatch({
      title: "Humble Somm — week of Sep 8",
      clientName: "Humble Somm",
      sproutUrl: "https://app.sproutsocial.com/messages/compose",
      createdBy: "randi",
    });
    assert.equal(batch.status, "draft");
    assert.equal(batch.sprout_url.includes("sproutsocial"), true);
    assert.equal(batch.created_by, "randi");
    assert.equal(qa.listSocialPosts(batch.id).length, 0);
  });

  await t.test("flagging an issue during QA sends the batch back", () => {
    const batch = qa.createSocialBatch({
      title: "Cisco week",
      createdBy: "randi",
    });
    qa.updateSocialBatch(batch.id, { status: "in_qa" });
    qa.updateSocialBatch(batch.id, { issueTag: "typo", issueNote: "wrong price in caption" });
    assert.equal(qa.getSocialBatch(batch.id)?.status, "needs_revisions");
    assert.equal(qa.listSocialIssueRows().some((row) => row.batch_id === batch.id), true);
    assert.ok(qa.socialIssueCounts().some((row) => row.tag === "typo" && row.count >= 1));
  });

  await t.test("approve is refused until the QA checklist is complete", async () => {
    const batch = qa.createSocialBatch({
      title: "Blocked batch",
      createdBy: "randi",
    });
    const result = await qa.signOffSocialBatch({
      batchId: batch.id,
      approvedBy: "Lana Verrecchio",
      actorSlug: "lana",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /checklist/);
  });

  await t.test("sign-off stamps who created, QA’d, and approved the batch", async () => {
    const batch = qa.createSocialBatch({
      title: "Clean batch",
      createdBy: "randi",
    });
    qa.updateSocialBatch(batch.id, { qaBy: "lana" });
    const result = await qa.signOffSocialBatch({
      batchId: batch.id,
      approvedBy: "Lana Verrecchio",
      actorSlug: "lana",
      checklist: { spelling: true, links: true, meg_standard: true },
    });
    assert.equal(result.ok, true);
    const signed = qa.getSocialBatch(batch.id)!;
    assert.equal(signed.status, "approved");
    assert.equal(signed.approved_by, "Lana Verrecchio");
    assert.equal(signed.approved_by_slug, "lana");
    assert.equal(signed.created_by, "randi");
    assert.equal(signed.qa_by, "lana");
    const notes = qa.listSocialQaReviews(batch.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].decision, "approved");
  });

  await t.test("not approving stores feedback on the batch", async () => {
    const batch = qa.createSocialBatch({
      title: "Needs work",
      createdBy: "randi",
    });
    const noNote = await qa.reviewSocialBatch({
      batchId: batch.id,
      approved: false,
      reviewedBy: "Lana Verrecchio",
      actorSlug: "lana",
      feedback: "",
    });
    assert.equal(noNote.ok, false);
    const result = await qa.reviewSocialBatch({
      batchId: batch.id,
      approved: false,
      reviewedBy: "Lana Verrecchio",
      actorSlug: "lana",
      feedback: "Fix the offer dates in the carousel.",
    });
    assert.equal(result.ok, true);
    const sent = qa.getSocialBatch(batch.id)!;
    assert.equal(sent.status, "needs_revisions");
    assert.equal(sent.issue_note, "Fix the offer dates in the carousel.");
    const notes = qa.listSocialQaReviews(batch.id);
    assert.equal(notes[0].decision, "rejected");
    assert.match(notes[0].feedback, /offer dates/);
    assert.match(
      qa.socialQaApproveCommentHtml({
        name: "Lana Verrecchio",
        checklist: { spelling: true, links: true, meg_standard: true },
      }),
      /QA standpoint/
    );
  });

  await t.test("the default QA reviewer is the other social teammate", async () => {
    const { defaultSocialQaAssignee } = await import("../src/lib/people");
    assert.equal(defaultSocialQaAssignee("randi"), "lana");
    assert.equal(defaultSocialQaAssignee("lana"), "randi");
    assert.equal(defaultSocialQaAssignee("michael"), "lana");
    const people = [
      { id: 1, name: "Randi Example", email: "randi@x.com", isClient: false },
      { id: 2, name: "Lana Verrecchio", email: "lana@x.com", isClient: false },
    ];
    assert.equal(qa.pickDefaultSocialQaReviewer(people, "randi")?.id, 2);
    assert.equal(qa.pickDefaultSocialQaReviewer(people, "lana")?.id, 1);
  });

  await t.test("sending for review requires a teammate and due date", async () => {
    const batch = qa.createSocialBatch({
      title: "Needs a reviewer",
      clientName: "Humble Somm",
      sproutUrl: "https://app.sproutsocial.com/messages/compose",
      createdBy: "randi",
    });
    const noPerson = await qa.sendSocialBatchForQa({
      batchId: batch.id,
      reviewerSlug: "",
      dueOn: "2026-09-08",
    });
    assert.equal(noPerson.ok, false);
    const noDue = await qa.sendSocialBatchForQa({
      batchId: batch.id,
      reviewerSlug: "lana",
      dueOn: "",
    });
    assert.equal(noDue.ok, false);
    if (!noDue.ok) assert.match(noDue.error, /due date/i);
  });
});
