import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("highlighted copy comments store the passage they were left on", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-copy-quote-"));
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
  const campaign = campaigns.createCampaign({
    title: "Spring sale",
    htmlContent: "<p>Book a consultation today. Book a consultation today.</p>",
  });
  const email = campaigns.listEmails(campaign.id)[0];

  const comment = campaigns.addComment({
    campaignId: campaign.id,
    emailId: email.id,
    authorName: "Alex Boss",
    body: "Make this shorter.",
    type: "inline",
    quoteText: "Book a consultation today",
    quoteOrdinal: 1,
    channel: "internal",
  });

  assert.equal(comment.quote_text, "Book a consultation today");
  assert.equal(comment.quote_ordinal, 1);
  assert.equal(comment.pin_x, null);
  assert.equal(comment.pin_y, null);
  assert.equal(comment.type, "inline");

  const listed = campaigns.listComments(campaign.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].quote_text, "Book a consultation today");
  assert.equal(listed[0].quote_ordinal, 1);
});
