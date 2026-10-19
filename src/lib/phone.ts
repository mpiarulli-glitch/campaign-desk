/**
 * Phone numbers on a client record are stored as E.164 (`+14155550134`).
 * A bare 10-digit number is treated as US, which is the book we text.
 * Anything we cannot place on that standard is rejected rather than guessed.
 */

export function normalizePhoneE164(input: string): string | null {
  let raw = (input || "").trim();
  if (!raw) return null;
  raw = raw.replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  let normalized = "";
  if (hasPlus) normalized = `+${digits}`;
  else if (digits.length === 10) normalized = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) normalized = `+${digits}`;
  else return null;

  const body = normalized.slice(1);
  if (body.length < 10 || body.length > 15) return null;
  if (normalized.startsWith("+1") && body.length !== 11) return null;
  return normalized;
}
