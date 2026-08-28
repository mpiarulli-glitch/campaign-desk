import { createHash } from "node:crypto";
import type { Campaign, CampaignEmail } from "./db";
import { SYLVIA_CC_TEXT, stripSylviaCcLines, sylviaCcHtml } from "./review-cc";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(value: string): string {
  const cleaned = (value || "").trim();
  if (!cleaned) return "there";
  return cleaned.split(/\s+/)[0];
}

export interface ClientApprovalMessageInput {
  clientContactName: string;
  campaignTitle: string;
  previewUrl: string;
  isAutomation?: boolean;
}

export function clientApprovalMessageText(
  input: ClientApprovalMessageInput
): string {
  const name = firstName(input.clientContactName);
  const flowNote = input.isAutomation
    ? `\nYou'll see the full automation on a map: what starts it, the wait times, and each email. Click an email to preview it.\n`
    : "";
  return `Hi ${name},

I hope you're doing well. Your ${input.campaignTitle} is ready for review. Please take a look and let us know if everything looks good before we move forward with scheduling.
${flowNote}
Here's what to check:

• Copy: does the messaging reflect your brand and what you want to communicate?
• CTAs: are the calls to action clear? Do the wording and links feel right?
• Links: do all links point to the right pages?
• Imagery: do the visuals match your brand and the message?

Preview Link:

Review the ${input.campaignTitle}: ${input.previewUrl}

One quick note: we accommodate one round of revisions per campaign, so please compile all your feedback before replying. That way we can turn everything around in one pass.

To move forward, just reply with "Approved" or send over your feedback. Let us know if you have any questions.

Looking forward to hearing from you!

${SYLVIA_CC_TEXT}`;
}

export const APPROVAL_MESSAGE_MAX_CHARS = 12_000;

const GREETING_RE = /^Hi\s+([^,\n]+),/;

function linkifyEscaped(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trail = url.match(/[),.;!?]+$/);
    const href = trail ? url.slice(0, -trail[0].length) : url;
    const after = trail ? trail[0] : "";
    return `<a href="${href}">${href}</a>${after}`;
  });
}

// Basecamp rich text has no paragraph margins. A blank line in the editor is a
// bare <br> between blocks; contiguous <p>A</p><p>B</p> renders squished.
const BC_BLANK_LINE = "<br>";

function blocksToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const allBullets =
        lines.length > 0 && lines.every((line) => /^[•\-*]\s+/.test(line));
      if (allBullets) {
        const items = lines
          .map((line) => line.replace(/^[•\-*]\s+/, ""))
          .map((line) => `<li>${linkifyEscaped(escapeHtml(line))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${linkifyEscaped(escapeHtml(block.trim())).replace(/\n/g, "<br>")}</p>`;
    })
    .join(BC_BLANK_LINE);
}

// Turns the editable plaintext (template plus whatever the sender added) into
// Basecamp HTML. The greeting becomes a real mention when we have one, even if
// they rewrote or deleted "Hi Name," — assigning the card does not notify them.
export function clientApprovalMessageHtmlFromText(
  text: string,
  contactMention?: string,
  ccMention?: string
): string {
  const trimmed = stripSylviaCcLines((text || "").replace(/\r\n/g, "\n"));
  if (!trimmed) return sylviaCcHtml(ccMention);

  const match = trimmed.match(GREETING_RE);
  const rest = match ? trimmed.slice(match[0].length).replace(/^\s+/, "") : trimmed;
  const greetingName = contactMention
    ? contactMention
    : escapeHtml((match?.[1] || "there").trim());
  const parts = [
    `<p>Hi ${greetingName},</p>`,
    rest ? blocksToHtml(rest) : "",
    sylviaCcHtml(ccMention),
  ].filter(Boolean);
  return parts.join(BC_BLANK_LINE);
}

