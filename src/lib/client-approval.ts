import { createHash } from "node:crypto";
import type { Campaign, CampaignEmail } from "./db";

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
}

export function clientApprovalMessageText(
  input: ClientApprovalMessageInput
): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name},

I hope you're doing well. Your ${input.campaignTitle} is ready for review. Please take a look and let us know if everything looks good before we move forward with scheduling.

Here's what to check:

• Copy: does the messaging reflect your brand and what you want to communicate?
• CTAs: are the calls to action clear? Do the wording and links feel right?
• Links: do all links point to the right pages?
• Imagery: do the visuals match your brand and the message?

Preview Link:

Review the ${input.campaignTitle}: ${input.previewUrl}

One quick note: we accommodate one round of revisions per campaign, so please compile all your feedback before replying. That way we can turn everything around in one pass.

To move forward, just reply with "Approved" or send over your feedback. Let us know if you have any questions.

Looking forward to hearing from you!`;
}

export function clientApprovalMessageHtml(
  input: ClientApprovalMessageInput,
  // A real Basecamp mention for the client contact, when they resolve to a
  // person on the project. Assigning somebody to the card does not notify them;
  // only a mention does, so "Hi Dana," in plain text looked like an address and
  // pinged nobody.
  contactMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.previewUrl);

  return [
    `<p>Hi ${name},</p>`,
    `<p>I hope you're doing well. Your ${title} is ready for review. Please take a look and let us know if everything looks good before we move forward with scheduling.</p>`,
    "<hr>",
    "<p><strong>Here's what to check:</strong></p>",
    "<ul>",
    "<li><strong>Copy.</strong> Does the messaging reflect your brand and what you want to communicate?</li>",
    "<li><strong>CTAs.</strong> Are the calls to action clear, and do the wording and links feel right?</li>",
    "<li><strong>Links.</strong> Do they all point to the right pages?</li>",
    "<li><strong>Imagery.</strong> Do the visuals match your brand and the message?</li>",
    "</ul>",
    "<hr>",
    "<p><strong>Preview Link:</strong></p>",
    `<p><a href="${url}">Review the ${title}</a></p>`,
    "<hr>",
    "<p><strong>One quick note:</strong> we accommodate one round of revisions per campaign, so please compile all your feedback before replying. That way we can turn everything around in one pass.</p>",
    '<p>To move forward, just reply with <strong>"Approved"</strong> or send over your feedback. Let us know if you have any questions.</p>',
    "<p>Looking forward to hearing from you!</p>",
  ].join("");
}

export function campaignApprovalRevisionKey(
  campaign: Pick<Campaign, "title" | "client_id" | "external_token">,
  emails: Array<Pick<CampaignEmail, "id" | "title" | "updated_at">>
): string {
  const source = JSON.stringify({
    title: campaign.title,
    clientId: campaign.client_id,
    externalToken: campaign.external_token,
    emails: emails.map((email) => ({
      id: email.id,
      title: email.title,
      updatedAt: email.updated_at,
    })),
  });
  return createHash("sha256").update(source).digest("hex");
}
