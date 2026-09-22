import { createHash } from "node:crypto";
import {
  clientApproveCta,
  type ClientApprovalChannel,
} from "./asset-kinds";
import type { Campaign, CampaignEmail } from "./db";
import { SYLVIA_CC_TEXT, stripSylviaCcLines, sylviaCcHtml } from "./review-cc";

export {
  approvalChannelForAssets,
  type ClientApprovalChannel,
} from "./asset-kinds";

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
  channel?: ClientApprovalChannel;
  itemCount?: number;
}

export const LINKEDIN_SETUP_CALENDAR_URL =
  "https://api.leadconnectorhq.com/widget/bookings/michael-piarullis-calendar";

function approveButtonLabel(input: ClientApprovalMessageInput): string {
  return clientApproveCta(input.channel ?? "email", input.itemCount ?? 1);
}

function blogNoun(input: ClientApprovalMessageInput): string {
  return (input.itemCount ?? 1) === 1 ? "blog post" : "blog posts";
}

export function clientApprovalMessageText(
  input: ClientApprovalMessageInput
): string {
  if (input.channel === "linkedin") return linkedinApprovalMessageText(input);
  if (input.channel === "blog") return blogApprovalMessageText(input);
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

How to approve in the app:

1. Open the preview link above.
2. Review each ${input.isAutomation ? "email in the automation" : "item in the package"}. Leave comments on anything that needs a change.
3. When everything looks good, type your full name at the top of the page and click "${approveButtonLabel(input)}".

One quick note: we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.

After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly and keep scheduling moving.

Looking forward to hearing from you!

${SYLVIA_CC_TEXT}`;
}

function blogApprovalMessageText(input: ClientApprovalMessageInput): string {
  const name = firstName(input.clientContactName);
  const noun = blogNoun(input);
  const each = (input.itemCount ?? 1) === 1 ? "the blog post" : "each blog post";
  return `Hi ${name},

I hope you're doing well. Your ${input.campaignTitle} ${noun} ${
    (input.itemCount ?? 1) === 1 ? "is" : "are"
  } ready for review. Please take a look and let us know if everything looks good before we publish.

Here's what to check:

• Headline: does the title match the article and what you want people to find?
• Copy: is the messaging on-brand, accurate, and easy to follow?
• Structure: do the headings, lists, and any tables read clearly?
• Links: do they all point to the right pages?
• Imagery: do the photos and graphics match the story and your brand?

Preview Link:

Review the ${input.campaignTitle}: ${input.previewUrl}

How to approve in the app:

1. Open the preview link above.
2. Review ${each}. Leave comments on anything that needs a change.
3. When everything looks good, type your full name at the top of the page and click "${approveButtonLabel(input)}".

One quick note: we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.

After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly and keep publishing moving.

Looking forward to hearing from you!

