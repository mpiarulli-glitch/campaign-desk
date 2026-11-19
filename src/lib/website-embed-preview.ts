// Mock-website preview for pop-up and form/quiz HTML embeds.
//
// The stored snippet is concatenated into the page unchanged, the way a client
// site would paste it before </body>. Reviewers then see the snippet's own
// timers, scroll and exit-intent listeners, and its mobile media queries.
//
// The iframe is sandboxed with allow-scripts and allow-forms only. srcdoc
// inherits the hub origin, so allow-same-origin would let the snippet read the
// hub's cookies and localStorage. Without that flag the frame's origin is
// opaque and the real localStorage getter throws, which would break snooze.
// A memory Storage is installed on the frame before the snippet runs. It is
// not the hub's storage. Reloading the frame drops it.

export const DESKTOP_PREVIEW_WIDTH = 1280;
export const DESKTOP_PREVIEW_HEIGHT = 800;
export const MOBILE_PREVIEW_WIDTH = 390;
export const MOBILE_PREVIEW_HEIGHT = 844;

export const WEBSITE_PREVIEW_SANDBOX = "allow-scripts allow-forms";
export const WEBSITE_PREVIEW_MESSAGE = "cd-website-preview";

export type PreviewDevice = "desktop" | "mobile";

export type EmbedOpenTrigger =
  | { kind: "call"; name: string }
  | { kind: "method"; name: string; method: "open" }
  | { kind: "click"; selector: string };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const OPENER_NAME = /open|show|launch|popup|quiz|modal|sheet/i;
const SKIP_NAMES = new Set([
  "open",
  "alert",
  "confirm",
  "prompt",
  "fetch",
  "setTimeout",
  "setInterval",
  "addEventListener",
  "removeEventListener",
  "postMessage",
  "scroll",
  "scrollTo",
  "focus",
]);

const CLICK_SELECTORS = [
  "[data-open-popup]",
  "[data-popup-open]",
  "[data-quiz-open]",
  ".js-open-popup",
  ".popup-trigger",
] as const;

export function previewFrameBox(device: PreviewDevice): {
  width: number;
  height: number;
} {
  if (device === "mobile") {
    return { width: MOBILE_PREVIEW_WIDTH, height: MOBILE_PREVIEW_HEIGHT };
  }
  return { width: DESKTOP_PREVIEW_WIDTH, height: DESKTOP_PREVIEW_HEIGHT };
}

// Scale the frame to the space we have. The iframe element itself stays at the
// real viewport width, so a CSS transform does not change matchMedia.
export function previewFitScale(containerWidth: number, frameWidth: number): number {
  if (!(containerWidth > 0) || !(frameWidth > 0)) return 1;
  return Math.min(1, containerWidth / frameWidth);
}

export function assetShowsWebsitePreview(asset: {
  kind?: string | null;
  body_format?: string | null;
  html_content?: string | null;
}): boolean {
  if (asset.kind !== "interactive") return false;
  if (asset.body_format && asset.body_format !== "html") return false;
  return Boolean((asset.html_content || "").trim());
}

function nameLooksLikeOpener(name: string): boolean {
  return IDENTIFIER.test(name) && OPENER_NAME.test(name) && !SKIP_NAMES.has(name);
}

function scriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) bodies.push(match[1]);
  return bodies;
}

function preferOpener(names: string[]): string | null {
  const unique = names.filter((name, index) => names.indexOf(name) === index);
  const direct = unique.find((name) => /open|show|launch/i.test(name));
  return direct || unique[0] || null;
}

function topLevelFunctionNames(source: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (!source.startsWith("function", i)) continue;
    if (i > 0 && !/[\s;]/.test(source[i - 1])) continue;
    const match = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(i));
    if (match && nameLooksLikeOpener(match[1])) names.push(match[1]);
  }
  return names;
}

