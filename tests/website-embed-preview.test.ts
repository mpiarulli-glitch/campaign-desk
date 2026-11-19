import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmbedPreviewSwitch,
  WebsiteEmbedPreview,
} from "../src/components/WebsiteEmbedPreview";
import {
  FIXTURE_OPEN_FUNCTION,
  FIXTURE_POPUP_OPEN_DELAY_MS,
  FIXTURE_POPUP_SNIPPET,
  FIXTURE_SEEN_KEY,
  FIXTURE_SNOOZE_KEY,
} from "../src/lib/fixture-popup-snippet";
import {
  DESKTOP_PREVIEW_HEIGHT,
  DESKTOP_PREVIEW_WIDTH,
  MOBILE_PREVIEW_HEIGHT,
  MOBILE_PREVIEW_WIDTH,
  PREVIEW_STORAGE_SHIM_SOURCE,
  WEBSITE_PREVIEW_SANDBOX,
  assetShowsWebsitePreview,
  buildWebsitePreviewSrcDoc,
  findEmbedOpenTrigger,
  previewFitScale,
  previewFrameBox,
} from "../src/lib/website-embed-preview";

const RAW_SNIPPET = `<div id="raw">&amp; keep <b>this</b> "quotes" and 'apos'</div>
<script>window.__raw = "a < b && c > d";</script>`;

test("website preview frames use real desktop and phone viewport sizes", () => {
  assert.deepEqual(previewFrameBox("desktop"), {
    width: DESKTOP_PREVIEW_WIDTH,
    height: DESKTOP_PREVIEW_HEIGHT,
  });
  assert.deepEqual(previewFrameBox("mobile"), {
    width: MOBILE_PREVIEW_WIDTH,
    height: MOBILE_PREVIEW_HEIGHT,
  });
  assert.equal(DESKTOP_PREVIEW_WIDTH, 1280);
  assert.equal(MOBILE_PREVIEW_WIDTH, 390);
  assert.equal(MOBILE_PREVIEW_HEIGHT, 844);
  assert.equal(previewFitScale(640, 1280), 0.5);
  assert.equal(previewFitScale(2000, 1280), 1);
  assert.equal(previewFitScale(0, 1280), 1);
});

test("sandbox allows scripts and forms and does not share the hub origin", () => {
  assert.deepEqual(WEBSITE_PREVIEW_SANDBOX.split(" "), ["allow-scripts", "allow-forms"]);
  assert.equal(WEBSITE_PREVIEW_SANDBOX.includes("allow-same-origin"), false);
  assert.equal(WEBSITE_PREVIEW_SANDBOX.includes("allow-popups"), false);
  assert.equal(WEBSITE_PREVIEW_SANDBOX.includes("allow-top-navigation"), false);
});

test("stored snippet is injected unchanged after the mock page and guards", () => {
  const doc = buildWebsitePreviewSrcDoc(RAW_SNIPPET);
  const snippetAt = doc.indexOf(RAW_SNIPPET);
  assert.ok(snippetAt > 0);
  assert.ok(doc.indexOf("cd-preview-storage") < snippetAt);
  assert.ok(doc.indexOf("cd-preview-guard") < snippetAt);
  assert.ok(doc.indexOf("<!-- cd-mock-website -->") < snippetAt);
  assert.ok(doc.indexOf("<!-- cd-embed-snippet -->") < snippetAt);
  assert.match(doc, /<header class="nl-header">/);
  assert.match(doc, /<nav class="nl-nav"/);
  assert.match(doc, /class="nl-hero"/);
  assert.match(doc, /<footer class="nl-footer"/);
  assert.match(doc, /Northline/);
  assert.match(doc, /name="viewport"/);
  assert.match(doc, /<base target="_self">/);
  assert.doesNotMatch(doc, /allow-same-origin|allow-popups|allow-top-navigation/);
  assert.equal(doc.includes(RAW_SNIPPET), true);
});

test("memory storage shim supports get, set, and clear without a real origin", () => {
  const context: { window: Record<string, unknown> } = { window: {} };
  vm.runInContext(PREVIEW_STORAGE_SHIM_SOURCE, vm.createContext(context));
  const local = context.window.localStorage as Storage;
  const session = context.window.sessionStorage as Storage;
  local.setItem("meg-fixture-quiz-snooze", "1");
  session.setItem("seen", "yes");
  assert.equal(local.getItem("meg-fixture-quiz-snooze"), "1");
  assert.equal(local.length, 1);
  assert.equal(local.key(0), "meg-fixture-quiz-snooze");
  assert.equal(session.getItem("seen"), "yes");
  local.clear();
  session.removeItem("seen");
  assert.equal(local.getItem("meg-fixture-quiz-snooze"), null);
  assert.equal(session.getItem("seen"), null);
});

test("open trigger detects an exposed function, an open method, or a common click", () => {
  assert.deepEqual(findEmbedOpenTrigger(FIXTURE_POPUP_SNIPPET), {
    kind: "call",
    name: FIXTURE_OPEN_FUNCTION,
  });
  assert.deepEqual(
    findEmbedOpenTrigger(`<script>window.QuizPopup = { open: function () {} };</script>`),
    { kind: "method", name: "QuizPopup", method: "open" }
  );
  assert.deepEqual(
    findEmbedOpenTrigger(`<script>function showQuizPopup(){ return 1; }</script>`),
    { kind: "call", name: "showQuizPopup" }
  );
  assert.equal(
    findEmbedOpenTrigger(
      `<script>(function(){ function showQuizPopup(){} })();</script>`
    ),
    null
  );
  assert.deepEqual(
    findEmbedOpenTrigger(`<button type="button" data-open-popup>Open</button>`),
    { kind: "click", selector: "[data-open-popup]" }
  );
  assert.equal(
    findEmbedOpenTrigger(`<form><input name="email"><button>Send</button></form>`),
    null
  );
  assert.equal(
    findEmbedOpenTrigger(`<script>window.open = function(){}; window.formatNotes = function(){};</script>`),
    null
  );
});

