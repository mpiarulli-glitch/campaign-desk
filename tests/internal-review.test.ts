import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  internalReviewMention,
  internalReviewTodoContent,
  parseInternalReviewDueOn,
  pickDefaultInternalReviewer,
  teamPeopleForInternalReview,
} from "../src/lib/internal-review";

test("internal review todo copy mentions the AM and only the review link", () => {
  const content = internalReviewTodoContent({
    campaignTitle: "Krak Boba Oceanside Post-Launch Email + SMS Sequence",
    clientName: "Krak Boba Oceanside",
    mention: "@Cassidy",
    reviewUrl: "https://desk.example/review/internal-token",
  });
  assert.equal(
    content.title,
    "Review Krak Boba Oceanside: Krak Boba Oceanside Post-Launch Email + SMS Sequence"
  );
  assert.match(content.description, /@Cassidy, please review this campaign internally/);
  assert.match(content.description, /Internal review link/);
  assert.match(content.description, /https:\/\/desk\.example\/review\/internal-token/);
  assert.doesNotMatch(content.description, /Open in Campaign Desk/);
});

test("internal review mention uses the Basecamp attachment when possible", () => {
  assert.equal(
    internalReviewMention({
      id: 2,
      name: "Cassidy Merideth",
      attachable_sgid: "sgid-cassidy",
    }),
    `<bc-attachment sgid="sgid-cassidy"></bc-attachment>`
  );
  assert.equal(
    internalReviewMention({ id: 2, name: "Cassidy Merideth" }),
    "@Cassidy"
  );
  assert.equal(parseInternalReviewDueOn("2026-08-25"), "2026-08-25");
  assert.equal(parseInternalReviewDueOn("tomorrow"), null);
  assert.equal(parseInternalReviewDueOn(""), null);
});

test("default internal reviewer prefers the mapped account manager", () => {
  const people = teamPeopleForInternalReview([
    { id: 1, name: "Katie Client", email_address: "katie@client.com", client: true },
    { id: 2, name: "Cassidy Merideth", email_address: "cassidy@meg.com", client: false, employee: true },
    { id: 3, name: "Morris Kyle", email_address: "kyle@meg.com", client: false, employee: true },
  ]);
  assert.equal(people.some((p) => p.isClient), false);
  assert.equal(pickDefaultInternalReviewer(people, "cassidy")?.id, 2);
  assert.equal(pickDefaultInternalReviewer(people, "kyle")?.id, 3);
  assert.equal(pickDefaultInternalReviewer(people, "")?.id, undefined);
});

test("sending a campaign for internal review", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-internal-review-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.BASECAMP_CLIENT_ID = "test-client";
  process.env.BASECAMP_CLIENT_SECRET = "test-secret";
  process.env.BASECAMP_ACCOUNT_ID = "999";
  process.env.NEXT_PUBLIC_APP_URL = "https://desk.example";

  const { getDb, nowIso } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const revenue = await import("../src/lib/revenue");
  const internal = await import("../src/lib/internal-review");
  const todos = await import("../src/lib/todos");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const created = campaigns.createCampaign({
    title: "April newsletter",
    clientName: "Vitatherapy",
    htmlContent: "<p>Hi</p>",
  });
  const client = revenue.createRevClient({
    name: "Vitatherapy",
    businessModel: "ecomm",
  });
  revenue.updateRevClient(client.id, {
    accountManager: "cassidy",
    basecampProjectId: "proj-1",
  });
  campaigns.updateCampaign(created.id, { clientId: client.id });

  await t.test("fails clearly when Basecamp is not connected", async () => {
    const result = await internal.sendCampaignForInternalReview({
      campaignId: created.id,
      reviewerId: 2,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Basecamp isn't connected/);
    }
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "draft");
    assert.equal(row.approved_channel, null);
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

  let lastTodo: {
    content?: string;
    description?: string;
    assignee_ids?: number[];
    due_on?: string;
  } | null = null;
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
      return json([
        {
          id: 2,
          name: "Cassidy Merideth",
          email_address: "cassidy@meg.com",
          client: false,
          employee: true,
          attachable_sgid: "sgid-cassidy",
        },
      ]);
    }
    if (url.includes("/projects/") && method === "GET") {
      return json({ dock: [{ id: 9, name: "todoset", enabled: true }] });
    }
    if (url.includes("/todolists.json") && method === "GET") {
      return json([{ id: 7, title: "Campaign Review" }]);
    }
    if (url.includes("/todos.json") && method === "POST") {
      lastTodo = JSON.parse(String(init?.body || "{}"));
      return json({ id: 99, app_url: "https://3.basecamp.com/todo/99" });
    }
    return json([]);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await t.test("creates an assigned Basecamp to-do and sets Internal review", async () => {
    const result = await internal.sendCampaignForInternalReview({
      campaignId: created.id,
      reviewerId: 2,
      dueOn: "2026-08-25",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.reviewerName, "Cassidy Merideth");
    assert.equal(result.todoUrl, "https://3.basecamp.com/todo/99");
    assert.equal(result.status, "internal_review");
    assert.equal(result.dueOn, "2026-08-25");
    assert.equal(lastTodo?.assignee_ids?.[0], 2);
    assert.equal(lastTodo?.due_on, "2026-08-25");
    assert.match(lastTodo?.content || "", /April newsletter/);
    assert.match(lastTodo?.description || "", /bc-attachment sgid="sgid-cassidy"/);
    assert.match(lastTodo?.description || "", /Internal review link/);
    assert.doesNotMatch(lastTodo?.description || "", /Open in Campaign Desk/);

    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "internal_review");
    assert.notEqual(row.status, "in_review");
    assert.notEqual(row.status, "approved");
    assert.equal(row.approved_channel, null);
    assert.equal(row.approval_thank_you_due_at, null);

    const deskTodo = todos.listTodos({ assignee: "cassidy" })[0];
    assert.ok(deskTodo);
    assert.match(deskTodo.title, /April newsletter/);
    assert.equal(deskTodo.due_date, "2026-08-25");
  });
});
