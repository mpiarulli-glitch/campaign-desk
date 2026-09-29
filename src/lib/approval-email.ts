// Email channel for campaign client approvals. Basecamp remains the workflow
// of record (Deliverables → Needs Approval); this is the parallel inbox ping
// so the contact sees the ask even when they are not watching Basecamp.
// Email, automation, and LinkedIn approval emails CC Michael. A blog Carlos
// sends CCs Carlos instead. Basecamp cards still CC Sylvia.

import type { RevClient } from "./db";
import {
  accountManagerFor,
  senderFor,
} from "./client-services";
import {
  clientApprovalEmailBodies,
  clientReviewFollowupEmailBodies,
  type ClientApprovalMessageInput,
} from "./client-approval";
import { emailConfigured, sendEmailWithId, type EmailResult } from "./email";

/** CC'd on email, automation, and LinkedIn approval emails. */
export const APPROVAL_EMAIL_CC = "mpiarulli@marketingempiregroup.com";

/** CC'd when Carlos sends a blog approval from his own login. */
export const CARLOS_BLOG_APPROVAL_CC = "carlos@marketingempiregroup.com";

export function approvalEmailCc(args: {
  senderSlug?: string | null;
  channel?: string | null;
}): string[] {
  if (args.channel === "blog") {
    return args.senderSlug === "carlos" ? [CARLOS_BLOG_APPROVAL_CC] : [];
  }
  return [APPROVAL_EMAIL_CC];
}

export type ApprovalEmailResult = {
  ok: boolean;
  to: string;
  skipped?: string;
  error?: string;
  id?: string | null;
};

export function resolveApprovalEmailTo(args: {
  contactEmail?: string | null;
  rosterEmail?: string | null;
}): string {
  const saved = (args.contactEmail || "").trim();
  if (saved) return saved;
  return (args.rosterEmail || "").trim();
}

async function sendBrandedApprovalEmail(args: {
  client: RevClient;
  to: string;
  bodies: { subject: string; html: string; text: string };
  failLabel: string;
  cc: string[];
}): Promise<ApprovalEmailResult> {
  const to = args.to.trim();
  if (!to) {
    return { ok: false, to: "", skipped: "no contact email" };
  }
  if (!emailConfigured()) {
    return {
      ok: false,
      to,
      skipped: "email not configured",
    };
  }

  const am = accountManagerFor(args.client);
  const { from, replyTo } = senderFor(am);

  const res: EmailResult = await sendEmailWithId({
    to,
    subject: args.bodies.subject,
    html: args.bodies.html,
    text: args.bodies.text,
    from,
    replyTo,
    cc: args.cc,
  });
  if (!res.ok) {
    return {
      ok: false,
      to,
      error: args.failLabel,
      id: res.id,
    };
  }
  return { ok: true, to, id: res.id };
}

export async function sendApprovalEmail(args: {
  client: RevClient;
  to: string;
  messageInput: ClientApprovalMessageInput;
  customMessage?: string;
  senderSlug?: string | null;
}): Promise<ApprovalEmailResult> {
  const am = accountManagerFor(args.client);
  return sendBrandedApprovalEmail({
    client: args.client,
    to: args.to,
    bodies: clientApprovalEmailBodies({
      input: args.messageInput,
      customText: args.customMessage,
      clientName: args.client.name,
      signer: am?.label || "Marketing Empire Group",
    }),
    failLabel: "Could not send the approval email.",
    cc: approvalEmailCc({
      senderSlug: args.senderSlug,
      channel: args.messageInput.channel,
    }),
  });
}

export async function sendApprovalFollowupEmail(args: {
  client: RevClient;
  to: string;
  messageInput: ClientApprovalMessageInput;
  senderSlug?: string | null;
}): Promise<ApprovalEmailResult> {
  const am = accountManagerFor(args.client);
  return sendBrandedApprovalEmail({
    client: args.client,
    to: args.to,
    bodies: clientReviewFollowupEmailBodies({
      input: args.messageInput,
      clientName: args.client.name,
      signer: am?.label || "Marketing Empire Group",
    }),
    failLabel: "Could not send the follow-up email.",
    cc: approvalEmailCc({
      senderSlug: args.senderSlug,
      channel: args.messageInput.channel,
    }),
  });
}