${SYLVIA_CC_TEXT}`;
}

function linkedinApprovalMessageText(input: ClientApprovalMessageInput): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name},

I hope you're doing well. Your ${input.campaignTitle} LinkedIn outreach is ready for review.

How to read this: the idea behind the campaign, who it's going to, exactly what we'll say to them, and what happens once you approve it. Leave comments on the preview, or reply here with your notes.

Here's what to check:

• Targeting: are we reaching the right people, in the right area, from the right sender?
• Connection request: does the note sound like you, and is it something you'd send?
• Follow-up messages: is the sequence right? Any reply, yes or no, should stop it and become a real conversation.
• Claims: anything we say about pricing, process, or "no cost" — please confirm before we go live.

Preview Link:

Review the ${input.campaignTitle}: ${input.previewUrl}

How to approve in the app:

1. Open the preview link above.
2. Review the idea, the targeting, and each LinkedIn message. Leave comments on anything that needs a change.
3. When everything looks good, type your full name at the top of the page and click "${approveButtonLabel(input)}".

One quick note: we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.

Once you approve, here's what happens:

1. Connect your LinkedIn account. We'll schedule a short call to connect it to Empire Leads, and I'll walk you through setup. Grab a time on my calendar: ${LINKEDIN_SETUP_CALENDAR_URL}
2. Campaign goes live. Once your account is connected, the campaign goes live within two business days.
3. Daily connection limits. Connection requests start slow and build up over several weeks: 5 to 8 a day at first, ramping to 15 to 20 a day, five days a week, once the account is established. That pacing is what keeps LinkedIn from restricting a new campaign.
4. Responses are yours to manage. Once people start replying, those conversations are yours. For the best results, respond within 24 hours of every message.

After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly.

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
  if (input.channel === "linkedin") {
    return linkedinApprovalMessageHtml(input, contactMention, ccMention);
  }
  if (input.channel === "blog") {
    return blogApprovalMessageHtml(input, contactMention, ccMention);
  }
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
  const howTo = [
    "<p><strong>How to approve in the app:</strong></p>",
    [
      "<ol>",
      `<li>Open the preview link above.</li>`,
      `<li>Review each ${
        input.isAutomation ? "email in the automation" : "item in the package"
      }. Leave comments on anything that needs a change.</li>`,
      `<li>When everything looks good, type your full name at the top of the page and click <strong>${escapeHtml(approveButtonLabel(input))}</strong>.</li>`,
      "</ol>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const close = [
    "<p><strong>One quick note:</strong> we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.</p>",
    "<p>After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly and keep scheduling moving.</p>",
    "<p>Looking forward to hearing from you!</p>",
    sylviaCcHtml(ccMention),
  ].join(BC_BLANK_LINE);
  return [intro, checklist, preview, howTo, close].join("<hr>");
}

function blogApprovalMessageHtml(
  input: ClientApprovalMessageInput,
  contactMention?: string,
  ccMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.previewUrl);
  const noun = blogNoun(input);
  const verb = (input.itemCount ?? 1) === 1 ? "is" : "are";
  const each = (input.itemCount ?? 1) === 1 ? "the blog post" : "each blog post";
  const cta = escapeHtml(approveButtonLabel(input));

  const intro = [
    `<p>Hi ${name},</p>`,
    `<p>I hope you're doing well. Your ${title} ${noun} ${verb} ready for review. Please take a look and let us know if everything looks good before we publish.</p>`,
  ].join(BC_BLANK_LINE);
  const checklist = [
    "<p><strong>Here's what to check:</strong></p>",
    [
      "<ul>",
      "<li><strong>Headline.</strong> Does the title match the article and what you want people to find?</li>",
      "<li><strong>Copy.</strong> Is the messaging on-brand, accurate, and easy to follow?</li>",
      "<li><strong>Structure.</strong> Do the headings, lists, and any tables read clearly?</li>",
      "<li><strong>Links.</strong> Do they all point to the right pages?</li>",
      "<li><strong>Imagery.</strong> Do the photos and graphics match the story and your brand?</li>",
      "</ul>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const preview = [
    "<p><strong>Preview Link:</strong></p>",
    `<p><a href="${url}">Review the ${title}</a></p>`,
  ].join(BC_BLANK_LINE);
  const howTo = [
    "<p><strong>How to approve in the app:</strong></p>",
    [
      "<ol>",
      "<li>Open the preview link above.</li>",
      `<li>Review ${each}. Leave comments on anything that needs a change.</li>`,
      `<li>When everything looks good, type your full name at the top of the page and click <strong>${cta}</strong>.</li>`,
      "</ol>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const close = [
    "<p><strong>One quick note:</strong> we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.</p>",
    "<p>After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly and keep publishing moving.</p>",
    "<p>Looking forward to hearing from you!</p>",
    sylviaCcHtml(ccMention),
  ].join(BC_BLANK_LINE);
  return [intro, checklist, preview, howTo, close].join("<hr>");
}

function linkedinApprovalMessageHtml(
  input: ClientApprovalMessageInput,
  contactMention?: string,
  ccMention?: string
): string {
  const name = contactMention || escapeHtml(firstName(input.clientContactName));
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.previewUrl);
  const calendar = escapeHtml(LINKEDIN_SETUP_CALENDAR_URL);

  const intro = [
    `<p>Hi ${name},</p>`,
    `<p>I hope you're doing well. Your ${title} LinkedIn outreach is ready for review.</p>`,
    "<p><strong>How to read this:</strong> the idea behind the campaign, who it's going to, exactly what we'll say to them, and what happens once you approve it. Leave comments on the preview, or reply here with your notes.</p>",
  ].join(BC_BLANK_LINE);
  const checklist = [
    "<p><strong>Here's what to check:</strong></p>",
    [
      "<ul>",
      "<li><strong>Targeting.</strong> Are we reaching the right people, in the right area, from the right sender?</li>",
      "<li><strong>Connection request.</strong> Does the note sound like you, and is it something you'd send?</li>",
      "<li><strong>Follow-up messages.</strong> Is the sequence right? Any reply, yes or no, should stop it and become a real conversation.</li>",
      "<li><strong>Claims.</strong> Anything we say about pricing, process, or &quot;no cost&quot; — please confirm before we go live.</li>",
      "</ul>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const preview = [
    "<p><strong>Preview Link:</strong></p>",
    `<p><a href="${url}">Review the ${title}</a></p>`,
  ].join(BC_BLANK_LINE);
  const howTo = [
    "<p><strong>How to approve in the app:</strong></p>",
    [
      "<ol>",
      "<li>Open the preview link above.</li>",
      "<li>Review the idea, the targeting, and each LinkedIn message. Leave comments on anything that needs a change.</li>",
      `<li>When everything looks good, type your full name at the top of the page and click <strong>${escapeHtml(approveButtonLabel(input))}</strong>.</li>`,
      "</ol>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const after = [
    "<p><strong>One quick note:</strong> we accommodate one round of revisions per campaign, so please compile all your feedback before submitting. That way we can turn everything around in one pass.</p>",
    "<p><strong>Once you approve, here's what happens:</strong></p>",
    [
      "<ol>",
      `<li><strong>Connect your LinkedIn account.</strong> We'll schedule a short call to connect it to Empire Leads, and I'll walk you through setup. <a href="${calendar}">Grab a time on my calendar here.</a></li>`,
      "<li><strong>Campaign goes live.</strong> Once your account is connected, the campaign goes live within two business days.</li>",
      "<li><strong>Daily connection limits.</strong> Connection requests start slow and build up over several weeks: 5 to 8 a day at first, ramping to 15 to 20 a day, five days a week, once the account is established. That pacing is what keeps LinkedIn from restricting a new campaign.</li>",
      "<li><strong>Responses are yours to manage.</strong> Once people start replying, those conversations are yours. For the best results, respond within 24 hours of every message.</li>",
      "</ol>",
    ].join(""),
  ].join(BC_BLANK_LINE);
  const close = [
    "<p>After you approve in the app, please reply on this Basecamp card to let us know it has been approved. That helps us catch it quickly.</p>",
    "<p>Looking forward to hearing from you!</p>",
    sylviaCcHtml(ccMention),
  ].join(BC_BLANK_LINE);
  return [intro, checklist, preview, howTo, after, close].join("<hr>");
}

export function clientReviewFollowupText(input: ClientApprovalMessageInput): string {
  const name = firstName(input.clientContactName);
  const cta = approveButtonLabel(input);
  if (input.channel === "linkedin") {
    return `Hi ${name},

Just a friendly follow-up — your ${input.campaignTitle} LinkedIn outreach is still waiting on review. When you have a moment, please open the preview link, review the idea, the targeting, and the messages, then type your full name and click "${cta}". After you approve in the app, reply on this Basecamp card to let us know.

Review the ${input.campaignTitle}: ${input.previewUrl}`;
  }
  if (input.channel === "blog") {
    return `Hi ${name},

Just a friendly follow-up — your ${input.campaignTitle} ${blogNoun(input)} ${(input.itemCount ?? 1) === 1 ? "is" : "are"} still waiting on review. When you have a moment, please open the preview link, review ${
      (input.itemCount ?? 1) === 1 ? "the post" : "each post"
    }, then type your full name and click "${cta}". After you approve in the app, reply on this Basecamp card to let us know.

Review the ${input.campaignTitle}: ${input.previewUrl}`;
  }
  return `Hi ${name},

Just a friendly follow-up — your ${input.campaignTitle} is still waiting on review. When you have a moment, please open the preview link, review everything, then type your full name and click "${cta}". After you approve in the app, reply on this Basecamp card to let us know.

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
  const cta = escapeHtml(approveButtonLabel(input));
  const body =
    input.channel === "linkedin"
      ? `<p>Just a friendly follow-up — your ${title} LinkedIn outreach is still waiting on review. When you have a moment, please open the preview link, review the idea, the targeting, and the messages, then type your full name and click <strong>${cta}</strong>. After you approve in the app, reply on this Basecamp card to let us know.</p>`
      : input.channel === "blog"
        ? `<p>Just a friendly follow-up — your ${title} ${blogNoun(input)} ${
            (input.itemCount ?? 1) === 1 ? "is" : "are"
          } still waiting on review. When you have a moment, please open the preview link, review ${
            (input.itemCount ?? 1) === 1 ? "the post" : "each post"
          }, then type your full name and click <strong>${cta}</strong>. After you approve in the app, reply on this Basecamp card to let us know.</p>`
        : `<p>Just a friendly follow-up — your ${title} is still waiting on review. When you have a moment, please open the preview link, review everything, then type your full name and click <strong>${cta}</strong>. After you approve in the app, reply on this Basecamp card to let us know.</p>`;
  return [
    `<p>Hi ${name},</p>`,
    body,
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


/* ------------------------------------------------------- email channel */

// Pending-campaign approval email (MEG ops plain template). Basecamp still uses
// the editable checklist; this is the fixed inbox copy.

const APPROVAL_EMAIL_LOGO =
  "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb1921776f532bcab29e.png";

const APPROVAL_EMAIL_PREVIEW =
  "Please review the campaign and approve it or leave your feedback.";

const FOLLOWUP_EMAIL_PREVIEW =
  "Your campaign is ready for your approval before we move forward.";

/** Optional agency mailing address for the email footer (GHL location.full_address). */
function megMailingAddress(): string {
  return (process.env.MEG_MAILING_ADDRESS || "").trim();
}

export function clientApprovalEmailSubject(): string {
  return "Your Campaign Is Waiting For Approval";
}

export function clientReviewFollowupEmailSubject(): string {
  return "Quick Review Needed For Your Campaign";
}

/** Plaintext twin of the pending-campaign approval email. */
export function clientApprovalEmailText(
  input: ClientApprovalMessageInput
): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name},

Your campaign is ready and waiting for your approval.

Please take a few minutes to review it. If everything looks good, approve it on the review page. If you would like any changes, leave your feedback there so our team can update it.

Review Pending Campaign: ${input.previewUrl}

Once it is approved, we can keep your campaign moving toward its scheduled send date.

If you have any questions, just reply to this email and I will help.

Thank you,
The Marketing Empire Group Team`;
}

export function clientReviewFollowupEmailText(
  input: ClientApprovalMessageInput
): string {
  const name = firstName(input.clientContactName);
  return `Hi ${name},

Just a friendly follow-up — your campaign is still ready and waiting for your approval.

Please take a few minutes to review it. If everything looks good, approve it on the review page. If you would like any changes, leave your feedback there so our team can update it.

Review Pending Campaign: ${input.previewUrl}

Once it is approved, we can keep your campaign moving toward its scheduled send date.

If you have any questions, just reply to this email and I will help.

Thank you,
The Marketing Empire Group Team`;
}

function pendingCampaignEmailHtml(args: {
  firstName: string;
  reviewUrl: string;
  subject: string;
  preview: string;
  introHtml: string;
}): string {
  const name = escapeHtml(args.firstName);
  const url = escapeHtml(args.reviewUrl);
  const subject = escapeHtml(args.subject);
  const preview = escapeHtml(args.preview);
  const address = escapeHtml(megMailingAddress());
  const addressBlock = address
    ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#777777;">${address}</p>`
    : "";

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style type="text/css">
    @media screen and (max-width:600px) {
      .main-container { width:100% !important; max-width:100% !important; }
      .content-pad { padding-left:24px !important; padding-right:24px !important; }
      .plain-copy { font-size:17px !important; line-height:1.65 !important; }
      .cta-button { box-sizing:border-box !important; display:block !important; width:100% !important; max-width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">
    ${preview}
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:0;">
        <!--[if (gte mso 9)|(IE)]>
        <table role="presentation" width="620" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>
        <![endif]-->
        <table class="main-container" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:620px;background-color:#ffffff;">
          <tr>
            <td class="content-pad" style="padding:32px 40px 20px;border-bottom:1px solid #eeeeee;">
              <a href="https://www.marketingempiregroup.com" style="text-decoration:none;">
                <img src="${APPROVAL_EMAIL_LOGO}" width="180" border="0" alt="Marketing Empire Group" style="display:block;width:180px;max-width:100%;height:auto;">
              </a>
            </td>
          </tr>
          <tr>
            <td class="content-pad" style="padding:36px 40px;">
              <p class="plain-copy" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Hi ${name},</p>

              ${args.introHtml}

              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="padding:0 0 26px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                      href="${url}" style="height:48px;v-text-anchor:middle;width:222px;" arcsize="8%"
                      strokecolor="#00d4e8" fillcolor="#00d4e8">
                      <w:anchorlock/>
                      <center style="color:#111111;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">Review Pending Campaign</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a class="cta-button" href="${url}" style="background-color:#00d4e8;border-radius:4px;color:#111111;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:222px;-webkit-text-size-adjust:none;">Review Pending Campaign</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <p class="plain-copy" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Once it is approved, we can keep your campaign moving toward its scheduled send date.</p>

              <p class="plain-copy" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">If you have any questions, just reply to this email and I will help.</p>

              <p class="plain-copy" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Thank you,<br>The Marketing Empire Group Team</p>
            </td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:24px 40px 32px;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#777777;">Marketing Empire Group</p>
              ${addressBlock}
            </td>
          </tr>
        </table>
        <!--[if (gte mso 9)|(IE)]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const APPROVAL_INTRO_HTML = `<p class="plain-copy" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Your campaign is ready and waiting for your approval.</p>

              <p class="plain-copy" style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Please take a few minutes to review it. If everything looks good, approve it on the review page. If you would like any changes, leave your feedback there so our team can update it.</p>`;

const FOLLOWUP_INTRO_HTML = `<p class="plain-copy" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Just a friendly follow-up — your campaign is still ready and waiting for your approval.</p>

              <p class="plain-copy" style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#222222;">Please take a few minutes to review it. If everything looks good, approve it on the review page. If you would like any changes, leave your feedback there so our team can update it.</p>`;

export function clientApprovalEmailBodies(args: {
  input: ClientApprovalMessageInput;
  customText?: string;
  clientName: string;
  signer: string;
}): { subject: string; html: string; text: string } {
  const subject = clientApprovalEmailSubject();
  const text = clientApprovalEmailText(args.input);
  const html = pendingCampaignEmailHtml({
    firstName: firstName(args.input.clientContactName),
    reviewUrl: args.input.previewUrl,
    subject,
    preview: APPROVAL_EMAIL_PREVIEW,
    introHtml: APPROVAL_INTRO_HTML,
  });
  return { subject, html, text };
}

export function clientReviewFollowupEmailBodies(args: {
  input: ClientApprovalMessageInput;
  clientName: string;
  signer: string;
}): { subject: string; html: string; text: string } {
  const subject = clientReviewFollowupEmailSubject();
  const text = clientReviewFollowupEmailText(args.input);
  const html = pendingCampaignEmailHtml({
    firstName: firstName(args.input.clientContactName),
    reviewUrl: args.input.previewUrl,
    subject,
    preview: FOLLOWUP_EMAIL_PREVIEW,
    introHtml: FOLLOWUP_INTRO_HTML,
  });
  return { subject, html, text };
}
