// Email channel for campaign client approvals. Basecamp remains the workflow
// of record (Deliverables → Needs Approval); this is the parallel inbox ping
// so the contact sees the ask even when they are not watching Basecamp.
// Approval emails CC Michael; Basecamp cards still CC Sylvia.

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

/** Always CC'd on campaign approval emails (inbox ping for Michael). */
export const APPROVAL_EMAIL_CC = "mpiarulli@marketingempiregroup.com";

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
    cc: APPROVAL_EMAIL_CC,
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
  });
}

export async function sendApprovalFollowupEmail(args: {
  client: RevClient;
  to: string;
  messageInput: ClientApprovalMessageInput;
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
  });
}
