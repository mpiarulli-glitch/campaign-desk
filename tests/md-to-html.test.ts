import assert from "node:assert/strict";
import test from "node:test";
import { mdToHtml } from "../src/lib/asset-kinds";

test("mdToHtml renders headings, lists, bold, and links", () => {
  const html = mdToHtml(
    [
      "# Title",
      "",
      "## Section",
      "",
      "### Detail",
      "",
      "A **bold** [link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
    ].join("\n")
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<h3>Detail<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test("mdToHtml renders pipe tables and images", () => {
  const html = mdToHtml(
    [
      "![Trail](https://cdn.example.com/trail.jpg)",
      "",
      "| Combination | Format | Best For |",
      "| --- | :---: | --- |",
      "| Wine tasting | Half-day | All groups |",
      "| Equestrian | Full-day | Active teams |",
    ].join("\n")
  );
  assert.match(
    html,
    /<img src="https:\/\/cdn.example.com\/trail.jpg" alt="Trail">/
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>Combination<\/th>/);
  assert.match(html, /style="text-align:center"/);
  assert.match(html, /<td>Wine tasting<\/td>/);
  assert.match(html, /<td>Active teams<\/td>/);
});

test("mdToHtml escapes HTML and drops unsafe urls", () => {
  const html = mdToHtml(
    'Click [x](javascript:alert(1)) and <script>alert(1)</script> ![bad](javascript:alert(1))'
  );
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.includes("javascript:"), false);
  assert.match(html, /Click x and/);
  assert.match(html, /script&gt;alert\(1\)&lt;\/script&gt; bad/);
});
