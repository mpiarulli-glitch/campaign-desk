// An address we are willing to hand to Resend.
//
// Basecamp's API masks other people's emails (c@••••••••••••.•••). That string
// is not an inbox. Sending it makes Resend reject the message for non-ASCII
// characters, and the failure panel used to report that as a send error.
// Treat a mask, any other non-ASCII character, or a string that is not a
// basic email as no address at all.

/** The bullet Basecamp uses when it hides someone else's address. */
export const BASECAMP_MASKED_EMAIL_MARK = "•";

/** Shown when a send was skipped because no real address was available. */
export const NO_CONTACT_EMAIL = "No contact email on file";

const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUsableEmail(value: string | null | undefined): boolean {
  const email = (value || "").trim();
  if (!email) return false;
  if (email.includes(BASECAMP_MASKED_EMAIL_MARK)) return false;
  for (let i = 0; i < email.length; i++) {
    if (email.charCodeAt(i) > 127) return false;
  }
  return BASIC_EMAIL.test(email);
}

/** The address when it can be sent to, otherwise "". */
export function usableEmail(value: string | null | undefined): string {
  const email = (value || "").trim();
  return isUsableEmail(email) ? email : "";
}

/**
 * What to store when a form or a Basecamp roster offers a new contact email.
 * Blank clears the field. A real address replaces what is there. A mask or
 * other invalid value never overwrites a real address, and is not stored.
 */
export function nextContactEmail(
  incoming: string | undefined,
  existing: string | null | undefined
): string {
  if (incoming === undefined) return (existing || "").trim();
  const trimmed = incoming.trim();
  if (!trimmed) return "";
  if (isUsableEmail(trimmed)) return trimmed;
  return isUsableEmail(existing) ? (existing || "").trim() : "";
}

/** First candidate that is a real address. Masked and invalid ones are skipped. */
export function firstUsableEmail(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const email = usableEmail(value);
    if (email) return email;
  }
  return "";
}

/**
 * True when a caller handed us something that looked like an address and it
 * was not one. A blank field is not this: nobody tried to use a bad address.
 */
export function sawUnusableEmail(
  ...values: Array<string | null | undefined>
): boolean {
  return values.some((value) => {
    const trimmed = (value || "").trim();
    return Boolean(trimmed) && !isUsableEmail(trimmed);
  });
}

/**
 * Plain sentence for the failure panel, plus the provider body for the
 * collapsed raw detail. The sentence is the provider's own message when it
 * sent one. The raw JSON stays out of the main line.
 */
export function plainProviderEmailError(
  status: number,
  body: string
): { detail: string; raw: string } {
  const rawBody = (body || "").trim();
  let message = "";
  if (rawBody.startsWith("{") || rawBody.startsWith("[")) {
    try {
      const parsed = JSON.parse(rawBody) as {
        message?: unknown;
        error?: unknown;
      };
      if (typeof parsed.message === "string") message = parsed.message.trim();
      else if (typeof parsed.error === "string") message = parsed.error.trim();
    } catch {
      message = "";
    }
  }
  const detail = message
    ? `Resend couldn't send it: ${message}`
    : `Resend couldn't send it (${status}).`;
  return { detail, raw: rawBody && rawBody !== detail ? rawBody : "" };
}
