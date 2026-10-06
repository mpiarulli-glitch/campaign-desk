import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function boot(prefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  closeDbForTests();
  const pages = await import("../src/lib/lifecycle-client-pages");
  const now = nowIso();
  const insert = getDb().prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, 0, ?, ?)`
  );
  insert.run("cl_a", "Harbor", now, now);
  insert.run("cl_b", "Fieldnote", now, now);
  return {
    tmp,
    originalCwd,
    closeDbForTests,
    getDb,
    pages,
  };
}

test("brand and mood links only accept http and https", async (t) => {
  const ctx = await boot("cd-client-pages-url-");
  t.after(() => {
    ctx.closeDbForTests();
    process.chdir(ctx.originalCwd);
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });

  const { pages } = ctx;
  assert.equal(pages.parseHttpUrl("javascript:alert(1)").ok, false);
  assert.equal(pages.parseHttpUrl("data:text/html,hi").ok, false);
  assert.equal(pages.parseHttpUrl("ftp://files.example/guide").ok, false);
  assert.equal(pages.parseHttpUrl("not a url").ok, false);
  assert.equal(pages.parseHttpUrl("  ").ok, false);
  assert.deepEqual(pages.parseHttpUrl("https://docs.example/guide"), {
    ok: true,
    url: "https://docs.example/guide",
  });
  assert.equal(pages.parseHttpUrl("http://docs.example/guide").ok, true);

  assert.equal(pages.setBrandGuide("cl_a", "javascript:alert(1)").ok, false);
  const saved = pages.setBrandGuide("cl_a", " https://docs.example/harbor ");
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.url, "https://docs.example/harbor");
  assert.ok(saved.value.updatedAt);

  const replaced = pages.setBrandGuide("cl_a", "https://www.figma.com/design/harbor/guide");
  assert.equal(replaced.ok, true);
  assert.equal(pages.getBrandGuide("cl_a")?.url, "https://www.figma.com/design/harbor/guide");
  const rows = ctx
    .getDb()
    .prepare(`SELECT COUNT(*) AS n FROM client_brand_guides WHERE client_id = ?`)
    .get("cl_a") as { n: number };
  assert.equal(rows.n, 1);
  assert.equal(pages.getBrandGuide("cl_b"), null);

  assert.equal(
    pages.createMoodReference("cl_a", {
      title: "Board",
      url: "javascript:alert(1)",
    }).ok,
    false
  );
  assert.equal(pages.listMoodReferences("cl_a").length, 0);
});

test("image references are the ones a tile can render", async (t) => {
  const ctx = await boot("cd-client-pages-img-");
  t.after(() => {
    ctx.closeDbForTests();
    process.chdir(ctx.originalCwd);
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });

  const { isImageReferenceUrl } = ctx.pages;
  assert.equal(isImageReferenceUrl("https://picsum.photos/id/1015/800/600"), true);
  assert.equal(isImageReferenceUrl("https://fastly.picsum.photos/id/1015/800/600"), true);
  assert.equal(isImageReferenceUrl("https://cdn.example/photos/river.jpg"), true);
  assert.equal(isImageReferenceUrl("https://cdn.example/photos/river.JPEG"), true);
  assert.equal(isImageReferenceUrl("https://cdn.example/photos/mark.webp?w=400"), true);
  assert.equal(isImageReferenceUrl("https://cdn.example/photos/mark.png"), true);
  assert.equal(isImageReferenceUrl("https://cdn.example/photos/mark.gif"), true);
  assert.equal(
    isImageReferenceUrl("https://res.cloudinary.com/demo/image/upload/sample"),
    true
  );
  assert.equal(isImageReferenceUrl("https://www.figma.com/design/harbor/mood"), false);
  assert.equal(isImageReferenceUrl("https://drive.google.com/drive/folders/abc"), false);
  assert.equal(isImageReferenceUrl("javascript:alert(1)"), false);
});

test("mood references stay on the client they were added to", async (t) => {
  const ctx = await boot("cd-client-pages-mood-");
  t.after(() => {
    ctx.closeDbForTests();
    process.chdir(ctx.originalCwd);
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });

  const { pages } = ctx;
  const created = pages.createMoodReference("cl_a", {
    title: "River light",
    url: "https://picsum.photos/id/1015/800/600",
    note: "Cooler than the logo blue",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.clientId, "cl_a");
  assert.equal(created.value.image, true);
  assert.equal(pages.listMoodReferences("cl_b").length, 0);

  const stolen = pages.updateMoodReference("cl_b", created.value.id, { title: "Stolen" });
  assert.deepEqual(stolen, { ok: false, error: "That reference is not on this client." });
  assert.equal(pages.deleteMoodReference("cl_b", created.value.id).ok, false);
  assert.equal(pages.listMoodReferences("cl_a")[0]?.title, "River light");

  const renamed = pages.updateMoodReference("cl_a", created.value.id, {
    title: "River",
    note: "",
  });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.equal(renamed.value.title, "River");
  assert.equal(renamed.value.note, "");

  assert.equal(pages.deleteMoodReference("cl_a", created.value.id).ok, true);
  assert.equal(pages.listMoodReferences("cl_a").length, 0);
  assert.equal(pages.createMoodReference("missing", { title: "X", url: "https://example.com" }).ok, false);
});

test("only one offer can be this month's focus", async (t) => {
  const ctx = await boot("cd-client-pages-focus-");
  t.after(() => {
    ctx.closeDbForTests();
    process.chdir(ctx.originalCwd);
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });

  const { pages } = ctx;
  const first = pages.createOffer("cl_a", {
    name: "Spring checkup",
    summary: "A seasonal visit before the busy months.",
    isFocus: true,
  });
  const second = pages.createOffer("cl_a", {
    name: "Membership",
    summary: "A monthly plan for people who already come back.",
    isFocus: true,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const afterCreate = pages.listOffers("cl_a");
  assert.deepEqual(
    afterCreate.map((offer) => [offer.id, offer.isFocus]),
    [
      [first.value.id, false],
      [second.value.id, true],
    ]
  );

  const remarked = pages.updateOffer("cl_a", first.value.id, { isFocus: true });
  assert.equal(remarked.ok, true);
  const afterUpdate = pages.listOffers("cl_a");
  assert.equal(afterUpdate.filter((offer) => offer.isFocus).length, 1);
  assert.equal(afterUpdate.find((offer) => offer.id === first.value.id)?.isFocus, true);
  assert.equal(afterUpdate.find((offer) => offer.id === second.value.id)?.isFocus, false);

  const other = pages.createOffer("cl_b", {
    name: "Welcome",
    summary: "One clear first offer for people who just found them.",
    isFocus: true,
  });
  assert.equal(other.ok, true);
  assert.equal(pages.listOffers("cl_a").filter((offer) => offer.isFocus).length, 1);
  assert.equal(pages.listOffers("cl_b").filter((offer) => offer.isFocus).length, 1);

  assert.equal(pages.updateOffer("cl_b", first.value.id, { isFocus: true }).ok, false);
  assert.equal(pages.listOffers("cl_a").find((offer) => offer.id === first.value.id)?.isFocus, true);

  const cleared = pages.updateOffer("cl_a", first.value.id, { isFocus: false });
  assert.equal(cleared.ok, true);
  assert.equal(pages.listOffers("cl_a").some((offer) => offer.isFocus), false);

  const focused = pages
    .listOffers("cl_a")
    .concat(pages.listOffers("cl_b"))
    .filter((offer) => offer.isFocus);
  assert.equal(focused.length, 1);
  assert.equal(focused[0]?.clientId, "cl_b");
});
