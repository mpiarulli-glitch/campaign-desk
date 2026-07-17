import { NextResponse } from "next/server";
import { getClientByCalendarToken, planSends, upsertFeedback } from "@/lib/plan";

type Params = { params: Promise<{ token: string }> };

// Public: the client leaves (or clears) a note on a single planned send.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByCalendarToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const sendId = typeof body.sendId === "string" ? body.sendId : "";
  const note = typeof body.body === "string" ? body.body : "";
  if (!sendId) {
    return NextResponse.json({ error: "sendId required" }, { status: 400 });
  }
  // Only allow notes on sends that actually belong to this client.
  const owned = planSends(client.id, "0000-00-00", "9999-99-99").some(
    (s) => s.id === sendId
  );
  if (!owned) {
    return NextResponse.json({ error: "Unknown send" }, { status: 404 });
  }
  const feedback = upsertFeedback(sendId, client.id, note);
  return NextResponse.json({ ok: true, feedback });
}
