// Email channel for campaign client approvals. Basecamp remains the workflow
// of record (Deliverables → Needs Approval); this is the parallel inbox ping
// so the contact sees the ask even when they are not watching Basecamp.

import type { RevClient } from "./db";
import {
  accountManagerFor,
  senderFor,
} from "./client-services";
import {
  clientApprovalEmailBodies,
  type ClientApprovalMessageInput,
} from "./client-approval";
import { emailConfigured, sendEmailWithId, type EmailResult } from "./email";
import { SYLVIA_CC_EMAIL } from "./review-cc";

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

export async function sendApprovalEmail(args: {
  client: RevClient;
  to: string;
  messageInput: ClientApprovalMessageInput;
  customMessage?: string;
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
  const { subject, html, text } = clientApprovalEmailBodies({
    input: args.messageInput,
    customText: args.customMessage,
    clientName: args.client.name,
    signer: am?.label || "Marketing Empire Group",
  });

  const res: EmailResult = await sendEmailWithId({
    to,
    subject,
    html,
    text,
    from,
    replyTo,
    cc: SYLVIA_CC_EMAIL,
  });

  if (!res.ok) {
    return {
      ok: false,
      to,
      error: "Could not send the approval email.",
      id: res.id,
    };
  }
  return { ok: true, to, id: res.id };
}
