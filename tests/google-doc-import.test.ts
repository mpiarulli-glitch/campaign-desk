import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mdToHtml, renderAssetDoc } from "../src/lib/asset-kinds";
import {
  GOOGLE_DOC_SHARE_ERROR,
  googleDocHtmlToArticle,
  googleDocIdFromLink,
  importPublicGoogleDoc,
  inlineGoogleDocImages,
} from "../src/lib/google-doc-import";

const DOC_ID = "1AbCdefGHIjklmnopQRSTUVWXYZ123456";
const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`;

const FIXTURE = `<html><head><title>How to Service Your HVAC - Google Docs</title><style>
.c0{color:#000000;font-weight:400;text-decoration:none;font-style:normal}
.c1{color:#000000;font-weight:700;text-decoration:none;font-style:normal}
.c2{color:#000000;font-weight:400;font-style:italic;text-decoration:none}
.c3{color:#000000;font-weight:400;text-decoration:underline;font-style:normal}
.c4{font-weight:700;font-style:italic;text-decoration:underline}
.title{font-size:26pt}
.subtitle{font-style:italic}
.cSub{font-size:13pt}
</style></head><body class="doc-content">
<script>alert(1)</script>
<iframe src="https://evil.example/embed"></iframe>
<p class="title"><span class="c1">How to Service Your HVAC</span></p>
<p class="subtitle"><span class="c0">A homeowner guide</span></p>
<p class="subtitle"><span class="cSub">Resumen</span><span class="cSub">.</span></p>
<h1><span class="c1">Why it matters</span></h1>
<h2><span class="c0">Filters</span></h2>
<h3><span class="c0">Monthly</span></h3>
<p><span class="c0">Keep the ca&ntilde;&oacute;n </span><span class="c1">clean</span><span class="c0"> and </span><span class="c2">dry</span><span class="c0">, then </span><span class="c3">check the filter</span><span class="c0">. </span><span class="c4">Do both.</span></p>
<p><span class="c0">See </span><a href="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fguide&amp;sa=D"><span class="c0">this guide</span></a><span class="c0">.</span></p>
<p><a href="javascript:alert(1)">nope link</a><img src="javascript:alert(2)" alt="bad"></p>
<ul><li><span class="c0">Replace the filter</span><ul><li><span class="c0">Monthly</span></li></ul></li><li><span class="c0">Clear the drain</span></li></ul>
<ol><li><span class="c0">Turn off power</span></li><li><span class="c0">Open the panel</span></li></ol>
<p><span style="overflow:hidden"><img alt="Filter location" src="https://lh3.googleusercontent.com/docsz/abc"></span></p>
<p><img alt="Dot" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="></p>
<table><tr><td><p><span class="c1">Step</span></p></td><td><p><span class="c1">Time</span></p></td></tr><tr><td><p><span class="c0">Filter</span></p></td><td><p><span class="c0">10 min</span></p></td></tr></table>
<p><span class="c0"><script>SECRET_SCRIPT</script>After the visit.</span></p>
</body></html>`;

test("google doc links resolve to the document id", () => {
  assert.equal(googleDocIdFromLink(DOC_URL), DOC_ID);
  assert.equal(
    googleDocIdFromLink(`https://docs.google.com/document/u/0/d/${DOC_ID}/edit`),
    DOC_ID
  );
  assert.equal(
    googleDocIdFromLink(`https://docs.google.com/open?id=${DOC_ID}`),
    DOC_ID
  );
  assert.equal(googleDocIdFromLink("https://example.com/document/d/" + DOC_ID), null);
  assert.equal(
    googleDocIdFromLink(
      "https://docs.google.com/document/d/e/2PACX-1vabcdefghijklmnopqrstuvwxyz/pub"
    ),
    null
  );
  assert.equal(googleDocIdFromLink("javascript:alert(1)"), null);
});

test("google doc html becomes the blog markdown subset", () => {
  const article = googleDocHtmlToArticle(FIXTURE);
  assert.equal(article.title, "How to Service Your HVAC");
  assert.match(article.markdown, /^# How to Service Your HVAC\n/);
  assert.match(article.markdown, /A homeowner guide/);
  assert.match(article.markdown, /\*Resumen\.\*/);
  assert.match(article.markdown, /^# Why it matters$/m);
  assert.match(article.markdown, /^## Filters$/m);
  assert.match(article.markdown, /^### Monthly$/m);
  assert.match(article.markdown, /Keep the cañón \*\*clean\*\* and \*dry\*/);
  assert.match(article.markdown, /\+\+check the filter\+\+/);
  assert.match(article.markdown, /\+\+\*\*\*Do both\.\*\*\*\+\+/);
  assert.match(article.markdown, /\[this guide\]\(https:\/\/example\.com\/guide\)/);
  assert.match(article.markdown, /^- Replace the filter\n {2}- Monthly\n- Clear the drain$/m);
  assert.match(article.markdown, /^1\. Turn off power\n2\. Open the panel$/m);
  assert.match(
    article.markdown,
    /!\[Filter location\]\(https:\/\/lh3\.googleusercontent\.com\/docsz\/abc\)/
  );
  assert.match(article.markdown, /!\[Dot\]\(data:image\/png;base64,iVBORw0KGgo/);
  assert.match(article.markdown, /\| \*\*Step\*\* \| \*\*Time\*\* \|/);
  assert.match(article.markdown, /\| Filter \| 10 min \|/);
  assert.match(article.markdown, /After the visit\./);
  assert.equal(article.markdown.includes("alert"), false);
  assert.equal(article.markdown.includes("SECRET_SCRIPT"), false);
  assert.equal(article.markdown.includes("javascript:"), false);
  assert.equal(article.markdown.includes("evil.example"), false);
  assert.equal(article.markdown.includes("font-weight"), false);
  assert.equal(article.markdown.includes("<script"), false);
  assert.equal(article.markdown.includes("<iframe"), false);
  assert.equal(article.markdown.includes("nope link"), true);

  const html = mdToHtml(article.markdown);
  assert.match(html, /<h1>How to Service Your HVAC<\/h1>/);
  assert.match(html, /<h2>Filters<\/h2>/);
  assert.match(html, /<h3>Monthly<\/h3>/);
  assert.match(html, /<strong>clean<\/strong>/);
  assert.match(html, /<em>dry<\/em>/);
  assert.match(html, /<u>check the filter<\/u>/);
  assert.match(html, /<u><strong><em>Do both\.<\/em><\/strong><\/u>/);
  assert.match(html, /<a href="https:\/\/example.com\/guide">this guide<\/a>/);
  assert.match(
    html,
    /<ul><li>Replace the filter<ul><li>Monthly<\/li><\/ul><\/li><li>Clear the drain<\/li><\/ul>/
  );
  assert.match(html, /<ol><li>Turn off power<\/li><li>Open the panel<\/li><\/ol>/);
  assert.match(html, /<img src="https:\/\/lh3\.googleusercontent\.com\/docsz\/abc" alt="Filter location">/);
  assert.match(html, /<th><strong>Step<\/strong><\/th>/);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("javascript:"), false);
});

test("a private google doc tells the user how to share it", async () => {
  const denied = await importPublicGoogleDoc(DOC_URL, async () => {
    return new Response(null, {
      status: 302,
      headers: { location: "https://accounts.google.com/v3/signin" },
    });
  });
  assert.deepEqual(denied, { ok: false, error: GOOGLE_DOC_SHARE_ERROR });

  const forbidden = await importPublicGoogleDoc(DOC_URL, async () => {
    return new Response("no", { status: 403 });
  });
  assert.deepEqual(forbidden, { ok: false, error: GOOGLE_DOC_SHARE_ERROR });

  const interstitial = await importPublicGoogleDoc(DOC_URL, async () => {
    return new Response("<html><body>You need permission to view this doc</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  assert.deepEqual(interstitial, { ok: false, error: GOOGLE_DOC_SHARE_ERROR });

  const missing = await importPublicGoogleDoc("https://example.com/not-a-doc", async () => {
    throw new Error("should not fetch");
  });
  assert.deepEqual(missing, { ok: false, error: "Paste a Google Doc link." });
});

test("google-hosted images are embedded and other urls are left alone", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const markdown = [
    "![Filter](https://lh3.googleusercontent.com/docsz/abc)",
    "",
    "![Remote](https://cdn.example.com/photo.jpg)",
  ].join("\n");
  const next = await inlineGoogleDocImages(markdown, async (url) => {
    assert.match(String(url), /googleusercontent\.com/);
    return new Response(png, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  assert.match(next, /!\[Filter\]\(data:image\/png;base64,/);
  assert.match(next, /!\[Remote\]\(https:\/\/cdn\.example\.com\/photo\.jpg\)/);
  const html = mdToHtml(next);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.equal(html.includes("<script"), false);
});

test("imported article saves on the blog and shows in the preview", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-google-doc-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const campaigns = await import("../src/lib/campaigns");
    const article = googleDocHtmlToArticle(FIXTURE);
    const created = campaigns.createCampaign({
      title: "HVAC blog",
      htmlContent: "Draft",
      kind: "blog",
      bodyFormat: "markdown",
    });
    const email = campaigns.listEmails(created.id)[0];
    const updated = campaigns.updateEmail(email.id, {
      htmlContent: article.markdown,
      bodyFormat: "markdown",
      versionNote: "Imported from Google Doc",
    });
    assert.ok(updated);
    assert.equal(updated?.body_format, "markdown");
    assert.equal(updated?.kind, "blog");
    const versions = campaigns.listVersions(created.id);
    assert.equal(versions.some((version) => version.note === "Imported from Google Doc"), true);
    const preview = renderAssetDoc({
      kind: updated?.kind,
      html_content: updated?.html_content,
      body_format: updated?.body_format,
    });
    assert.equal(preview.interactive, false);
    assert.match(preview.html, /<h1>How to Service Your HVAC<\/h1>/);
    assert.match(preview.html, /<h2>Filters<\/h2>/);
    assert.match(preview.html, /<strong>clean<\/strong>/);
    assert.match(preview.html, /<u>check the filter<\/u>/);
    assert.match(preview.html, /<a href="https:\/\/example.com\/guide">this guide<\/a>/);
    assert.equal(preview.html.includes("<script"), false);
    assert.equal(preview.html.includes("javascript:"), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
