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
