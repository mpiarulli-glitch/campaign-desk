// Geometry, status buckets, and preview classification for the Email Board.
//
// This file stays free of Node and the database so the canvas can import the
// constants and the tests can classify a design without opening SQLite.
// The designs themselves are whatever Campaign Desk already stored on
// campaign_emails: HTML, markdown, an image URL, or a bare link. Nothing here
// calls Klaviyo, GoHighLevel, or any send API.

import {
  ASSET_KINDS,
  coerceFormat,
  coerceKind,
  renderAssetDoc,
} from "./asset-kinds";
import { operatorStatusValue } from "./campaign-status";

export const EMAIL_FRAME_W = 336;
export const EMAIL_PREVIEW_H = 424;
export const EMAIL_CHROME_H = 112;
export const EMAIL_FRAME_H = EMAIL_CHROME_H + EMAIL_PREVIEW_H;
export const CONDITION_FRAME_W = 210;
export const CONDITION_FRAME_H = 128;
export const COL_GAP = 72;
export const ROW_GAP = 88;
export const COL_PITCH = EMAIL_FRAME_W + COL_GAP;
export const ROW_PITCH = EMAIL_FRAME_H + ROW_GAP;
export const GROUP_LABEL_H = 52;
export const GROUP_GAP = 128;
export const BOARD_ORIGIN = 80;

/** Desktop email width the thumbnail is scaled down from. */
export const EMAIL_DOC_W = 600;

export type EmailBoardBucket = "draft" | "in_review" | "approved" | "sent";

export const EMAIL_BOARD_BUCKETS: { id: EmailBoardBucket | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "in_review", label: "In review" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
];

export function isEmailBoardBucket(value: string): value is EmailBoardBucket {
  return (
    value === "draft" ||
    value === "in_review" ||
    value === "approved" ||
    value === "sent"
  );
}

/**
 * The four filters on the board. Scheduled sits with Approved (it is ready,
 * not out yet). Live sits with Sent. Internal review, client review, and
 * revision rounds are all "In review". The precise status still shows on
 * the frame.
 */
export function emailBoardBucket(
  status: string,
  approvedChannel?: string | null
): EmailBoardBucket {
  const value = operatorStatusValue(status, approvedChannel);
  if (value === "sent" || value === "live") return "sent";
  if (
    value === "approved" ||
    value === "approved_internally" ||
    value === "scheduled"
  ) {
    return "approved";
  }
  if (value === "draft") return "draft";
  return "in_review";
}

export const EMAIL_BOARD_SOURCE = {
  title: "Where these designs come from",
  paragraphs: [
    "Each frame is an email already stored on this client's campaigns. The picture is the HTML saved on that email, a markdown doc rendered for preview, an uploaded image, or a link when a link is all that was stored. The subject line is the one chosen on the email, or the first option saved for it.",
    "A flow is an automation campaign. Its emails run left to right in send order. Waits are folded into the day label, such as Day 0 or Day 3. A yes/no split stays on the same row for yes and drops to the next row for no. A one-off campaign uses each email's scheduled send date, then the order in the package.",
    "Nothing here is loaded from Klaviyo or GoHighLevel, and nothing is sent from this board. A campaign that was only logged as done outside Campaign Desk has no design stored, so the frame is empty. Dragging a frame saves the arrangement for this client and does not change the campaign.",
  ],
};

export type EmailBoardRender =
  | "html"
  | "image"
  | "link"
  | "text"
  | "empty"
  | "condition";

export type EmailBoardFrame = {
  key: string;
  groupId: string;
  groupTitle: string;
  presentation: "package" | "automation";
  render: EmailBoardRender;
  title: string;
  subject: string;
  previewText: string;
  status: string;
  approvedChannel: string | null;
  bucket: EmailBoardBucket;
  kind: string;
  kindLabel: string;
  sendLabel: string;
  laneLabel: string;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  defaultX: number;
  defaultY: number;
  placed: boolean;
  previewHtml: string;
  previewHtmlB: string;
  text: string;
  mediaUrl: string | null;
  linkUrl: string | null;
  plain: string;
  emptyReason: "" | "blank" | "logged_off";
  campaignHref: string;
  reviewHref: string;
  hasVariantB: boolean;
  loggedOff: boolean;
};

