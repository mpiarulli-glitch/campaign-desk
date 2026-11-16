import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COL_PITCH,
  EMAIL_BOARD_SOURCE,
  classifyEmailDesign,
  emailBoardBucket,
  stripActiveHtml,
} from "../src/lib/email-board-model";

test("email board classifies stored designs and does not call a sender", () => {
  assert.equal(emailBoardBucket("draft"), "draft");
  assert.equal(emailBoardBucket("internal_review"), "in_review");
  assert.equal(emailBoardBucket("needs_changes"), "in_review");
  assert.equal(emailBoardBucket("in_review"), "in_review");
  assert.equal(emailBoardBucket("approved", "internal"), "approved");
  assert.equal(emailBoardBucket("approved", "client"), "approved");
  assert.equal(emailBoardBucket("scheduled"), "approved");
  assert.equal(emailBoardBucket("sent"), "sent");
  assert.equal(emailBoardBucket("live"), "sent");

  const html = classifyEmailDesign({
    kind: "email",
    bodyFormat: "html",
    html: "<table><tr><td><h1>Welcome</h1><script>alert(1)</script></td></tr></table>",
  });
  assert.equal(html.render, "html");
  assert.match(html.previewHtml, /Welcome/);
  assert.doesNotMatch(html.previewHtml, /<script/i);

  const image = classifyEmailDesign({
    kind: "mockup",
    bodyFormat: "image",
    mediaUrl: "https://cdn.example.com/hero.png",
    html: "Hero",
  });
  assert.equal(image.render, "image");
  assert.equal(image.mediaUrl, "https://cdn.example.com/hero.png");

  const figma = classifyEmailDesign({
    kind: "mockup",
    bodyFormat: "figma",
    mediaUrl: "https://www.figma.com/file/abc/Page",
    html: "",
  });
  assert.equal(figma.render, "link");
  assert.match(figma.linkUrl || "", /figma\.com/);

  const link = classifyEmailDesign({
    kind: "email",
    bodyFormat: "html",
    html: "https://www.klaviyo.com/email-editor/abc123",
  });
  assert.equal(link.render, "link");
  assert.match(link.linkUrl || "", /klaviyo\.com/);

  const logged = classifyEmailDesign({
    html: "<p>Logged off-app — no copy in Campaign Desk.</p>",
    loggedOff: true,
  });
  assert.equal(logged.render, "empty");
  assert.equal(logged.emptyReason, "logged_off");

  const blank = classifyEmailDesign({ html: "<p></p>" });
  assert.equal(blank.render, "empty");
  assert.equal(blank.emptyReason, "blank");

  const sms = classifyEmailDesign({
    kind: "sms",
    bodyFormat: "text",
    html: "Your table is ready",
  });
  assert.equal(sms.render, "text");
  assert.equal(sms.text, "Your table is ready");

  assert.doesNotMatch(stripActiveHtml(`<a onclick="evil()" href="javascript:alert(1)">x</a>`), /onclick|javascript:/i);
  assert.match(EMAIL_BOARD_SOURCE.paragraphs.join(" "), /Klaviyo/);
  assert.match(EMAIL_BOARD_SOURCE.paragraphs.join(" "), /nothing is sent/i);

  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  const server = fs.readFileSync(path.join(root, "src/lib/email-board.ts"), "utf8");
  assert.doesNotMatch(server, /from ["'][^"']*(klaviyo|ghl|basecamp)/i);
  for (const file of [
    "src/app/api/email-board/route.ts",
    "src/app/api/email-board/layout/route.ts",
    "src/app/api/email-board/notes/route.ts",
    "src/app/api/email-board/notes/[id]/route.ts",
  ]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    const body = src.slice(src.indexOf("export async function"));
    assert.match(body, /can\("page\.email_board"\)/, `${file} must gate the page`);
    assert.match(src, /status: 401/, `${file} must refuse a signed-out session`);
    const gate = body.indexOf(`can("page.email_board")`);
    const work = body.search(
      /getEmailBoard\(|saveEmailBoardLayout\(|clearEmailBoardLayout\(|createEmailBoardNote\(|updateEmailBoardNote\(|deleteEmailBoardNote\(/
    );
    assert.ok(gate >= 0 && work > gate, `${file} checks access before reading or writing`);
  }
});

test("email board endpoints assemble, save layout, and keep notes per client", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-email-board-"));
  const original = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso, closeDbForTests } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const board = await import("../src/lib/email-board");
  const access = await import("../src/lib/access");

  try {
    assert.equal(
      access.defaultAllowed("page.email_board", access.subjectFor("michael")),
      true
    );
    for (const slug of ["cassidy", "kyle_morris", "luis_romero", "sylvia"]) {
      assert.equal(
        access.defaultAllowed("page.email_board", access.subjectFor(slug)),
        true,
        slug
      );
    }
    for (const slug of ["jack", "roy", "carlos", "abel"]) {
      assert.equal(
        access.defaultAllowed("page.email_board", access.subjectFor(slug)),
        false,
        slug
      );
    }
    const page = access.PAGES.find((item) => item.key === "page.email_board");
    assert.equal(page?.href, "/admin/email-board");
    assert.equal(page?.icon, "frames");

    const now = nowIso();
    const db = getDb();
    const insertClient = db.prepare(
      `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    );
    insertClient.run("harbor", "Harbor", now, now);
    insertClient.run("other", "Other Co", now, now);

    const welcome = campaigns.createCampaign({
      title: "Welcome",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<table><tr><td><h1>Welcome aboard</h1></td></tr></table>",
      emailTitle: "Welcome",
      presentation: "automation",
      triggerLabel: "Form submitted",
      triggerKind: "form",
    });
    const first = campaigns.listEmails(welcome.id)[0];
    campaigns.setEmailSubjects(first.id, welcome.id, [
      { subject: "Spare subject", preview: "" },
      { subject: "You're in", preview: "Start here" },
    ]);
    const subjects = campaigns.listEmailsWithSubjects(welcome.id)[0].subjects;
    campaigns.setChosenSubject(first.id, subjects[1].id);

    const gate = campaigns.addFlowStep({
      campaignId: welcome.id,
      stepType: "condition",
      conditionKind: "opened",
      conditionLabel: "Opened the last email?",
    });
    assert.ok(gate);
    const yes = campaigns.addFlowStep({
      campaignId: welcome.id,
      stepType: "email",
      parentId: gate!.step.id,
      branch: "yes",
      emailTitle: "Thanks for opening",
    });
    campaigns.updateEmail(yes!.email!.id, {
      htmlContent: "<p>Glad you opened it.</p>",
    });
    campaigns.addFlowStep({
      campaignId: welcome.id,
      stepType: "wait",
      parentId: gate!.step.id,
      branch: "no",
      delayMs: 2 * 86_400_000,
    });
    const no = campaigns.addFlowStep({
      campaignId: welcome.id,
      stepType: "email",
      parentId: gate!.step.id,
      branch: "no",
      emailTitle: "Still there?",
    });
    campaigns.updateEmail(no!.email!.id, { htmlContent: "<p>A nudge.</p>" });

    const promo = campaigns.createCampaign({
      title: "October promo",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<p>Last call for October.</p>",
      emailTitle: "Last call",
    });
    const early = campaigns.addEmail({
      campaignId: promo.id,
      title: "Early bird",
      htmlContent: "<p>Early bird pricing.</p>",
    });
    const promoEmails = campaigns.listEmails(promo.id);
    const lastCall = promoEmails.find((email) => email.title === "Last call")!;
    db.prepare(`UPDATE campaign_emails SET scheduled_send_at = ? WHERE id = ?`).run(
      "2026-10-20T16:00:00.000Z",
      lastCall.id
    );
    db.prepare(`UPDATE campaign_emails SET scheduled_send_at = ? WHERE id = ?`).run(
      "2026-10-02T16:00:00.000Z",
      early!.id
    );
    db.prepare(`UPDATE campaigns SET status = 'in_review' WHERE id = ?`).run(promo.id);

    campaigns.createCampaign({
      title: "Homepage",
      clientName: "Harbor",
      clientId: "harbor",
      kind: "mockup",
      bodyFormat: "image",
      mediaUrl: "https://cdn.example.com/hero.png",
      htmlContent: "Hero",
    });
    campaigns.createCampaign({
      title: "Figma page",
      clientName: "Harbor",
      clientId: "harbor",
      kind: "mockup",
      bodyFormat: "figma",
      mediaUrl: "https://www.figma.com/file/abc/Page",
      htmlContent: "",
    });
    const off = campaigns.createCampaign({
      title: "Sent in Klaviyo",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<p>Logged off-app — no copy in Campaign Desk.</p>",
      emailTitle: "Sent in Klaviyo",
    });
    db.prepare(
      `UPDATE campaigns SET logged_off_app = 1, status = 'sent' WHERE id = ?`
    ).run(off.id);
    campaigns.createCampaign({
      title: "Editor link",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "https://www.klaviyo.com/email-editor/abc123",
      emailTitle: "Editor link",
    });
    campaigns.createCampaign({
      title: "Named only",
      clientName: "Harbor",
      htmlContent: "<p>Matched by the client name.</p>",
      emailTitle: "Named only",
    });
    const hidden = campaigns.createCampaign({
      title: "Archived",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<p>Gone.</p>",
    });
    db.prepare(`UPDATE campaigns SET archived_at = ? WHERE id = ?`).run(now, hidden.id);
    campaigns.createCampaign({
      title: "Other blast",
      clientName: "Other Co",
      clientId: "other",
      htmlContent: "<p>Not Harbor.</p>",
    });
    const scheduled = campaigns.createCampaign({
      title: "Scheduled blast",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<p>On the calendar.</p>",
    });
    db.prepare(
      `UPDATE campaigns SET status = 'scheduled', approved_channel = 'client' WHERE id = ?`
    ).run(scheduled.id);
    const internal = campaigns.createCampaign({
      title: "Internal yes",
      clientName: "Harbor",
      clientId: "harbor",
      htmlContent: "<p>Approved inside.</p>",
    });
    db.prepare(
      `UPDATE campaigns SET status = 'approved', approved_channel = 'internal' WHERE id = ?`
    ).run(internal.id);

    const loaded = board.getEmailBoard("harbor");
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.missing, false);
    assert.equal(loaded.body.client?.name, "Harbor");
    const groupTitles = loaded.body.groups.map((group) => group.title);
    assert.ok(groupTitles.indexOf("Welcome") < groupTitles.indexOf("October promo"));
    assert.ok(groupTitles.indexOf("October promo") < groupTitles.indexOf("Sent in Klaviyo"));
    const titles = loaded.body.frames.map((frame) => frame.title);
    assert.ok(!titles.includes("Archived"));
    assert.ok(!titles.includes("Other blast"));
    assert.ok(titles.includes("Named only"));
    assert.ok(titles.includes("Welcome"));
    assert.ok(titles.includes("Opened the last email?"));

    const welcomeFrame = loaded.body.frames.find((frame) => frame.key === first.id)!;
    const yesFrame = loaded.body.frames.find((frame) => frame.title === "Thanks for opening")!;
    const noFrame = loaded.body.frames.find((frame) => frame.title === "Still there?")!;
    assert.equal(welcomeFrame.subject, "You're in");
    assert.equal(welcomeFrame.previewText, "Start here");
    assert.equal(welcomeFrame.bucket, "draft");
    assert.equal(welcomeFrame.sendLabel, "Day 0");
    assert.ok(yesFrame.x - welcomeFrame.x >= COL_PITCH * 2 - 1);
    assert.equal(yesFrame.laneLabel, "Yes");
    assert.equal(noFrame.laneLabel, "No");
    assert.equal(noFrame.sendLabel, "Day 2");
    assert.ok(noFrame.y > yesFrame.y);
    assert.equal(noFrame.x, yesFrame.x);
    assert.equal(welcomeFrame.campaignHref, `/admin/campaigns/${welcome.id}`);
    assert.match(welcomeFrame.reviewHref, /^\/review\//);

    const earlyFrame = loaded.body.frames.find((frame) => frame.title === "Early bird")!;
    const lastFrame = loaded.body.frames.find((frame) => frame.title === "Last call")!;
    assert.ok(earlyFrame.x < lastFrame.x);
    assert.equal(earlyFrame.bucket, "in_review");
    assert.match(earlyFrame.sendLabel, /Oct/);

    const shot = loaded.body.frames.find((frame) => frame.groupTitle === "Homepage")!;
    assert.equal(shot.render, "image");
    const figma = loaded.body.frames.find((frame) => frame.groupTitle === "Figma page")!;
    assert.equal(figma.render, "link");
    const loggedOff = loaded.body.frames.find((frame) => frame.title === "Sent in Klaviyo")!;
    assert.equal(loggedOff.render, "empty");
    assert.equal(loggedOff.emptyReason, "logged_off");
    assert.equal(loggedOff.bucket, "sent");
    const editor = loaded.body.frames.find((frame) => frame.title === "Editor link")!;
    assert.equal(editor.render, "link");
    assert.match(editor.linkUrl || "", /klaviyo\.com/);
    assert.equal(
      loaded.body.frames.find((frame) => frame.groupTitle === "Scheduled blast")?.bucket,
      "approved"
    );
    assert.equal(
      loaded.body.frames.find((frame) => frame.groupTitle === "Internal yes")?.bucket,
      "approved"
    );

    const before = db
      .prepare(`SELECT html_content, status FROM campaigns WHERE id = ?`)
      .get(welcome.id);
    const saved = board.saveEmailBoardLayout("harbor", [
      { frameKey: first.id, x: 40, y: 88 },
    ]);
    assert.equal(saved.status, 200);
    assert.deepEqual(
      db.prepare(`SELECT html_content, status FROM campaigns WHERE id = ?`).get(welcome.id),
      before
    );
    const moved = board
      .getEmailBoard("harbor")
      .body.frames.find((frame) => frame.key === first.id)!;
    assert.equal(moved.x, 40);
    assert.equal(moved.y, 88);
    assert.equal(moved.placed, true);
    assert.notEqual(moved.defaultX, 40);

    assert.equal(board.saveEmailBoardLayout("nope", []).status, 404);
    assert.equal(
      board.saveEmailBoardLayout("harbor", [{ frameKey: "a", x: Number.NaN, y: 1 }]).status,
      400
    );
    assert.equal(board.clearEmailBoardLayout("harbor").status, 200);
    const restored = board
      .getEmailBoard("harbor")
      .body.frames.find((frame) => frame.key === first.id)!;
    assert.equal(restored.x, restored.defaultX);
    assert.equal(restored.placed, false);
    assert.deepEqual(
      db.prepare(`SELECT html_content, status FROM campaigns WHERE id = ?`).get(welcome.id),
      before
    );

    const note = board.createEmailBoardNote({
      clientId: "harbor",
      x: 12,
      y: 24,
      body: "Check the hero",
      color: "pink",
      author: "Cassidy",
    });
    assert.equal(note.status, 200);
    if (!("note" in note.body)) throw new Error("expected a note");
    assert.equal(note.body.note.color, "pink");
    assert.equal(note.body.note.author, "Cassidy");
    const edited = board.updateEmailBoardNote(note.body.note.id, { body: "Updated note" });
    assert.equal(edited.status, 200);
    if (!("note" in edited.body)) throw new Error("expected an updated note");
    assert.equal(edited.body.note.body, "Updated note");
    assert.equal(board.getEmailBoard("other").body.notes.length, 0);
    assert.equal(board.getEmailBoard("harbor").body.notes.length, 1);
    assert.equal(board.deleteEmailBoardNote(note.body.note.id).status, 200);
    assert.equal(board.getEmailBoard("harbor").body.notes.length, 0);
    assert.equal(board.deleteEmailBoardNote(note.body.note.id).status, 404);
    assert.equal(board.updateEmailBoardNote("missing", { body: "x" }).status, 404);
    assert.equal(
      board.createEmailBoardNote({
        clientId: "harbor",
        x: "nope",
        y: 1,
        body: "",
        color: "yellow",
        author: "A",
      }).status,
      400
    );

    const auto = board.getEmailBoard(null);
    assert.equal(auto.status, 200);
    assert.ok(auto.body.client);
    assert.ok(auto.body.clients.some((client) => client.id === "harbor" && client.frames > 0));
    const missing = board.getEmailBoard("not-a-client");
    assert.equal(missing.body.missing, true);
    assert.equal(missing.body.client, null);
  } finally {
    closeDbForTests();
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
