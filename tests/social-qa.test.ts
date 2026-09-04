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

  await t.test("a batch stores the sprout link, creator, and post rows", () => {
    const batch = qa.createSocialBatch({
      title: "Humble Somm — week of Sep 8",
      clientName: "Humble Somm",
      sproutUrl: "https://app.sproutsocial.com/messages/compose",
      createdBy: "randi",
      posts: [
        { title: "Patio cocktail reel", channel: "Instagram", createdBy: "randi" },
        { title: "Story set", channel: "Instagram", createdBy: "lana" },
      ],
    });
    assert.equal(batch.status, "draft");
    assert.equal(batch.sprout_url.includes("sproutsocial"), true);
    assert.equal(batch.created_by, "randi");
    const posts = qa.listSocialPosts(batch.id);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].created_by, "randi");
    assert.equal(posts[1].created_by, "lana");
  });

  await t.test("flagging an issue during QA sends the batch back", () => {
    const batch = qa.createSocialBatch({
      title: "Cisco week",
      createdBy: "randi",
      posts: [{ title: "Carousel", createdBy: "randi" }],
    });
    qa.updateSocialBatch(batch.id, { status: "in_qa" });
    const post = qa.listSocialPosts(batch.id)[0];
    qa.updateSocialPost(post.id, { issueTag: "typo", issueNote: "wrong price in caption" });
    assert.equal(qa.getSocialBatch(batch.id)?.status, "needs_revisions");
    assert.equal(qa.listSocialIssueRows().some((row) => row.post_id === post.id), true);
    assert.ok(qa.socialIssueCounts().some((row) => row.tag === "typo" && row.count >= 1));
  });

  await t.test("sign-off is refused while a post is still flagged", async () => {
    const batch = qa.createSocialBatch({
      title: "Blocked batch",
      createdBy: "randi",
      posts: [{ title: "Post", createdBy: "randi" }],
    });
    const post = qa.listSocialPosts(batch.id)[0];
    qa.updateSocialPost(post.id, { issueTag: "wrong_date" });
    const result = await qa.signOffSocialBatch({
      batchId: batch.id,
      approvedBy: "Lana Verrecchio",
      actorSlug: "lana",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /flagged/);
  });

  await t.test("sign-off stamps creator, QA, and named approval on every row", async () => {
    const batch = qa.createSocialBatch({
      title: "Clean batch",
      createdBy: "randi",
      posts: [
        { title: "Reel", createdBy: "randi" },
        { title: "Static", createdBy: "lana" },
      ],
    });
    const [first] = qa.listSocialPosts(batch.id);
    qa.updateSocialPost(first.id, { qaBy: "lana" });
    const result = await qa.signOffSocialBatch({
      batchId: batch.id,
      approvedBy: "Lana Verrecchio",
      actorSlug: "lana",
    });
    assert.equal(result.ok, true);
    const signed = qa.getSocialBatch(batch.id)!;
    assert.equal(signed.status, "approved");
    assert.equal(signed.approved_by, "Lana Verrecchio");
    assert.equal(signed.approved_by_slug, "lana");
    for (const post of qa.listSocialPosts(batch.id)) {
      assert.equal(post.signed_off_by, "Lana Verrecchio");
      assert.ok(post.signed_off_at);
      assert.ok(post.qa_by);
    }
  });

  await t.test("the default QA reviewer is the other social teammate", () => {
    const people = [
      { id: 1, name: "Randi Example", email: "randi@x.com", isClient: false },
      { id: 2, name: "Lana Verrecchio", email: "lana@x.com", isClient: false },
    ];
    assert.equal(qa.pickDefaultSocialQaReviewer(people, "randi")?.id, 2);
    assert.equal(qa.pickDefaultSocialQaReviewer(people, "lana")?.id, 1);
  });
});
