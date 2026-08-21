import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { markOutreachEvent } from "@/lib/client-services";

// Resend delivery events, so the Client Services dashboard can say whether a
// weekly ask landed and whether it was opened.
//
// Resend signs webhooks with Svix. The signed payload is
// "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256 with the secret's
// base64 body, and the header can carry several space-separated signatures
// during a secret rotation, so every one is checked.
//
// This route is public by necessity, which is exactly why an unverifiable
// request is rejected rather than trusted: without the check anyone could POST
// an "opened" event and make the dashboard lie.

const TOLERANCE_SECONDS = 60 * 5;

function verify(args: {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  body: string;
}): boolean {
  const { secret, id, timestamp, signatureHeader, body } = args;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  for (const part of signatureHeader.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length !== expected.length) continue;
    if (timingSafeEqual(given, expected)) return true;
  }
  return false;
}

// A replayed request is a valid signature over stale content, so the timestamp
// is what actually stops it being reused.
function timestampFresh(timestamp: string): boolean {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(Date.now() / 1000 - sent) <= TOLERANCE_SECONDS;
}

const HANDLED: Record<string, "delivered" | "opened" | "bounced"> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  // A complaint means it reached them and they did not want it. Recording it as
  // a bounce keeps the dashboard honest without a fifth column nobody asked for.
  "email.complained": "bounced",
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not set, refusing");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Unsigned" }, { status: 401 });
  }
  if (!timestampFresh(timestamp)) {
    return NextResponse.json({ error: "Stale timestamp" }, { status: 401 });
  }

  // Read the body as raw text: the signature is over the exact bytes Resend
  // sent, so parsing first and re-serialising would not reproduce them.
  const body = await request.text();
  if (!verify({ secret, id, timestamp, signatureHeader: signature, body })) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: { type?: string; created_at?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const kind = HANDLED[event.type || ""];
  const messageId = event.data?.email_id;
  // Anything else is a real Resend event this app has no use for. Acknowledged
  // so Resend stops retrying it.
  if (!kind || !messageId) {
    return NextResponse.json({ ok: true, ignored: event.type || "unknown" });
  }

  const at = event.created_at || new Date().toISOString();
  const matched = markOutreachEvent(messageId, kind, at);
  return NextResponse.json({ ok: true, event: kind, matched });
}