export function clientApprovalMessageHtml(
  input: ClientApprovalMessageInput,
  // A real Basecamp mention for the client contact, when they resolve to a
  // person on the project. Assigning somebody to the card does not notify them;
  // only a mention does, so "Hi Dana," in plain text looked like an address and
  // pinged nobody.
  contactMention?: string,
  ccMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.previewUrl);

  const flowNote = input.isAutomation
    ? "<p>You'll see the full automation on a map: what starts it, the wait times, and each email. Click an email to preview it.</p>"
    : "";

  // <hr> already separates major sections. Between sibling paragraphs/lists,
  // insert the same blank-line <br> Basecamp's editor uses — otherwise those
  // blocks sit flush against each other.
  const intro = [
    `<p>Hi ${name},</p>`,
    `<p>I hope you're doing well. Your ${title} is ready for review. Please take a look and let us know if everything looks good before we move forward with scheduling.</p>`,
    flowNote,
  ]
    .filter(Boolean)
    .join(BC_BLANK_LINE);
  const checklist = [
    "<p><strong>Here's what to check:</strong></p>",
    [
      "<ul>",
      "<li><strong>Copy.</strong> Does the messaging reflect your brand and what you want to communicate?</li>",
      "<li><strong>CTAs.</strong> Are the calls to action clear, and do the wording and links feel right?</li>",
      "<li><strong>Links.</strong> Do they all point to the right pages?</li>",
      "<li><strong>Imagery.</strong> Do the visuals match your brand and the message?</li>",
      "</ul>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const preview = [
    "<p><strong>Preview Link:</strong></p>",
    `<p><a href="${url}">Review the ${title}</a></p>`,
  ].join(BC_BLANK_LINE);
  const close = [
    "<p><strong>One quick note:</strong> we accommodate one round of revisions per campaign, so please compile all your feedback before replying. That way we can turn everything around in one pass.</p>",
    '<p>To move forward, just reply with <strong>"Approved"</strong> or send over your feedback. Let us know if you have any questions.</p>',
    "<p>Looking forward to hearing from you!</p>",
    sylviaCcHtml(ccMention),
  ].join(BC_BLANK_LINE);
  return [intro, checklist, preview, close].join("<hr>");
}

export function clientReviewFollowupText(input: ClientApprovalMessageInput): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name},

Just a friendly follow-up — your ${input.campaignTitle} is still waiting on review. When you have a moment, please take a look and reply with "Approved" or your feedback so we can keep things moving.

Review the ${input.campaignTitle}: ${input.previewUrl}`;
}

export function clientApprovalThankYouText(
  input: Pick<ClientApprovalMessageInput, "clientContactName">
): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name}, thank you for approval!`;
}

export function clientApprovalThankYouHtml(
  input: Pick<ClientApprovalMessageInput, "clientContactName">,
  contactMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  return `<p>Hi ${name}, thank you for approval!</p>`;
}

export function clientReviewFollowupHtml(
  input: ClientApprovalMessageInput,
  contactMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.previewUrl);
  return [
    `<p>Hi ${name},</p>`,
    `<p>Just a friendly follow-up — your ${title} is still waiting on review. When you have a moment, please take a look and reply with <strong>"Approved"</strong> or your feedback so we can keep things moving.</p>`,
    `<p><a href="${url}">Review the ${title}</a></p>`,
  ].join(BC_BLANK_LINE);
}

export function campaignApprovalRevisionKey(
  campaign: Pick<Campaign, "title" | "client_id" | "external_token"> & {
    presentation?: string | null;
    trigger_label?: string | null;
    trigger_kind?: string | null;
  },
  emails: Array<
    Pick<CampaignEmail, "id" | "title" | "updated_at"> & {
      delay_ms?: number | null;
    }
  >,
  steps?: Array<{
    id: string;
    parent_id: string | null;
    branch: string;
    sort_order?: number;
    step_type: string;
    delay_ms?: number | null;
    email_id?: string | null;
    condition_kind?: string;
    condition_label?: string;
  }>
): string {
  const source = JSON.stringify({
    title: campaign.title,
    clientId: campaign.client_id,
    externalToken: campaign.external_token,
    presentation: campaign.presentation || "package",
    triggerLabel: campaign.trigger_label || "",
    triggerKind: campaign.trigger_kind || "custom",
    emails: emails.map((email) => ({
      id: email.id,
      title: email.title,
      updatedAt: email.updated_at,
      delayMs: email.delay_ms ?? 0,
    })),
    steps: (steps || []).map((step) => ({
      id: step.id,
      parentId: step.parent_id,
      branch: step.branch,
      sortOrder: step.sort_order ?? 0,
      type: step.step_type,
      delayMs: step.delay_ms ?? 0,
      emailId: step.email_id || null,
      conditionKind: step.condition_kind || "",
      conditionLabel: step.condition_label || "",
    })),
  });
  return createHash("sha256").update(source).digest("hex");
}