export type EmailBoardGroup = {
  id: string;
  title: string;
  presentation: "package" | "automation";
  bucket: EmailBoardBucket;
  status: string;
  approvedChannel: string | null;
  triggerLabel: string;
  frameCount: number;
};

export type EmailBoardNoteColor = "yellow" | "pink" | "blue" | "green";

export const EMAIL_BOARD_NOTE_COLORS: EmailBoardNoteColor[] = [
  "yellow",
  "pink",
  "blue",
  "green",
];

export type EmailBoardNote = {
  id: string;
  body: string;
  color: EmailBoardNoteColor;
  x: number;
  y: number;
  author: string;
  updatedAt: string;
};

export type EmailBoardClient = { id: string; name: string; frames: number };

export type EmailBoardPayload = {
  clients: EmailBoardClient[];
  client: { id: string; name: string } | null;
  missing: boolean;
  groups: EmailBoardGroup[];
  frames: EmailBoardFrame[];
  notes: EmailBoardNote[];
};

export function isNoteColor(value: unknown): value is EmailBoardNoteColor {
  return (
    value === "yellow" ||
    value === "pink" ||
    value === "blue" ||
    value === "green"
  );
}

/** Visible text of stored HTML, for the zoomed-out card and empty detection. */
export function plainTextFromHtml(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The preview is shown in a sandboxed iframe. Strip anything that would run
 * or pull in another page: scripts, inline handlers, and nested frames.
 * Image tags stay, because the design itself is usually hosted images.
 */
export function stripActiveHtml(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.length > 2000) return null;
  return trimmed;
}

export function safeImageUrl(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (/^data:image\/(png|jpeg|jpg|gif|webp);/i.test(trimmed)) {
    return trimmed.length > 2_000_000 ? null : trimmed;
  }
  return safeHttpUrl(trimmed);
}

function looksLikeImageUrl(url: string): boolean {
  return (
    /^data:image\//i.test(url) ||
    /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)
  );
}

function looksLikeFigma(url: string): boolean {
  return /figma\.com/i.test(url);
}

function looksLikeBareUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function isPlaceholderCopy(text: string): boolean {
  const norm = text.toLowerCase();
  if (!norm) return true;
  if (norm.includes("logged off-app")) return true;
  if (norm.includes("no copy in campaign desk")) return true;
  if (norm === "no design stored yet.") return true;
  return false;
}

export type ClassifiedDesign = {
  render: Exclude<EmailBoardRender, "condition">;
  previewHtml: string;
  previewHtmlB: string;
  text: string;
  mediaUrl: string | null;
  linkUrl: string | null;
  plain: string;
  emptyReason: "" | "blank" | "logged_off";
  hasVariantB: boolean;
};

