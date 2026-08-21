// Shared, dependency-free definitions for the different kinds of work that can
// be pushed into a review package: emails, SMS, interactive forms/quizzes, blog
// posts, copy decks, and website mock-ups. Both server code (db, API routes)
// and client components import from here, so this file must stay free of any
// Node-only dependencies (no better-sqlite3, no fs).

export type AssetKind =
  | "email"
  | "sms"
  | "interactive"
  | "blog"
  | "copydeck"
  | "mockup";

// How the stored content should be interpreted when rendering a preview.
//   html     -> content is raw HTML (emails, interactive forms, HTML blogs)
//   markdown -> content is markdown we render to styled HTML (blogs, copy decks)
//   text     -> content is plain text shown as a phone message bubble (SMS)
//   image    -> media_url points at a hosted image export (mock-ups)
//   figma    -> media_url is a Figma link we embed as a live frame (mock-ups)
export type BodyFormat = "html" | "markdown" | "text" | "image" | "figma";

export interface AssetKindMeta {
  kind: AssetKind;
  // Label for buttons/tabs.
  label: string;
  // Lowercase singular noun for inline copy ("Approve this blog post").
  noun: string;
  // The body formats this kind is allowed to use, first one is the default.
  formats: BodyFormat[];
  description: string;
}

export const ASSET_KINDS: AssetKindMeta[] = [
  {
    kind: "email",
    label: "Email",
    noun: "email",
    formats: ["html"],
    description: "A standard HTML email.",
  },
  {
    kind: "sms",
    label: "SMS",
    noun: "text message",
    formats: ["text"],
    description: "A text message, previewed the way it lands on a phone.",
  },
  {
    kind: "interactive",
    label: "Form / quiz",
    noun: "form/quiz",
    formats: ["html"],
    description: "A form or quiz whose scripts run in the preview.",
  },
  {
    kind: "blog",
    label: "Blog post",
    noun: "blog post",
    formats: ["markdown", "html"],
    description: "A long-form article rendered as a styled web page.",
  },
  {
    kind: "copydeck",
    label: "Copy deck",
    noun: "copy deck",
    formats: ["markdown", "html"],
    description: "A copy/messaging document (headlines, body, CTAs).",
  },
  {
    kind: "mockup",
    label: "Website mock-up",
    noun: "mock-up",
    formats: ["image", "figma"],
    description: "A page or section design, as an image export or Figma embed.",
  },
];

const KIND_BY_NAME = new Map(ASSET_KINDS.map((k) => [k.kind, k]));

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && KIND_BY_NAME.has(value as AssetKind);
}

export function isBodyFormat(value: unknown): value is BodyFormat {
  return (
    value === "html" ||
    value === "markdown" ||
    value === "text" ||
    value === "image" ||
    value === "figma"
  );
}

// Coerce arbitrary input to a valid kind, defaulting to "email".
export function coerceKind(value: unknown): AssetKind {
  return isAssetKind(value) ? value : "email";
}

// Pick a valid body format for a kind. Falls back to that kind's default.
export function coerceFormat(kind: AssetKind, value: unknown): BodyFormat {
  const meta = KIND_BY_NAME.get(kind);
  const allowed = meta?.formats ?? ["html"];
  if (isBodyFormat(value) && allowed.includes(value)) return value;
  return allowed[0];
}

export function kindMeta(kind: AssetKind): AssetKindMeta {
  return KIND_BY_NAME.get(kind) ?? ASSET_KINDS[0];
}

export function kindLabel(kind: AssetKind): string {
  return kindMeta(kind).label;
}

export function kindNoun(kind: AssetKind): string {
  return kindMeta(kind).noun;
}

// Title Case name for the kind of work, used to prefix the Basecamp
// Deliverables card title so a client scanning the board sees what the card is
// before they read the campaign name.
const KIND_DELIVERABLE_LABEL: Record<AssetKind, string> = {
  email: "Email Campaign",
  sms: "SMS Campaign",
  interactive: "Form / Quiz",
  blog: "Blog Post",
  copydeck: "Copy Deck",
  mockup: "Website Mock-Up",
};

export function kindDeliverableLabel(kind: AssetKind): string {
  return KIND_DELIVERABLE_LABEL[coerceKind(kind)];
}

/**
 * Basecamp Deliverables card title: "<asset type> - <campaign title>".
 *
 * A package can hold more than one kind of asset. When the kinds disagree the
 * prefix has to describe the package rather than pick a winner, otherwise a
 * mock-up plus a copy deck would go up as an "Email Campaign". An empty package
 * falls back to email, matching coerceKind's default.
 */