function snippetHasSelector(html: string, selector: string): boolean {
  if (selector.startsWith(".")) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`class\\s*=\\s*["'][^"']*\\b${cls}\\b`, "i").test(html);
  }
  const attr = selector.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${attr}\\b`, "i").test(html);
}

// An open function or a common click trigger the reviewer can fire. Null when
// the snippet has to be watched through its own timer, scroll, or exit intent.
export function findEmbedOpenTrigger(snippet: string): EmbedOpenTrigger | null {
  const scripts = scriptBodies(snippet).join("\n");
  const calls: string[] = [];
  const fnRe =
    /(?:window|self)\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(scripts))) {
    if (nameLooksLikeOpener(match[1])) calls.push(match[1]);
  }
  const aliasRe = /(?:window|self)\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  while ((match = aliasRe.exec(scripts))) {
    if (nameLooksLikeOpener(match[1]) && IDENTIFIER.test(match[2])) calls.push(match[1]);
  }
  const callName = preferOpener(calls);
  if (callName) return { kind: "call", name: callName };

  const methodRe = /(?:window|self)\.([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]{0,800}?)\}/g;
  while ((match = methodRe.exec(scripts))) {
    const name = match[1];
    const body = match[2];
    if (!IDENTIFIER.test(name) || SKIP_NAMES.has(name)) continue;
    if (/\bopen\s*:\s*(?:async\s*)?function\b/.test(body) || /\bopen\s*\([^)]*\)\s*\{/.test(body)) {
      return { kind: "method", name, method: "open" };
    }
  }

  const declared = preferOpener(topLevelFunctionNames(scripts));
  if (declared) return { kind: "call", name: declared };

  for (const selector of CLICK_SELECTORS) {
    if (snippetHasSelector(snippet, selector)) return { kind: "click", selector };
  }
  return null;
}

export const PREVIEW_STORAGE_SHIM_SOURCE = `(function () {
  /* cd-preview-storage */
  function createMemoryStorage() {
    var store = Object.create(null);
    return {
      get length() {
        return Object.keys(store).length;
      },
      key: function (index) {
        var keys = Object.keys(store);
        return index >= 0 && index < keys.length ? keys[index] : null;
      },
      getItem: function (key) {
        var k = String(key);
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (key, value) {
        store[String(key)] = String(value);
      },
      removeItem: function (key) {
        delete store[String(key)];
      },
      clear: function () {
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) delete store[keys[i]];
      }
    };
  }
  function install(name) {
    var memory = createMemoryStorage();
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return memory; }
      });
    } catch (err) {}
  }
  install("localStorage");
  install("sessionStorage");
})();`;

export const PREVIEW_NAV_GUARD_SOURCE = `(function () {
  /* cd-preview-guard */
  function escapesFrame(el) {
    if (!el || !el.getAttribute) return false;
    var target = String(el.getAttribute("target") || "").toLowerCase();
    return target === "_top" || target === "_parent";
  }
  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node && node !== document) {
      if (node.tagName === "A" && escapesFrame(node)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      node = node.parentNode;
    }
  }, true);
  document.addEventListener("submit", function (event) {
    if (escapesFrame(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();`;

function openListenerSource(trigger: EmbedOpenTrigger | null): string {
  return `(function () {
    var trigger = ${JSON.stringify(trigger)};
    var messageType = ${JSON.stringify(WEBSITE_PREVIEW_MESSAGE)};
    function run() {
      if (!trigger) return;
      try {
        if (trigger.kind === "call") {
          var fn = window[trigger.name];
          if (typeof fn === "function") fn();
        } else if (trigger.kind === "method") {
          var obj = window[trigger.name];
          if (obj && typeof obj[trigger.method] === "function") obj[trigger.method]();
        } else if (trigger.kind === "click") {
          var el = document.querySelector(trigger.selector);
          if (el && typeof el.click === "function") el.click();
        }
      } catch (err) {}
    }
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.type !== messageType) return;
      if (data.action === "open") {
        run();
        setTimeout(run, 0);
      }
      if (data.action === "clear-storage") {
        try { localStorage.clear(); } catch (err) {}
        try { sessionStorage.clear(); } catch (err) {}
      }
    });
  })();`;
}

const MOCK_PAGE_STYLE = `
  html, body { margin: 0; padding: 0; background: #f6f3ee; color: #1c1917; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; line-height: 1.55; }
  a { color: inherit; }
  .nl-wrap { max-width: 1080px; margin: 0 auto; padding: 0 28px; }
  .nl-header { background: #fffefb; border-bottom: 1px solid #e7e0d6; position: sticky; top: 0; z-index: 2; }
  .nl-header .nl-wrap { display: flex; align-items: center; justify-content: space-between; min-height: 72px; gap: 24px; }
  .nl-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.03em; font-size: 18px; text-decoration: none; }
  .nl-mark { width: 28px; height: 28px; border-radius: 8px; background: #1c1917; color: #fffefb; display: grid; place-items: center; font-size: 14px; }
  .nl-nav { display: flex; gap: 22px; font-size: 14px; }
  .nl-nav a { text-decoration: none; color: #44403c; }
  .nl-hero { padding: 72px 0 36px; }
  .nl-kicker { margin: 0 0 12px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #78716c; }
  .nl-hero h1 { margin: 0 0 16px; font-family: Georgia, "Iowan Old Style", serif; font-size: 64px; line-height: 1.02; font-weight: 600; letter-spacing: -0.03em; max-width: 14ch; }
  .nl-lede { margin: 0 0 22px; max-width: 46ch; font-size: 18px; color: #44403c; }
  .nl-actions { display: flex; gap: 10px; }
  .nl-btn { display: inline-block; text-decoration: none; border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; }
  .nl-btn.primary { background: #1c1917; color: #fffefb; }
  .nl-btn.ghost { background: transparent; color: #1c1917; border: 1px solid #d6d3d1; }
  .nl-section { padding: 28px 0 10px; }
  .nl-section h2 { font-family: Georgia, "Iowan Old Style", serif; font-size: 32px; margin: 0 0 8px; font-weight: 600; }
  .nl-sub { margin: 0 0 18px; color: #57534e; max-width: 52ch; }
  .nl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .nl-card { background: #fffefb; border: 1px solid #e7e0d6; border-radius: 16px; padding: 18px; }
  .nl-card h3 { margin: 0 0 8px; font-size: 16px; }
  .nl-card p { margin: 0; color: #57534e; font-size: 14px; }
  .nl-story { display: grid; grid-template-columns: 1.4fr 0.8fr; gap: 28px; align-items: start; }
  .nl-story p { margin: 0 0 14px; font-size: 16px; }
  .nl-quote { margin: 0; padding: 18px; background: #1c1917; color: #fffefb; border-radius: 16px; font-family: Georgia, serif; font-size: 22px; line-height: 1.35; }
  .nl-list { list-style: none; margin: 0; padding: 0; }
  .nl-list li { padding: 14px 0; border-top: 1px solid #e7e0d6; display: grid; grid-template-columns: 90px 1fr; gap: 16px; }
  .nl-list span { color: #78716c; font-size: 13px; }
  .nl-footer { margin-top: 36px; background: #1c1917; color: #e7e5e4; padding: 36px 0 48px; }
  .nl-footer .nl-wrap { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 24px; }
  .nl-footer h2 { font-family: Georgia, serif; font-size: 28px; margin: 0 0 8px; color: #fffefb; }
  .nl-footer p, .nl-footer li { color: #d6d3d1; font-size: 14px; }
  .nl-footer ul { margin: 0; padding-left: 18px; }
  .nl-form { display: flex; gap: 8px; margin-top: 12px; }
  .nl-form input { flex: 1; border: 0; border-radius: 8px; padding: 10px 12px; }
  .nl-form button { border: 0; border-radius: 8px; background: #fffefb; color: #1c1917; font-weight: 600; padding: 10px 12px; }
  @media (max-width: 700px) {
    .nl-nav { display: none; }
    .nl-hero { padding-top: 36px; }
    .nl-hero h1 { font-size: 40px; }
    .nl-grid, .nl-story, .nl-footer .nl-wrap { grid-template-columns: 1fr; }
    .nl-list li { grid-template-columns: 1fr; gap: 4px; }
  }
`;

function mockWebsiteMarkup(): string {
  return `<header class="nl-header">
  <div class="nl-wrap">
    <a class="nl-brand" href="#top"><span class="nl-mark">N</span> Northline</a>
    <nav class="nl-nav" aria-label="Primary">
      <a href="#journal">Journal</a>
      <a href="#approach">Approach</a>
      <a href="#notes">Notes</a>
      <a href="#about">About</a>
      <a href="#contact">Contact</a>
    </nav>
  </div>
</header>
<main>
  <section class="nl-hero" id="top">
    <div class="nl-wrap">
      <p class="nl-kicker">Field notes</p>
      <h1>A quieter way to choose what comes next.</h1>
      <p class="nl-lede">Northline is a sample page for previewing embeds. The header, story, and footer are here so a pop-up, form, or quiz can run on a real layout.</p>
      <div class="nl-actions">
        <a class="nl-btn primary" href="#journal">Read the journal</a>
        <a class="nl-btn ghost" href="#approach">Our approach</a>
      </div>
    </div>
  </section>
  <section class="nl-section" id="journal">
    <div class="nl-wrap">
      <h2>From the journal</h2>
      <p class="nl-sub">Three short pieces, long enough that the page scrolls under a timed or scroll-triggered embed.</p>
      <div class="nl-grid">
        <article class="nl-card"><h3>Morning light</h3><p>Start with one room, one window, and the habit of noticing what the day is actually for.</p></article>
        <article class="nl-card"><h3>A short list</h3><p>Write down the next step before the options multiply. Leave the rest for later.</p></article>
        <article class="nl-card"><h3>After the meeting</h3><p>The useful part is rarely the deck. It is the sentence someone repeats on the way out.</p></article>
      </div>
    </div>
  </section>
  <section class="nl-section" id="approach">
    <div class="nl-wrap nl-story">
      <div>
        <h2>How a visit usually goes</h2>
        <p>People arrive with a question that has been open for a while. The first pass is just naming it in plain language, without a program attached.</p>
        <p>Then we look at what is already working. Most of the time the next step is smaller than the list they brought in, and it fits on a single card.</p>
        <p>Nothing here is a client site. It is a neutral page so reviewers can watch an embed open, close, snooze, and move through its own steps.</p>
        <p>Scroll further for the notes. Leaving through the top of the window is the exit-intent path the embed may be listening for.</p>
      </div>
      <blockquote class="nl-quote">Keep the page ordinary. The embed should be the thing that moves.</blockquote>
    </div>
  </section>
  <section class="nl-section" id="notes">
    <div class="nl-wrap">
      <h2>Notes from the desk</h2>
      <ul class="nl-list">
        <li><span>Note 01</span><p>A pop-up that waits a few seconds should still find the page underneath it when it opens.</p></li>
        <li><span>Note 02</span><p>Scroll triggers need a document taller than the window, so this list keeps going.</p></li>
        <li><span>Note 03</span><p>Exit intent listens for the pointer leaving through the top edge, not a click in the page.</p></li>
        <li><span>Note 04</span><p>Snooze belongs to the embed. Reloading the preview starts that memory over.</p></li>
        <li><span>Note 05</span><p>On a narrow window the same embed can sit as a sheet instead of a centered card.</p></li>
        <li><span>Note 06</span><p>A second question stays inside the embed. It should not load a new page.</p></li>
        <li><span>Note 07</span><p>Links that try to take over the parent window stay in the preview.</p></li>
        <li><span>Note 08</span><p>The footer is the end of the sample. The embed is included after it, unchanged.</p></li>
      </ul>
    </div>
  </section>
  <section class="nl-section" id="about">
    <div class="nl-wrap">
      <h2>About this page</h2>
      <p class="nl-sub">Generic copy, a sticky header, and a long scroll. No client brand, no live form endpoint.</p>
    </div>
  </section>
</main>
<footer class="nl-footer" id="contact">
  <div class="nl-wrap">
    <div>
      <h2>Northline</h2>
      <p>A sample website for reviewing an embed. Messages typed here stay in the preview.</p>
    </div>
    <div>
      <p>Visit</p>
      <ul>
        <li>Journal</li>
        <li>Approach</li>
        <li>Notes</li>
      </ul>
    </div>
    <div>
      <p>Notes by email</p>
      <form class="nl-form" action="https://example.com/subscribe" method="post" target="_top">
        <input type="email" name="email" aria-label="Email" placeholder="you@example.com">
        <button type="submit">Send</button>
      </form>
    </div>
  </div>
</footer>`;
}

// The snippet is inserted as raw text. Do not escape it: a client site would
// not, and escaping would turn its script into visible text.
export function buildWebsitePreviewSrcDoc(snippet: string): string {
  const trigger = findEmbedOpenTrigger(snippet);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><base target="_self"><title>Northline</title><style>${MOCK_PAGE_STYLE}</style><script>${PREVIEW_STORAGE_SHIM_SOURCE}</script><script>${PREVIEW_NAV_GUARD_SOURCE}</script><script>${openListenerSource(trigger)}</script></head><body><!-- cd-mock-website -->${mockWebsiteMarkup()}<!-- cd-embed-snippet -->${snippet}</body></html>`;
}
