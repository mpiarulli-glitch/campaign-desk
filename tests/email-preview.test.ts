import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_PREVIEW_WIDTH,
  buildPreviewSrcDoc,
  fitScaleForPreview,
  looksLikeFullDocument,
} from "../src/lib/email-preview";

const FULL_EMAIL = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8" />
  <title>Krak match</title>
  <style type="text/css">
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; }
    }
  </style>
</head>
<body>
  <table class="container" width="600" style="width:600px">
    <tr><td>FIND YOUR KRAK MATCH</td></tr>
  </table>
</body>
</html>`;

test("looksLikeFullDocument", () => {
  assert.equal(looksLikeFullDocument(FULL_EMAIL), true);
  assert.equal(looksLikeFullDocument("<table width='600'><tr><td>Hi</td></tr></table>"), false);
  assert.equal(looksLikeFullDocument("<HTML><BODY>x</BODY></HTML>"), true);
});

test("full documents are not nested inside a second html/body", () => {
  const src = buildPreviewSrcDoc(FULL_EMAIL);

  assert.ok(src.startsWith("<!DOCTYPE html>"));
  assert.equal((src.match(/<html/gi) || []).length, 1);
  assert.match(src, /@media screen and \(max-width: 600px\)/);
  assert.match(src, /xmlns:v="urn:schemas-microsoft-com:vml"/);
  assert.doesNotMatch(src, /img\{max-width:100%/);
  assert.doesNotMatch(src, /background:#f4f6f8/);
  assert.match(src, /name="viewport"/);
  assert.match(src, /<base target="_blank">/);
});

test("full documents that already have viewport and base keep a single copy", () => {
  const withMeta = FULL_EMAIL.replace(
    "<head>",
    `<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="https://cdn.example/">`
  );
  const src = buildPreviewSrcDoc(withMeta);
  assert.equal((src.match(/name="viewport"/g) || []).length, 1);
  assert.equal((src.match(/<base /g) || []).length, 1);
  assert.match(src, /base href="https:\/\/cdn\.example\/"/);
});

test("fragments still get a preview canvas and viewport", () => {
  const src = buildPreviewSrcDoc("<table width='600'><tr><td>Hi</td></tr></table>");
  assert.match(src, /<!DOCTYPE html>/);
  assert.match(src, /name="viewport"/);
  assert.match(src, /<base target="_blank">/);
  assert.match(src, /background:#f4f6f8/);
  assert.match(src, /<table width='600'>/);
});

test("interactive full documents keep their markup and append the height script", () => {
  const src = buildPreviewSrcDoc(FULL_EMAIL, {
    interactive: true,
    heightScript: "<script>window.__cd=1</script>",
  });
  assert.equal((src.match(/<html/gi) || []).length, 1);
  assert.match(src, /window\.__cd=1/);
  assert.match(src, /<\/script><\/body>/);
});

test("fitScaleForPreview fills the phone frame without blowing up tiny leftovers", () => {
  assert.equal(fitScaleForPreview(MOBILE_PREVIEW_WIDTH, MOBILE_PREVIEW_WIDTH), 1);
  assert.equal(fitScaleForPreview(388, MOBILE_PREVIEW_WIDTH), 1);
  assert.equal(fitScaleForPreview(600, MOBILE_PREVIEW_WIDTH), 390 / 600);
  assert.equal(fitScaleForPreview(320, MOBILE_PREVIEW_WIDTH), 390 / 320);
  assert.equal(fitScaleForPreview(50, MOBILE_PREVIEW_WIDTH), 1);
  assert.equal(fitScaleForPreview(0, MOBILE_PREVIEW_WIDTH), 1);
});

test("Krak-style full emails keep their own body canvas, not the fragment grey", () => {
  // Production used to wrap every email in background:#f4f6f8. Cassidy pinned
  // that as a long grey section on Krak Corporate Email 2 mobile.
  const krak = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>x</title></head>
<body style="background-color:#e5f4ef;">
  <table width="600"><tr><td>What’s Your Krak Drink?</td></tr></table>
</body></html>`;
  const src = buildPreviewSrcDoc(krak);
  assert.doesNotMatch(src, /background:#f4f6f8/);
  assert.match(src, /background-color:#e5f4ef/);
  assert.equal((src.match(/<html/gi) || []).length, 1);
});
