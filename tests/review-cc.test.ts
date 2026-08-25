import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  SYLVIA_CC_TEXT,
  findSylviaOnRoster,
  stripSylviaCcLines,
  sylviaCcHtml,
} from "../src/lib/review-cc";
import { SYLVIA_BASECAMP_NAME, basecampNameForManager } from "../src/lib/people";

test("Sylvia's Basecamp name is mapped, not guessed from a first name", () => {
  assert.equal(SYLVIA_BASECAMP_NAME, "Sylvia Artiga");
  assert.equal(basecampNameForManager("sylvia"), "Sylvia Artiga");
});

test("findSylviaOnRoster prefers the mapped display name", () => {
  const sylvia = findSylviaOnRoster([
    { id: 1, name: "Katie Client", client: true },
    { id: 8, name: "Sylvia Artiga", client: false },
    { id: 2, name: "Cassidy Merideth", client: false },
  ]);
  assert.equal(sylvia?.id, 8);
  assert.equal(sylvia?.name, "Sylvia Artiga");
});

test("findSylviaOnRoster accepts a unique first-name hit", () => {
  const sylvia = findSylviaOnRoster([
    { id: 8, name: "Sylvia", client: false },
    { id: 2, name: "Cassidy Merideth", client: false },
  ]);
  assert.equal(sylvia?.id, 8);
});

test("findSylviaOnRoster ignores a client named Sylvia", () => {
  const sylvia = findSylviaOnRoster([
    { id: 9, name: "Sylvia Client", client: true },
    { id: 2, name: "Cassidy Merideth", client: false },
  ]);
  assert.equal(sylvia, null);
});

test("findSylviaOnRoster does not guess when two team Sylvias share a first name", () => {
  const sylvia = findSylviaOnRoster([
    { id: 8, name: "Sylvia Jones", client: false },
    { id: 9, name: "Sylvia Smith", client: false },
  ]);
  assert.equal(sylvia, null);
});

test("CC html uses the real mention when we have one", () => {
  assert.equal(SYLVIA_CC_TEXT, "CC: @Sylvia");
  assert.equal(sylviaCcHtml(), "<p>CC: @Sylvia</p>");
  assert.equal(
    sylviaCcHtml('<bc-attachment sgid="sgid-sylvia"></bc-attachment>'),
    '<p>CC: <bc-attachment sgid="sgid-sylvia"></bc-attachment></p>'
  );
});

test("stripSylviaCcLines drops the plaintext CC so HTML does not duplicate it", () => {
  const stripped = stripSylviaCcLines(
    "Looking forward to hearing from you!\n\nCC: @Sylvia\n"
  );
  assert.equal(stripped, "Looking forward to hearing from you!");
  assert.equal(stripSylviaCcLines("CC: @Sylvia"), "");
});

test("approval card content CCs Sylvia with a real mention", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-review-cc-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.BASECAMP_CLIENT_ID = "test-client";
  process.env.BASECAMP_CLIENT_SECRET = "test-secret";
  process.env.BASECAMP_ACCOUNT_ID = "999";

  const { getDb, nowIso } = await import("../src/lib/db");
  const basecamp = await import("../src/lib/basecamp");
  const { clientApprovalMessageHtml } = await import("../src/lib/client-approval");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(
      "basecamp_tokens",
      JSON.stringify({
        access_token: "TEST-TOKEN",
        refresh_token: "refresh",
        expires_at: Date.now() + 3600_000,
      }),
      nowIso()
    );

  let postedContent = "";
  const roster = [
    {
      id: 4,
      name: "Katie Jones",
      email_address: "katie@client.com",
      client: true,
      attachable_sgid: "sgid-katie",
    },
    {
      id: 8,
      name: "Sylvia Artiga",
      email_address: "sylvia@meg.com",
      client: false,
      employee: true,
      attachable_sgid: "sgid-sylvia",
    },
  ];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/people.json") || url.includes("/circles/people.json")) {
      return json(roster);
    }
    if (url.includes("/projects/") && method === "GET") {
      return json({
        dock: [
          { id: 10, name: "kanban_board", title: "Deliverables", enabled: true },
        ],
      });
    }
    if (url.includes("/card_tables/10.json") && method === "GET") {
      return json({ lists: [{ id: 20, title: "Needs Approval" }] });
    }
    if (url.includes("/cards.json") && method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      postedContent = body.content || "";
      return json({ id: 30, app_url: "https://3.basecamp.com/card/30" });
    }
    if (url.includes("/card_tables/cards/") && method === "PUT") {
      return json({ id: 30 });
    }
    return json([]);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const result = await basecamp.sendApprovalToDeliverables({
    projectId: "proj-1",
    campaignTitle: "Welcome Series",
    buildContent: (contactMention, ccMention) =>
      clientApprovalMessageHtml(
        {
          clientContactName: "Katie Jones",
          campaignTitle: "Welcome Series",
          previewUrl: "https://desk.example/review/token",
        },
        contactMention,
        ccMention
      ),
    recipientIdentifiers: ["katie@client.com", "Katie Jones"],
  });

  assert.equal(result.ok, true);
  assert.match(postedContent, /<p>CC: <bc-attachment sgid="sgid-sylvia"><\/bc-attachment><\/p>/);
  assert.match(postedContent, /bc-attachment sgid="sgid-katie"/);
  assert.doesNotMatch(postedContent, /CC: @Sylvia/);
});
