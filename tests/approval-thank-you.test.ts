import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clientApprovalThankYouHtml,
  clientApprovalThankYouText,
} from "../src/lib/client-approval";

test("approval thank-you message tags the client when a mention is provided", () => {
  const text = clientApprovalThankYouText({ clientContactName: "Katie Jones" });
  assert.equal(text, "Hi Katie, thank you for approval!");

  const html = clientApprovalThankYouHtml(
    { clientContactName: "Katie Jones" },
    '<bc-attachment sgid="abc"></bc-attachment>'
  );
  assert.match(
    html,
    /Hi <bc-attachment sgid="abc"><\/bc-attachment>, thank you for approval!/
  );
});

test("scheduling approval thank-you", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-thankyou-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");

  const db = getDb();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO campaigns (
       id, title, client_name, description, audience, html_content, status,
       magic_token, external_token, approved_at, approved_by, approved_channel,
       basecamp_card_id, created_at, updated_at
     ) VALUES (?, ?, ?, '', '', '', 'approved', ?, ?, ?, ?, 'client', ?, ?, ?)`
  ).run(
    "camp-1",
    "Welcome Series",
    "Vitatherapy",
    "magic-1",
    "ext-1",
    ts,
    "Katie Jones",
    "card-1",
    ts,
    ts
  );

  await t.test("schedules a due time when the client approves on a card", () => {
    campaigns.scheduleApprovalThankYou("camp-1");
    const row = campaigns.getCampaignById("camp-1")!;
    assert.ok(row.approval_thank_you_due_at);
    assert.equal(row.approval_thank_you_sent_at, null);
    const dueMs = Date.parse(row.approval_thank_you_due_at!);
    assert.ok(dueMs > Date.now());
    assert.ok(dueMs <= Date.now() + campaigns.APPROVAL_THANK_YOU_DELAY_MS + 1000);
  });

  await t.test("lists due rows once the delay has passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      `UPDATE campaigns SET approval_thank_you_due_at = ? WHERE id = ?`
    ).run(past, "camp-1");
    const due = campaigns.listDueApprovalThankYous();
    assert.equal(due.length, 1);
    assert.equal(due[0].id, "camp-1");
  });

  await t.test("clears pending thank-you when approval is undone", () => {
    campaigns.clearApprovalThankYou("camp-1");
    const row = campaigns.getCampaignById("camp-1")!;
    assert.equal(row.approval_thank_you_due_at, null);
    assert.equal(row.approval_thank_you_sent_at, null);
  });
});
