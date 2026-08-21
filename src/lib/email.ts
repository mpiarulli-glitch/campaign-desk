// Transactional email via Resend (https://resend.com).
//
// Sends over the Resend REST API with plain fetch, so there's no SDK
// dependency. Configure with env vars:
//   RESEND_API_KEY   API key from the Resend dashboard
//   EMAIL_FROM       verified sender, e.g. "Marketing Empire <hello@yourdomain.com>"
//   EMAIL_REPLY_TO   optional reply-to address
//
// Like the Campfire notifier, this never throws into a request: if the key is
// missing or Resend is unreachable it logs and returns false so the caller can
// decide what to do.

import { clearFailure, recordFailure } from "./failures";

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Overrides EMAIL_FROM. Resend only accepts a sender on a verified domain,
   * so this is for changing the display name and local part on that domain
   * ("Cassidy (Marketing Empire Group) <hello@…>"), not for sending as an
   * arbitrary address.
   */
  from?: string;
  /** Overrides EMAIL_REPLY_TO. Used to point replies at the account manager. */
  replyTo?: string;
}

export interface EmailResult {
  ok: boolean;
  /** Resend's id for the send. Null unless the send succeeded. */
  id: string | null;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Boolean-returning send. This is what almost every caller wants and it is kept
 * as the default so the ~dozen existing call sites did not have to change.
 */
export async function sendEmail(input: EmailInput): Promise<boolean> {
  return (await sendEmailWithId(input)).ok;
}

/**
 * Send and hand back Resend's message id.
 *
 * The id is the only thing that ties a delivery or open webhook back to the
 * row that sent it, so anything that wants to show a status later has to use
 * this variant rather than sendEmail.
 */
export async function sendEmailWithId(input: EmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = input.from?.trim() || process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(
      "[email] RESEND_API_KEY / EMAIL_FROM not set, skipping send to",
      input.to
    );
    recordFailure({
      kind: "email",
      subject: input.to,
      detail: "RESEND_API_KEY or EMAIL_FROM is not set, so nothing was sent.",
      hint: "Set both on the service, then resend.",
    });
    return { ok: false, id: null };
  }

  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  const replyTo = input.replyTo?.trim() || process.env.EMAIL_REPLY_TO;
  if (replyTo) body.reply_to = replyTo;
  // Optional CC on every send (comma-separate for multiple addresses).
  if (process.env.EMAIL_CC) {
    const cc = process.env.EMAIL_CC.split(",").map((s) => s.trim()).filter(Boolean);
    if (cc.length) body.cc = cc;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[email] Resend send failed: ${res.status} ${detail.slice(0, 300)}`
      );
      recordFailure({
        kind: "email",
        subject: input.to,
        detail: `Resend refused it (${res.status}). ${detail.slice(0, 200)}`,
        hint:
          res.status === 403 || res.status === 401
            ? "Check the Resend key and that the sending domain is still verified."
            : "Check the address is valid, then resend.",
      });
      return { ok: false, id: null };
    }
    // A send that works clears any earlier failure for this address, so the list
    // reflects what is broken now rather than what was ever broken.
    clearFailure("email", input.to);
    const payload = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: payload?.id || null };
  } catch (err) {
    console.error("[email] Resend send threw:", err);
    recordFailure({
      kind: "email",
      subject: input.to,
      detail: `Could not reach Resend. ${(err as Error).message}`,
      hint: "Usually a network blip. Resend it; if it repeats, check Resend's status.",
    });
    return { ok: false, id: null };
  }
}