export function deliverableCardTitle(
  campaignTitle: string,
  kinds: Array<AssetKind | null | undefined>,
  presentation?: string | null
): string {
  const title = (campaignTitle || "").trim();
  const distinct = Array.from(new Set(kinds.map(coerceKind)));
  const prefix =
    presentation === "automation"
      ? "CRM Automation"
      : distinct.length > 1
        ? "Creative Package"
        : kindDeliverableLabel(distinct[0] ?? "email");
  if (!title) return prefix;
  // Already prefixed (a resend of a card we titled earlier) — leave it alone.
  if (title.toLowerCase().startsWith(`${prefix.toLowerCase()} - `)) return title;
  return `${prefix} - ${title}`;
}

// ---------------------------------------------------------------------------
// Minimal markdown -> HTML string converter.
//
// Mirrors the subset supported by the React <Markdown> component (## / ###
// headings, - and 1. lists, > callouts, **bold**) and adds inline links, so
// blog posts and copy decks authored in markdown render the same everywhere.
// Text is HTML-escaped before any markup is applied. The output is only ever
// shown inside a sandboxed, script-disabled iframe.
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMd(raw: string): string {
  let text = escapeHtml(raw);
  // [label](url) -> anchor (url is escaped above, quotes already handled)
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label, url) => `<a href="${url}">${label}</a>`
  );
  // **bold**
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // *italic* (single asterisk, avoid eating bold which is handled above)
  text = text.replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  return text;
}

