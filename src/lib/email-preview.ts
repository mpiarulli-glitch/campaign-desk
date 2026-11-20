// How the in-app Desktop/Mobile preview turns stored campaign HTML into an
// iframe document, and how a phone-width frame is fitted around that document.
//
// Campaign HTML is a full email document more often than not: doctype, <head>
// with the mobile media queries, Outlook conditionals. Wrapping that in another
// <html><body> makes the parser drop or orphan the inner <head>, so @media
// rules never fire, and the wrapper's `img { max-width: 100% }` fights spacer
// GIFs and fixed-width tables. Interactive previews already passed full
// documents through; the static email preview has to do the same or the Mobile
// toggle is just a 390px crop of the desktop layout (white gutter, clipped
// hero, "FIND" jammed against the left edge).

export const MOBILE_PREVIEW_WIDTH = 390;

// Desktop landing pages are laid out at a laptop width, then CSS-scaled down
// to the preview column. 1440 is a common laptop viewport (1366–1440).
export const LAPTOP_PREVIEW_WIDTH = 1440;

// Visible height of a cross-origin page we cannot measure. The iframe scrolls
// internally, the way a browser window does.
export const LAPTOP_VIEWPORT_HEIGHT = 900;

const LANDING_KIND = /^(landing(?:[_-]page)?|webpage|web[_-]page|web)$/i;
const LANDING_TITLE = /\blanding[\s-]+pages?\b/i;
const HTTP_URL = /^https?:\/\/\S+$/i;
const MESSAGE_KINDS = new Set(["email", "cold_email", "linkedin", "sms"]);

export type LandingPageSignal = {
  kind?: string | null;
  title?: string | null;
  html_content?: string | null;
  media_url?: string | null;
  body_format?: string | null;
};

function isRasterUrl(value: string): boolean {
  return (
    /^data:image\//i.test(value) ||
    /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(value)
  );
}

// A stored page address: the HTML body is only a URL, or a non-message asset
// points at a hosted page (not an image export and not a Figma file).
export function landingPreviewUrl(asset: LandingPageSignal): string | null {
  const html = (asset.html_content || "").trim();
  if (HTTP_URL.test(html)) return html;

  const media = (asset.media_url || "").trim();
  if (!HTTP_URL.test(media) || isRasterUrl(media) || /figma\.com/i.test(media)) {
    return null;
  }
  const kind = (asset.kind || "").trim().toLowerCase();
  if (
    MESSAGE_KINDS.has(kind) ||
    kind === "blog" ||
    kind === "copydeck" ||
    kind === "interactive"
  ) {
    return null;
  }
  return media;
}

// Landing pages use the laptop frame. Emails stay on the 600px column.
// Prefer an explicit kind when one is stored; otherwise a title that says
// "landing page", or a URL / web asset.
export function isLandingPageAsset(asset: LandingPageSignal): boolean {
  const kind = (asset.kind || "").trim();
  if (LANDING_KIND.test(kind)) return true;
  if (LANDING_TITLE.test(asset.title || "")) return true;
  if (landingPreviewUrl(asset)) return true;
  return false;
}

// Scale a 1440px layout down to the preview column. Never scale up.
// One pixel of slack so a rounded device pixel cannot open a second scrollbar.
export function laptopScaleForWidth(
  frameWidth: number,
  laptopWidth = LAPTOP_PREVIEW_WIDTH
): number {
  if (!(frameWidth > 0) || !(laptopWidth > 0)) return 1;
  if (frameWidth + 1 >= laptopWidth) return 1;
  return (frameWidth - 1) / laptopWidth;
}

const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width,initial-scale=1">';
const BASE_TARGET = '<base target="_blank">';

export function looksLikeFullDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) || /<!doctype/i.test(html);
}

