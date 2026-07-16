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
      "[email] RESEND_API_KEY / EMAIL_FROM not set — skipping send to",
      input.to
    );
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
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Resend send threw:", err);
    return false;
  }
}
