// Transactional email via Resend (https://resend.com).
//
// Sends over the Resend REST API with plain fetch, so there's no SDK
// dependency. Configure with env vars:
//   RESEND_API_KEY   API key from the Resend dashboard
//   EMAIL_FROM       verified sender, e.g. "Marketing Empire Group <hello@yourdomain.com>"
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
   * Optional mailbox override. The display name is always Marketing Empire
   * Group; only the address is taken from here or from EMAIL_FROM. Resend
   * still requires that address to be on a verified domain.
   */
  from?: string;
  /** Overrides EMAIL_REPLY_TO. Used to point replies at the account manager. */
  replyTo?: string;
  /**
   * Extra CC addresses for this send. Merged with EMAIL_CC when that env is
   * set; duplicates (including the To address) are dropped.
   */
  cc?: string | string[];
}

export interface EmailResult {
  ok: boolean;
  /** Resend's id for the send. Null unless the send succeeded. */
  id: string | null;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Display name on every message this app sends. */
export const AGENCY_FROM_NAME = "Marketing Empire Group";

/** Mailbox inside "Name <addr>" or a bare address. */
export function emailAddressFrom(from: string): string {
  const trimmed = (from || "").trim();
  const angled = trimmed.match(/<([^>]+)>/);
  if (angled) return angled[1].trim();
  return trimmed;
}

/**
 * Force the From display name to Marketing Empire Group.
 * The verified mailbox is left as given.
 */
export function agencyFrom(from: string): string {
  const address = emailAddressFrom(from);
  if (!address) return (from || "").trim();
  return `${AGENCY_FROM_NAME} <${address}>`;
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
  const rawFrom = input.from?.trim() || process.env.EMAIL_FROM || "";
  const from = rawFrom ? agencyFrom(rawFrom) : "";
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
  // Optional CC: per-send addresses plus EMAIL_CC (comma-separated).
  const ccSet = new Set<string>();
  const addCc = (raw: string) => {
    const addr = raw.trim().toLowerCase();
    if (!addr) return;
    if (addr === input.to.trim().toLowerCase()) return;
    ccSet.add(raw.trim());
  };
  if (typeof input.cc === "string") addCc(input.cc);
  else if (Array.isArray(input.cc)) for (const c of input.cc) addCc(c);
  if (process.env.EMAIL_CC) {
    for (const c of process.env.EMAIL_CC.split(",")) addCc(c);
  }
  if (ccSet.size) body.cc = [...ccSet];

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