export function mdToHtml(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineMd(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it) => `<li>${inlineMd(it)}</li>`).join("");
      out.push(list.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${inlineMd(quote.join(" "))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (line.startsWith("# ")) {
      flushAll();
      out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("### ")) {
      flushAll();
      out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushAll();
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(line.slice(2));
      continue;
    }
    const ordered = /^\d+\.\s+/.test(line);
    const bullet = /^[-*]\s+/.test(line);
    if (ordered || bullet) {
      flushPara();
      flushQuote();
      const item = line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// renderAssetDoc: turn a stored asset into the { html, interactive } pair the
// <EmailPreview> component expects. EmailPreview wraps non-interactive html in
// a gray page canvas, so blog/copydeck/image assets return a *fragment* with
// their own inline <style>. Figma embeds return a full interactive document.
// ---------------------------------------------------------------------------

export interface RenderableAsset {
  kind?: AssetKind | null;
  html_content?: string | null;
  body_format?: BodyFormat | null;
  media_url?: string | null;
}

// Shared typographic styling for markdown-rendered documents (blog + deck).
const DOC_STYLE = `
  .cd-doc{max-width:720px;margin:0 auto;padding:40px 32px;background:#ffffff;
    border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    color:#1a1a2e;line-height:1.7;font-size:17px;}
  .cd-doc h1{font-size:34px;line-height:1.2;margin:0 0 20px;font-weight:700;letter-spacing:-.02em;}
  .cd-doc h2{font-size:25px;line-height:1.3;margin:36px 0 12px;font-weight:700;letter-spacing:-.01em;}
  .cd-doc h3{font-size:20px;line-height:1.35;margin:28px 0 10px;font-weight:600;}
  .cd-doc p{margin:0 0 18px;}
  .cd-doc ul,.cd-doc ol{margin:0 0 18px;padding-left:24px;}
  .cd-doc li{margin:0 0 8px;}
  .cd-doc blockquote{margin:0 0 18px;padding:12px 20px;border-left:4px solid #6c5ce7;
    background:#f5f3ff;color:#3a3a5a;border-radius:0 6px 6px 0;}
  .cd-doc a{color:#6c5ce7;text-decoration:underline;}
  .cd-doc strong{font-weight:700;}
  .cd-doc img{max-width:100%;height:auto;border-radius:6px;}
  .cd-deck{border-top:6px solid #6c5ce7;}
`;

// SMS preview: a single received-message bubble on a phone-ish canvas.
const SMS_STYLE = `
  .sms-phone{max-width:380px;margin:0 auto;padding:26px 20px 22px;background:#ffffff;
    border-radius:22px;box-shadow:0 1px 3px rgba(0,0,0,.08);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
  .sms-bubble{background:#e9e9eb;color:#1a1a2e;padding:11px 15px;border-radius:19px;
    border-bottom-left-radius:5px;font-size:16px;line-height:1.42;
    word-wrap:break-word;overflow-wrap:anywhere;}
  .sms-empty{color:#999;font-size:15px;text-align:center;padding:22px 0;}
  .sms-meta{margin-top:14px;font-size:12px;color:#8a8a94;text-align:right;}
`;

function figmaEmbedUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  if (/figma\.com\/embed/i.test(trimmed)) return trimmed;
  return `https://www.figma.com/embed?embed_host=campaign-desk&url=${encodeURIComponent(
    trimmed
  )}`;
}

export function renderAssetDoc(asset: RenderableAsset): {
  html: string;
  interactive: boolean;
} {
  const kind = coerceKind(asset.kind);
  const format = coerceFormat(kind, asset.body_format);
  const content = asset.html_content || "";
  const media = asset.media_url || "";

  // Website mock-up: live Figma embed.
  if (kind === "mockup" && format === "figma") {
    const src = figmaEmbedUrl(media);
    const caption = content.trim()
      ? `<div style="max-width:900px;margin:0 auto 12px;font:14px -apple-system,Arial,sans-serif;color:#444;">${escapeHtml(
          content.trim()
        )}</div>`
      : "";
    const frame = src
      ? `<iframe src="${src}" style="width:100%;height:680px;border:1px solid #e2e2ea;border-radius:8px;background:#fff;" allowfullscreen></iframe>`
      : `<div style="padding:40px;text-align:center;color:#999;font:15px Arial,sans-serif;">No Figma link provided yet.</div>`;
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:20px;background:#f4f6f8;box-sizing:border-box;}</style></head><body>${caption}${frame}</body></html>`;
    return { html: doc, interactive: true };
  }

  // Website mock-up: static image export.
  if (kind === "mockup" && format === "image") {
    const caption = content.trim()
      ? `<div style="max-width:900px;margin:14px auto 0;font:14px -apple-system,Arial,sans-serif;color:#444;text-align:center;">${escapeHtml(
          content.trim()
        )}</div>`
      : "";
    const img = media
      ? `<img src="${media}" alt="Mock-up" style="display:block;max-width:100%;height:auto;margin:0 auto;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12);">`
      : `<div style="padding:40px;text-align:center;color:#999;font:15px Arial,sans-serif;">No image uploaded yet.</div>`;
    return {
      html: `<div style="max-width:900px;margin:0 auto;">${img}${caption}</div>`,
      interactive: false,
    };
  }

  // SMS: plain text in a phone message bubble. Segment counts matter to whoever
  // is approving it (each one bills), so they are shown alongside the copy.
  if (kind === "sms" && format === "text") {
    const body = content.trim();
    const chars = body.length;
    // GSM-7 single segment is 160 chars, concatenated segments drop to 153.
    const segments = chars === 0 ? 0 : chars <= 160 ? 1 : Math.ceil(chars / 153);
    const bubble = body
      ? `<div class="sms-bubble">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`
      : `<div class="sms-empty">No message written yet.</div>`;
    return {
      html: `<style>${SMS_STYLE}</style><div class="sms-phone">${bubble}<div class="sms-meta">${chars} character${
        chars === 1 ? "" : "s"
      } &middot; ${segments} segment${segments === 1 ? "" : "s"}</div></div>`,
      interactive: false,
    };
  }

  // Blog post or copy deck authored in markdown.
  if ((kind === "blog" || kind === "copydeck") && format === "markdown") {
    const cls = kind === "copydeck" ? "cd-doc cd-deck" : "cd-doc";
    return {
      html: `<style>${DOC_STYLE}</style><div class="${cls}">${mdToHtml(
        content
      )}</div>`,
      interactive: false,
    };
  }

  // Everything else (emails, interactive forms, HTML blogs/decks): raw HTML.
  return { html: content, interactive: kind === "interactive" };
}

// What kind of work a calendar entry represents. Distinct from AssetKind above:
// AssetKind describes an item inside a review package, AssetType describes a
// scheduled piece of work on the campaign calendar. Lives here rather than in
// db.ts so client code and the people roster can import it.
export type AssetType =
  | "social_post"
  | "social_video_carousel"
  | "email_campaign"
  | "crm_automation"
  | "blog_post";

export const ASSET_TYPES: AssetType[] = [
  "social_post",
  "social_video_carousel",
  "email_campaign",
  "crm_automation",
  "blog_post",
];
