import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import {
  CAMPAIGN_DESCRIPTION_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
} from "../src/lib/campaign-copy";

// Next's request storage uses globalThis.AsyncLocalStorage, which Node does
// not set. Install it before any next module loads in this process.
const globalAls = globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (!globalAls.AsyncLocalStorage) globalAls.AsyncLocalStorage = AsyncLocalStorage;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNC_TOKEN = "campaign-details-test-token";
const SESSION_SECRET = "campaign-details-test-secret";

function sessionCookie(payload: string): string {
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

// next/headers cookies() only reads inside a request store. The suite calls
// route handlers directly, so this opens that store around one call.
async function withCookies<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  const { RequestCookies } = await import("next/dist/compiled/@edge-runtime/cookies");
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external.js"
  );
  const { workUnitAsyncStorage } = await import(
    "next/dist/server/app-render/work-unit-async-storage.external.js"
  );
  const headers = new Headers();
  if (token) headers.set("cookie", `cd_session=${token}`);
  const jar = new RequestCookies(headers);
  const workStore = { route: "/api/campaigns/[id]/details" };
  const workUnit = { type: "request", phase: "render", cookies: jar };
  // The stores only need the fields cookies() reads. The full Next types
  // describe a render that this direct call is not.
  return workAsyncStorage.run(workStore as never, () =>
    workUnitAsyncStorage.run(workUnit as never, fn)
  );
}

test("package title and description keep their formatting on the review link", () => {
  const review = fs.readFileSync(
    path.join(root, "src/app/review/[token]/page.tsx"),
    "utf8"
  );
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const admin = fs.readFileSync(
    path.join(root, "src/app/admin/campaigns/[id]/page.tsx"),
    "utf8"
  );
  const editor = fs.readFileSync(
    path.join(root, "src/components/CampaignCopyFields.tsx"),
    "utf8"
  );

  assert.match(review, /<p className="rv-hero-desc">\{campaign\.description\}<\/p>/);
  assert.doesNotMatch(review, /dangerouslySetInnerHTML[^]*campaign\.description/);
  const heroRule = css.slice(css.indexOf(".rv-hero-desc {"), css.indexOf(".rv-hero-desc {") + 500);
  assert.match(heroRule, /white-space:\s*pre-wrap/);
  assert.match(admin, /CampaignCopyFields/);
  assert.match(editor, /Edit title and description/);
  assert.match(editor, /aria-label="Package title"/);
  assert.match(editor, /aria-label="Package description"/);
  assert.match(editor, /Enter saves/);
  assert.match(editor, /e\.key === "Escape"/);
  assert.match(editor, /\/api\/campaigns\/\$\{campaignId\}\/details/);
});