export function classifyEmailDesign(input: {
  kind?: string | null;
  bodyFormat?: string | null;
  html?: string | null;
  htmlB?: string | null;
  mediaUrl?: string | null;
  loggedOff?: boolean;
}): ClassifiedDesign {
  const kind = coerceKind(input.kind);
  const format = coerceFormat(kind, input.bodyFormat);
  const html = input.html || "";
  const htmlB = (input.htmlB || "").trim();
  const media = safeImageUrl(input.mediaUrl) || safeHttpUrl(input.mediaUrl);
  const plain = plainTextFromHtml(html);
  const loggedOff = Boolean(input.loggedOff);
  const emptyBase = {
    previewHtml: "",
    previewHtmlB: "",
    text: "",
    mediaUrl: null,
    hasVariantB: false,
  };

  if (kind === "mockup" && format === "figma") {
    const link = safeHttpUrl(input.mediaUrl);
    return {
      ...emptyBase,
      render: link ? "link" : "empty",
      linkUrl: link,
      plain: plain || (link ? "Figma link" : ""),
      emptyReason: link ? "" : "blank",
    };
  }

  if (kind === "mockup" && format === "image") {
    return {
      ...emptyBase,
      render: media ? "image" : "empty",
      mediaUrl: media,
      plain: plain,
      linkUrl: null,
      emptyReason: media ? "" : "blank",
    };
  }

  if (format === "text" || kind === "sms") {
    const body = html.trim();
    return {
      ...emptyBase,
      render: body ? "text" : "empty",
      text: body,
      plain: body,
      linkUrl: null,
      emptyReason: body ? "" : "blank",
    };
  }

  const bare = plain.trim();
  if (looksLikeBareUrl(bare) && !html.includes("<")) {
    if (looksLikeImageUrl(bare)) {
      const image = safeImageUrl(bare);
      return {
        ...emptyBase,
        render: image ? "image" : "empty",
        mediaUrl: image,
        plain: "",
        linkUrl: null,
        emptyReason: image ? "" : "blank",
      };
    }
    const link = safeHttpUrl(bare);
    return {
      ...emptyBase,
      render: link ? "link" : "empty",
      linkUrl: link,
      plain: looksLikeFigma(bare) ? "Figma link" : "Link",
      emptyReason: link ? "" : "blank",
    };
  }

  if (media && looksLikeFigma(media) && isPlaceholderCopy(plain)) {
    return {
      ...emptyBase,
      render: "link",
      linkUrl: safeHttpUrl(media),
      plain: "Figma link",
      emptyReason: "",
    };
  }

  if (media && looksLikeImageUrl(media) && isPlaceholderCopy(plain)) {
    return {
      ...emptyBase,
      render: "image",
      mediaUrl: media,
      plain: "",
      linkUrl: null,
      emptyReason: "",
    };
  }

  if (isPlaceholderCopy(plain) || html.trim() === "<p></p>") {
    return {
      ...emptyBase,
      render: "empty",
      plain: loggedOff
        ? "Logged outside Campaign Desk. No design is stored."
        : "No design stored yet.",
      emptyReason: loggedOff ? "logged_off" : "blank",
      linkUrl: null,
    };
  }

  const rendered = stripActiveHtml(renderAssetDoc({
    kind,
    body_format: format,
    html_content: html,
    media_url: media,
  }).html);
  const renderedB = htmlB
    ? stripActiveHtml(
        renderAssetDoc({
          kind,
          body_format: format,
          html_content: htmlB,
          media_url: null,
        }).html
      )
    : "";

  return {
    render: "html",
    previewHtml: rendered,
    previewHtmlB: renderedB,
    text: "",
    mediaUrl: null,
    linkUrl: null,
    plain: plain.slice(0, 360),
    emptyReason: "",
    hasVariantB: Boolean(renderedB),
  };
}

export function kindLabelFor(kind: string): string {
  return ASSET_KINDS.find((item) => item.kind === kind)?.label || "Email";
}

export type BoardPlaceItem = {
  key: string;
  kind: "email" | "condition";
  col: number;
  row: number;
};

export type BoardPlacement = { x: number; y: number; w: number; h: number };

/**
 * Default arrangement: each campaign is a band, emails in a row by column,
 * a later row is the "no" branch (or a nested split). Conditions sit in the
 * same column pitch, centered against the email frames.
 */
export function placeOnBoard(
  groups: { id: string; items: BoardPlaceItem[] }[]
): Map<string, BoardPlacement> {
  const out = new Map<string, BoardPlacement>();
  let y = BOARD_ORIGIN;
  for (const group of groups) {
    let maxRow = -1;
    for (const item of group.items) maxRow = Math.max(maxRow, item.row);
    for (const item of group.items) {
      const condition = item.kind === "condition";
      const w = condition ? CONDITION_FRAME_W : EMAIL_FRAME_W;
      const h = condition ? CONDITION_FRAME_H : EMAIL_FRAME_H;
      const x =
        BOARD_ORIGIN +
        item.col * COL_PITCH +
        (condition ? (EMAIL_FRAME_W - CONDITION_FRAME_W) / 2 : 0);
      const top =
        y +
        GROUP_LABEL_H +
        item.row * ROW_PITCH +
        (condition ? (EMAIL_FRAME_H - CONDITION_FRAME_H) / 2 : 0);
      out.set(item.key, { x, y: top, w, h });
    }
    const rows = maxRow + 1;
    const block =
      rows > 0 ? GROUP_LABEL_H + rows * ROW_PITCH - ROW_GAP : GROUP_LABEL_H;
    y += block + GROUP_GAP;
  }
  return out;
}