test("fixture pop-up has a timer, backdrop, close, snooze, and a two-step quiz", () => {
  assert.match(FIXTURE_POPUP_SNIPPET, new RegExp(String(FIXTURE_POPUP_OPEN_DELAY_MS)));
  assert.match(FIXTURE_POPUP_SNIPPET, /meg-fixture-backdrop/);
  assert.match(FIXTURE_POPUP_SNIPPET, /meg-fixture-close/);
  assert.match(FIXTURE_POPUP_SNIPPET, /meg-fixture-snooze/);
  assert.match(FIXTURE_POPUP_SNIPPET, new RegExp(FIXTURE_SNOOZE_KEY));
  assert.match(FIXTURE_POPUP_SNIPPET, new RegExp(FIXTURE_SEEN_KEY));
  assert.match(FIXTURE_POPUP_SNIPPET, /localStorage/);
  assert.match(FIXTURE_POPUP_SNIPPET, /sessionStorage/);
  assert.match(FIXTURE_POPUP_SNIPPET, /data-step="1"/);
  assert.match(FIXTURE_POPUP_SNIPPET, /data-step="2"/);
  assert.match(FIXTURE_POPUP_SNIPPET, /@media \(max-width: 700px\)/);
  assert.match(FIXTURE_POPUP_SNIPPET, /bottom: 0/);
  assert.match(FIXTURE_POPUP_SNIPPET, /mouseout/);
  assert.match(FIXTURE_POPUP_SNIPPET, /clientY/);
  assert.match(FIXTURE_POPUP_SNIPPET, /scroll/);
  assert.match(FIXTURE_POPUP_SNIPPET, /target="_top"/);
  const doc = buildWebsitePreviewSrcDoc(FIXTURE_POPUP_SNIPPET);
  assert.equal(doc.includes(FIXTURE_POPUP_SNIPPET), true);
});

test("website preview is only offered for HTML form, quiz, or pop-up embeds", () => {
  assert.equal(
    assetShowsWebsitePreview({
      kind: "interactive",
      body_format: "html",
      html_content: FIXTURE_POPUP_SNIPPET,
    }),
    true
  );
  assert.equal(
    assetShowsWebsitePreview({ kind: "email", body_format: "html", html_content: "<p>Hi</p>" }),
    false
  );
  assert.equal(
    assetShowsWebsitePreview({
      kind: "blog",
      body_format: "html",
      html_content: FIXTURE_POPUP_SNIPPET,
    }),
    false
  );
  assert.equal(
    assetShowsWebsitePreview({ kind: "interactive", body_format: "html", html_content: "  " }),
    false
  );
});

test("the mode switch sits next to the inline preview and defaults to inline", () => {
  const inline = renderToStaticMarkup(
    createElement(EmbedPreviewSwitch, {
      enabled: true,
      html: FIXTURE_POPUP_SNIPPET,
      children: createElement("div", { id: "inline-preview" }, "inline preview body"),
    })
  );
  assert.match(inline, /role="tablist"/);
  assert.match(inline, />Inline preview</);
  assert.match(inline, />Preview on a website</);
  assert.match(inline, /id="inline-preview"/);
  assert.equal(inline.includes("<iframe"), false);

  const email = renderToStaticMarkup(
    createElement(EmbedPreviewSwitch, {
      enabled: false,
      html: "<p>Hi</p>",
      children: createElement("div", { id: "email-preview" }, "email"),
    })
  );
  assert.equal(email.includes("Preview on a website"), false);
  assert.match(email, /id="email-preview"/);
});

test("website mode renders a sandboxed frame, replay, open now, and the exit-intent note", () => {
  const html = renderToStaticMarkup(
    createElement(WebsiteEmbedPreview, { html: FIXTURE_POPUP_SNIPPET })
  );
  assert.match(html, /sandbox="allow-scripts allow-forms"/);
  assert.equal(html.includes("allow-same-origin"), false);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /data-preview-viewport-width="1280"/);
  assert.match(html, /data-preview-viewport-height="800"/);
  assert.match(html, />Replay</);
  assert.match(html, />Open now</);
  assert.match(html, /Exit intent fires when the mouse leaves the top of the desktop frame/);
  assert.match(html, /northline\.example/);
  assert.match(html, /megOpenQuiz/);
  assert.ok(html.indexOf("cd-preview-storage") < html.indexOf("megOpenQuiz"));

  const mobile = renderToStaticMarkup(
    createElement(WebsiteEmbedPreview, {
      html: `<form><input name="email"><button type="submit">Send</button></form>`,
      initialDevice: "mobile",
    })
  );
  assert.match(mobile, /data-preview-viewport-width="390"/);
  assert.match(mobile, /data-preview-viewport-height="844"/);
  assert.match(mobile, /data-preview-device="mobile"/);
  assert.equal(mobile.includes(">Open now<"), false);
  assert.match(mobile, />Replay</);

  const switched = renderToStaticMarkup(
    createElement(EmbedPreviewSwitch, {
      enabled: true,
      html: FIXTURE_POPUP_SNIPPET,
      initialMode: "website",
      children: createElement("div", null, "inline"),
    })
  );
  assert.match(switched, /aria-selected="true"/);
  assert.match(switched, /data-preview-mode-tab="website"/);
  assert.match(switched, /<iframe/);
  assert.equal(switched.includes(">inline<"), false);
});
