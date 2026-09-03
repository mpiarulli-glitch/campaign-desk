import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import {
  internalReviewFollowupHtml,
  internalReviewMention,
  internalReviewTodoContent,
  internalReviewTodoHtmlFromText,
  internalReviewTodoMessageText,
  parseInternalReviewDueOn,
  pickDefaultInternalReviewer,
  teamPeopleForInternalReview,
  withInternalReviewGreeting,
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
  assert.match(content.description, /What I'm looking for in this pass/);
  assert.match(content.description, /Is this on brand/);
  assert.match(content.description, /How to review in the app/);
  assert.match(content.description, /Internal review link/);
  assert.match(content.description, /https:\/\/desk\.example\/review\/internal-token/);
  assert.match(content.description, /CC: @Sylvia/);
  assert.doesNotMatch(content.description, /Open in Campaign Desk/);
});

test("internal review note starts from a plaintext template the sender can edit", () => {
  const text = internalReviewTodoMessageText({
    reviewerName: "Cassidy Merideth",
    reviewUrl: "https://desk.example/review/internal-token",
  });
  assert.match(text, /^@Cassidy, please review this campaign internally/);
  assert.match(text, /What I'm looking for in this pass:/);
  assert.match(text, /Is this on brand\?/);
  assert.match(text, /Are the offers I've included appropriate\?/);
  assert.match(text, /Does this align with the overall strategy\?/);
  assert.match(text, /How to review in the app:/);
  assert.match(text, /Approve and notify email team/);
  assert.match(text, /at the top of the page/);
  assert.match(text, /Internal review link:\nhttps:\/\/desk\.example\/review\/internal-token/);
  assert.match(text, /CC: @Sylvia/);
  assert.equal(
    withInternalReviewGreeting(text.replace(/^@Cassidy,/, "Hey,"), "Kyle Morris"),
    text.replace(/^@Cassidy,/, "@Kyle,")
  );
});

test("edited internal review note keeps extras, links, and mentions", () => {
  const html = internalReviewTodoHtmlFromText(
    `@Cassidy, please also check the SMS copy.

Internal review link:
https://desk.example/review/internal-token

<script>alert(1)</script>

CC: @Sylvia`,
    '<bc-attachment sgid="sgid-cassidy"></bc-attachment>',
    '<bc-attachment sgid="sgid-sylvia"></bc-attachment>'
  );
  assert.match(html, /<bc-attachment sgid="sgid-cassidy"><\/bc-attachment>, please also check the SMS copy/);
  assert.doesNotMatch(html, /@Cassidy,/);
  assert.match(html, /<a href="https:\/\/desk\.example\/review\/internal-token">Internal review link<\/a>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /CC: <bc-attachment sgid="sgid-sylvia"><\/bc-attachment>/);
  assert.equal(html.match(/CC:/g)?.length, 1);
  // Basecamp has no paragraph margins — blank lines must be explicit <br>s.
  assert.match(html, /<\/p><br><ul>/);
  assert.match(html, /<\/ul><br><p>/);
  assert.match(html, /<\/p><br><p>CC:/);
});

test("edited internal review note still mentions the reviewer if the greeting was removed", () => {
  const html = internalReviewTodoHtmlFromText(
    "One extra note about the footer links.",
    '<bc-attachment sgid="sgid-cassidy"></bc-attachment>'
  );
  assert.match(html, /^<p><bc-attachment sgid="sgid-cassidy"><\/bc-attachment>, /);
  assert.match(html, /One extra note about the footer links/);
  assert.match(html, /CC: @Sylvia/);
});

test("internal review CC uses the Basecamp attachment when Sylvia is resolved", () => {
  const content = internalReviewTodoContent({
    campaignTitle: "April newsletter",
    clientName: "Vitatherapy",
    mention: '<bc-attachment sgid="sgid-cassidy"></bc-attachment>',
    reviewUrl: "https://desk.example/review/internal-token",
    cc: '<bc-attachment sgid="sgid-sylvia"></bc-attachment>',
  });
  assert.match(content.description, /CC: <bc-attachment sgid="sgid-sylvia"><\/bc-attachment>/);
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

test("internal review follow-up copy nudges the AM", () => {
  const html = internalReviewFollowupHtml({
    reviewerName: "Cassidy Merideth",
    campaignTitle: "Krak Boba Oceanside Post-Launch Email + SMS Sequence",
    reviewUrl: "https://desk.example/review/token",
    mention: "@Cassidy",
  });
  assert.match(html, /Hi @Cassidy/);
  assert.match(html, /still waiting on you/);
  assert.match(html, /https:\/\/desk\.example\/review\/token/);
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
  const createdTodos: Array<{ id: number; content: string; app_url: string }> = [];
  let nextTodoId = 99;
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
        {
          id: 8,
          name: "Sylvia Artiga",
          email_address: "sylvia@meg.com",
          client: false,
          employee: true,
          attachable_sgid: "sgid-sylvia",
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
      const id = nextTodoId++;
      const app_url = `https://3.basecamp.com/todo/${id}`;
      createdTodos.push({ id, content: lastTodo?.content || "", app_url });
      return json({ id, app_url });
    }
    if (url.includes("/todos.json") && method === "GET") {
      return json(createdTodos);
    }
    if (url.includes("/comments.json") && method === "POST") {
      return json({ id: 1, app_url: "https://3.basecamp.com/comment/1" });
    }
    return json([]);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await t.test("GET state has no to-do link before the first send", async () => {
    const state = await internal.internalReviewState(created.id);
    assert.ok(state);
    assert.equal(state.todoUrl, null);
    assert.equal(state.todoId, null);
    assert.match(state.message, /@Cassidy, please review this campaign internally/);
    assert.match(state.message, /Internal review link:/);
  });

  await t.test("creates an assigned Basecamp to-do and sets Internal review", async () => {
    getDb()
      .prepare(
        `UPDATE campaigns SET basecamp_card_id = ?, basecamp_card_url = ? WHERE id = ?`
      )
      .run("card-1", "https://3.basecamp.com/card/1", created.id);

    const result = await internal.sendCampaignForInternalReview({
      campaignId: created.id,
      reviewerId: 2,
      dueOn: "2026-08-25",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.reviewerName, "Cassidy Merideth");
    assert.equal(result.todoId, "99");
    assert.equal(result.todoUrl, "https://3.basecamp.com/todo/99");
    assert.equal(result.status, "internal_review");
    assert.equal(result.dueOn, "2026-08-25");
    assert.equal(lastTodo?.assignee_ids?.[0], 2);
    assert.equal(lastTodo?.due_on, "2026-08-25");
    assert.match(lastTodo?.content || "", /April newsletter/);
    assert.match(lastTodo?.description || "", /bc-attachment sgid="sgid-cassidy"/);
    assert.match(lastTodo?.description || "", /bc-attachment sgid="sgid-sylvia"/);
    assert.match(lastTodo?.description || "", /CC:/);
    assert.match(lastTodo?.description || "", /Internal review link/);
    assert.doesNotMatch(lastTodo?.description || "", /Open in Campaign Desk/);

    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "internal_review");
    assert.notEqual(row.status, "in_review");
    assert.notEqual(row.status, "approved");
    assert.equal(row.approved_channel, null);
    assert.equal(row.approval_thank_you_due_at, null);
    assert.equal(row.internal_review_todo_id, "99");
    assert.equal(row.internal_review_todo_url, "https://3.basecamp.com/todo/99");
    assert.equal(row.basecamp_card_id, "card-1");
    assert.equal(row.basecamp_card_url, "https://3.basecamp.com/card/1");

    const state = await internal.internalReviewState(created.id);
    assert.ok(state);
    assert.equal(state.todoUrl, "https://3.basecamp.com/todo/99");
    assert.equal(state.todoId, "99");

    const deskTodo = todos.listTodos({ assignee: "cassidy" })[0];
    assert.ok(deskTodo);
    assert.match(deskTodo.title, /April newsletter/);
    assert.equal(deskTodo.due_date, "2026-08-25");
  });

  await t.test("opening the posted internal review link does not flip to Sent for approval", async () => {
    const { GET } = await import("../src/app/api/review/[token]/route");
    const camp = campaigns.getCampaignById(created.id)!;
    const req = new Request(`http://localhost/api/review/${camp.magic_token}`);
    await GET(req, { params: Promise.resolve({ token: camp.magic_token }) });
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.status, "internal_review");
    assert.notEqual(row.status, "in_review");
  });

  await t.test("re-send stores the new Basecamp to-do URL", async () => {
    const result = await internal.sendCampaignForInternalReview({
      campaignId: created.id,
      reviewerId: 2,
      dueOn: "2026-08-26",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.todoId, "100");
    assert.equal(result.todoUrl, "https://3.basecamp.com/todo/100");

    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.internal_review_todo_id, "100");
    assert.equal(row.internal_review_todo_url, "https://3.basecamp.com/todo/100");
    assert.equal(row.basecamp_card_id, "card-1");
    assert.equal(row.basecamp_card_url, "https://3.basecamp.com/card/1");
  });

  await t.test("state still finds Cassidy's desk to-do if the campaign lost the Basecamp URL", async () => {
    getDb()
      .prepare(
        `UPDATE campaigns SET internal_review_todo_id = NULL, internal_review_todo_url = NULL WHERE id = ?`
      )
      .run(created.id);
    const desk = internal.deskInternalReviewTodo(created.id);
    assert.ok(desk);
    assert.equal(desk.assignee, "cassidy");

    const state = await internal.internalReviewState(created.id);
    assert.ok(state);
    assert.equal(state.deskTodoId, desk.id);
    assert.equal(state.assigneeSlug, "cassidy");
    assert.equal(state.forecastUrl, "/admin/forecast/cassidy");
    assert.equal(state.todoId, "100");
    assert.equal(state.todoUrl, "https://3.basecamp.com/todo/100");
  });

  await t.test("follow-up comments on the Basecamp to-do", async () => {
    const result = await internal.followUpInternalReview(created.id);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.recipient, "Cassidy Merideth");
  });

  await t.test("edited note becomes the Basecamp to-do description", async () => {
    const result = await internal.sendCampaignForInternalReview({
      campaignId: created.id,
      reviewerId: 2,
      message: `@Cassidy, please also check the SMS copy.

Internal review link:
https://desk.example/review/custom`,
    });
    assert.equal(result.ok, true);
    assert.match(lastTodo?.description || "", /please also check the SMS copy/);
    assert.match(lastTodo?.description || "", /bc-attachment sgid="sgid-cassidy"/);
    assert.match(lastTodo?.description || "", /https:\/\/desk\.example\/review\/custom/);
    assert.doesNotMatch(
      lastTodo?.description || "",
      /please review this campaign internally before it goes to the client/
    );
  });
});

test("campaign detail shows a Basecamp to-do link after internal review", () => {
  const page = fs.readFileSync(
    path.join("src/app/admin/campaigns/[id]/page.tsx"),
    "utf8"
  );
  const start = page.indexOf("Internal review");
  const end = page.indexOf("client approval workflow");
  assert.ok(start >= 0 && end > start);
  const panel = page.slice(start, end);

  assert.match(panel, /Open to-do/);
  assert.match(panel, /Follow-up with/);
  assert.match(panel, /internalReview\?\.todoUrl/);
  assert.match(panel, /To-do note/);
  assert.match(panel, /internal-review-message/);
  assert.match(panel, /internalReviewMessage/);
  assert.match(panel, /target="_blank"/);
  assert.doesNotMatch(panel, /forecastUrl/);
  assert.match(page, /data\.todoUrl/);
  assert.match(page, /setInternalReview\(\(prev\) =>/);
  assert.doesNotMatch(panel, /basecampApproval\.cardUrl/);
  assert.doesNotMatch(panel, /basecamp_card_url/);
});