test("PATCH /api/campaigns/[id]/details", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-campaign-details-"));
  const originalCwd = process.cwd();
  const previousSync = process.env.CAMPAIGN_DESK_SYNC_TOKEN;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.CAMPAIGN_DESK_SYNC_TOKEN = SYNC_TOKEN;
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    if (previousSync === undefined) delete process.env.CAMPAIGN_DESK_SYNC_TOKEN;
    else process.env.CAMPAIGN_DESK_SYNC_TOKEN = previousSync;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const campaigns = await import("../src/lib/campaigns");
  const { PATCH } = await import("../src/app/api/campaigns/[id]/details/route");
  const general = await import("../src/app/api/campaigns/[id]/route");
  const review = await import("../src/app/api/review/[token]/route");
  const { search } = await import("../src/lib/search");

  function patch(
    id: string,
    body: unknown,
    auth: { bearer?: string; cookie?: string | null } = { bearer: SYNC_TOKEN }
  ) {
    const headers = new Headers();
    if (auth.bearer) headers.set("authorization", `Bearer ${auth.bearer}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    const request = new Request(`http://localhost/api/campaigns/${id}/details`, {
      method: "PATCH",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return withCookies(auth.cookie ?? null, () =>
      PATCH(request, { params: Promise.resolve({ id }) })
    );
  }

  function emailPackage(title = "October emails", description = "Original note") {
    return campaigns.createCampaign({
      title,
      description,
      clientName: "Pipe It Right",
      htmlContent: "<p>Hello</p>",
    });
  }

  await t.test("rejects anonymous, bad tokens, and people who cannot edit campaigns", async () => {
    const created = emailPackage();
    const anon = await patch(created.id, { title: "Nope" }, {});
    assert.equal(anon.status, 401);

    const wrong = await patch(created.id, { title: "Nope" }, { bearer: "not-the-token" });
    assert.equal(wrong.status, 401);

    const roy = sessionCookie(`forecast:roy:${Date.now()}`);
    const blocked = await patch(created.id, { title: "Nope" }, { cookie: roy });
    assert.equal(blocked.status, 401);

    assert.equal(campaigns.getCampaignById(created.id)?.title, "October emails");
  });

  await t.test("saves title and description for an editor and leaves the rest alone", async () => {
    const created = emailPackage();
    const owner = sessionCookie(`admin:${Date.now()}`);
    const description = "  Line one\r\n\r\nLine two  ·  <em>keep</em>  \n";
    const res = await patch(
      created.id,
      { title: "  October  emails \n", description },
      { cookie: owner }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.campaign.title, "October  emails");
    assert.equal(body.campaign.description, "Line one\n\nLine two  ·  <em>keep</em>");
    assert.equal(body.campaign.status, "draft");
    assert.equal(body.campaign.client_name, "Pipe It Right");

    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, "October  emails");
    assert.equal(row.description, "Line one\n\nLine two  ·  <em>keep</em>");
    assert.equal(row.status, "draft");

    const listed = campaigns.listCampaigns().find((row) => row.id === created.id);
    assert.equal(listed?.title, "October  emails");
    assert.equal(listed?.description, "Line one\n\nLine two  ·  <em>keep</em>");

    const found = search("october  emails");
    assert.equal(found.some((hit) => hit.id === created.id && hit.title === "October  emails"), true);

    const client = await review.GET(
      new Request(`http://localhost/api/review/${created.external_token}`),
      { params: Promise.resolve({ token: created.external_token }) }
    );
    assert.equal(client.status, 200);
    const payload = await client.json();
    assert.equal(payload.campaign.title, "October  emails");
    assert.equal(payload.campaign.description, "Line one\n\nLine two  ·  <em>keep</em>");
  });

  await t.test("a title-only rename keeps the description", async () => {
    const created = emailPackage("Spring note", "Keep this\n\nparagraph");
    const res = await patch(created.id, { title: "Spring package" });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, "Spring package");
    assert.equal(row.description, "Keep this\n\nparagraph");
  });

  await t.test("an empty description clears the note", async () => {
    const created = emailPackage("Has a note", "Remove me");
    const res = await patch(created.id, { description: "   \n  " });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, "Has a note");
    assert.equal(row.description, "");
  });

  await t.test("rejects an empty title and does not write", async () => {
    const created = emailPackage();
    for (const title of ["", "   ", "\n\n"]) {
      const res = await patch(created.id, { title, description: "should not land" });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /can't be empty/);
    }
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, "October emails");
    assert.equal(row.description, "Original note");
  });

  await t.test("rejects titles and descriptions over the limit", async () => {
    const created = emailPackage();
    const title = "T".repeat(CAMPAIGN_TITLE_MAX_LENGTH + 1);
    const tooLongTitle = await patch(created.id, { title });
    assert.equal(tooLongTitle.status, 400);
    assert.match((await tooLongTitle.json()).error, /200 characters or fewer/);

    const okTitle = await patch(created.id, {
      title: "T".repeat(CAMPAIGN_TITLE_MAX_LENGTH),
    });
    assert.equal(okTitle.status, 200);

    const description = "D".repeat(CAMPAIGN_DESCRIPTION_MAX_LENGTH + 1);
    const tooLongDescription = await patch(created.id, { description });
    assert.equal(tooLongDescription.status, 400);
    assert.match((await tooLongDescription.json()).error, /5000 characters or fewer/);

    const okDescription = await patch(created.id, {
      description: "D".repeat(CAMPAIGN_DESCRIPTION_MAX_LENGTH),
    });
    assert.equal(okDescription.status, 200);
    assert.equal(
      campaigns.getCampaignById(created.id)?.description.length,
      CAMPAIGN_DESCRIPTION_MAX_LENGTH
    );
  });

  await t.test("an already long title can still receive a description edit", async () => {
    const created = emailPackage();
    const longTitle = "L".repeat(CAMPAIGN_TITLE_MAX_LENGTH + 40);
    campaigns.updateCampaign(created.id, { title: longTitle });
    const res = await patch(created.id, {
      title: longTitle,
      description: "Still the same heading\n\nNew note",
    });
    assert.equal(res.status, 200);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, longTitle);
    assert.equal(row.description, "Still the same heading\n\nNew note");

    const grown = await patch(created.id, { title: `${longTitle} more` });
    assert.equal(grown.status, 400);
    assert.equal(campaigns.getCampaignById(created.id)?.title, longTitle);
  });

  await t.test("blog scope can edit a blog package and not an email package", async () => {
    const email = emailPackage("Email only");
    const blog = campaigns.createCampaign({
      title: "Blog only",
      description: "A post",
      htmlContent: "# Hello",
      kind: "blog",
    });
    const abel = sessionCookie(`forecast:abel:${Date.now()}`);

    const emailRes = await patch(email.id, { title: "Renamed email" }, { cookie: abel });
    assert.equal(emailRes.status, 404);
    assert.equal(campaigns.getCampaignById(email.id)?.title, "Email only");

    const blogRes = await patch(blog.id, { title: "Renamed blog" }, { cookie: abel });
    assert.equal(blogRes.status, 200);
    assert.equal(campaigns.getCampaignById(blog.id)?.title, "Renamed blog");
    assert.equal(campaigns.getCampaignById(blog.id)?.description, "A post");
  });

  await t.test("the owner can edit an email package and not a blog package", async () => {
    const email = emailPackage("Owner email");
    const blog = campaigns.createCampaign({
      title: "Owner blog",
      htmlContent: "# Post",
      kind: "blog",
    });
    const owner = sessionCookie(`admin:${Date.now()}`);

    const emailRes = await patch(email.id, { title: "Owner renamed" }, { cookie: owner });
    assert.equal(emailRes.status, 200);
    assert.equal(campaigns.getCampaignById(email.id)?.title, "Owner renamed");

    const blogRes = await patch(blog.id, { title: "Should fail" }, { cookie: owner });
    assert.equal(blogRes.status, 404);
    assert.equal(campaigns.getCampaignById(blog.id)?.title, "Owner blog");
  });

  await t.test("missing package, empty body, and non-text title", async () => {
    const missing = await patch("does-not-exist", { title: "Hello" });
    assert.equal(missing.status, 404);

    const created = emailPackage();
    const empty = await patch(created.id, {});
    assert.equal(empty.status, 400);

    const arrayBody = await patch(created.id, ["title"]);
    assert.equal(arrayBody.status, 400);

    const numberTitle = await patch(created.id, { title: 12 });
    assert.equal(numberTitle.status, 400);
    assert.equal(campaigns.getCampaignById(created.id)?.title, "October emails");
  });

  await t.test("the general campaign PATCH uses the same title rule before status changes", async () => {
    const created = emailPackage();
    const headers = new Headers({
      authorization: `Bearer ${SYNC_TOKEN}`,
      "content-type": "application/json",
    });
    const request = new Request(`http://localhost/api/campaigns/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "   ", status: "approved" }),
    });
    const res = await withCookies(null, () =>
      general.PATCH(request, { params: Promise.resolve({ id: created.id }) })
    );
    assert.equal(res.status, 400);
    const row = campaigns.getCampaignById(created.id)!;
    assert.equal(row.title, "October emails");
    assert.equal(row.status, "draft");
  });
});
