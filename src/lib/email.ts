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
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(input: EmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
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
    return false;
  }

  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  if (process.env.EMAIL_REPLY_TO) body.reply_to = process.env.EMAIL_REPLY_TO;
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
      return false;
    }
    // A send that works clears any earlier failure for this address, so the list
    // reflects what is broken now rather than what was ever broken.
    clearFailure("email", input.to);
    return true;
  } catch (err) {
    console.error("[email] Resend send threw:", err);
    recordFailure({
      kind: "email",
      subject: input.to,
      detail: `Could not reach Resend. ${(err as Error).message}`,
      hint: "Usually a network blip. Resend it; if it repeats, check Resend's status.",
    });
    return false;
  }
}