function hasViewportMeta(html: string): boolean {
  return /<meta\b[^>]*\bname\s*=\s*["']?viewport["']?/i.test(html);
}

function hasBaseTag(html: string): boolean {
  return /<base\b/i.test(html);
}

function injectAfterHeadOpen(html: string, snippet: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index != null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag && htmlTag.index != null) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${snippet}</head>` + html.slice(at);
  }
  return `<head>${snippet}</head>${html}`;
}

export function prepareFullDocument(
  html: string,
  extras: { heightScript?: string } = {}
): string {
  let doc = html;
  if (!hasViewportMeta(doc)) {
    doc = injectAfterHeadOpen(doc, VIEWPORT_META);
  }
  if (!hasBaseTag(doc)) {
    doc = injectAfterHeadOpen(doc, BASE_TARGET);
  }
  const script = extras.heightScript;
  if (script) {
    doc = /<\/body>/i.test(doc)
      ? doc.replace(/<\/body>/i, `${script}</body>`)
      : doc + script;
  }
  return doc;
}

export function wrapFragment(
  html: string,
  opts: { interactive?: boolean; heightScript?: string } = {}
): string {
  const interactive = !!opts.interactive;
  const style = interactive
    ? "html,body{margin:0;padding:0;background:#ffffff;} img{max-width:100%;height:auto;}"
    : "html,body{margin:0;padding:0;background:#f4f6f8;} body{padding:16px 0;} img{max-width:100%;height:auto;}";
  const body = interactive && opts.heightScript ? `${html}${opts.heightScript}` : html;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT_META}${BASE_TARGET}<style>${style}</style></head><body>${body}</body></html>`;
}

export function buildPreviewSrcDoc(
  html: string,
  opts: { interactive?: boolean; heightScript?: string } = {}
): string {
  if (looksLikeFullDocument(html)) {
    return prepareFullDocument(html, {
      heightScript: opts.interactive ? opts.heightScript : undefined,
    });
  }
  return wrapFragment(html, opts);
}

// Scale the laid-out email so it fills the phone frame. Gmail (and Apple Mail)
// fit-to-width on a real phone; a 600px table in a 390px iframe otherwise
// either clips or sits left-aligned with a white gutter.
export function fitScaleForPreview(
  contentWidth: number,
  frameWidth: number
): number {
  if (!(contentWidth > 0) || !(frameWidth > 0)) return 1;
  const ratio = frameWidth / contentWidth;
  if (Math.abs(ratio - 1) < 0.02) return 1;
  // A tracking pixel or lone logo is not the email. Don't blow it up.
  if (ratio > 1 && contentWidth < frameWidth * 0.55) return 1;
  return ratio;
}

// Widest in-flow block in the email. Body itself is usually the iframe
// viewport, so it is skipped — otherwise a 320px table on a 390px white body
// would look "full width" and the gutter would stay.
export function measureEmailContentWidth(doc: Document): number {
  const body = doc.body;
  if (!body) return 0;
  const skip = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "NOSCRIPT"]);
  let max = 0;
  for (const child of Array.from(body.children)) {
    // Don't use `instanceof HTMLElement` — iframe documents have a different
    // realm, so parent-realm instanceof is false for every node.
    if (child.nodeType !== 1) continue;
    if (skip.has(child.tagName)) continue;
    const w = (child as HTMLElement).offsetWidth;
    if (w > max) max = w;
  }
  return max;
}

// Content height for the preview iframe. `html.offsetHeight` tracks the iframe
// viewport, so once the frame is too tall a remasure can never shrink — that
// leaves a long empty strip of the email's body background under the card
// (the grey Cassidy saw on Krak Corporate Email 2 mobile). Collapse the frame
// to 1px, shrink-wrap the root, then restore.
export function measurePreviewDocumentHeight(
  doc: Document,
  iframe?: HTMLIFrameElement | null
): number {
  const body = doc.body;
  const htmlEl = doc.documentElement;
  if (!body || !htmlEl) return 1;

  const prevIframeHeight = iframe ? iframe.style.height : null;
  if (iframe) iframe.style.height = "1px";

  const prevHtmlHeight = htmlEl.style.height;
  const prevBodyHeight = body.style.height;
  htmlEl.style.height = "auto";
  body.style.height = "auto";

  const measured = Math.max(body.scrollHeight || 0, htmlEl.scrollHeight || 0);

  htmlEl.style.height = prevHtmlHeight;
  body.style.height = prevBodyHeight;
  if (iframe && prevIframeHeight != null) {
    iframe.style.height = prevIframeHeight;
  }

  return Math.max(measured, 1);
}
