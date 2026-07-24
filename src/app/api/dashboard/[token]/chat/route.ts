import { NextResponse } from "next/server";
import { getClientByDashboardToken } from "@/lib/dashboard";
import { listMessages, postMessage } from "@/lib/chat";

// Client-facing chat: the shared thread on their dashboard. The token resolves
// the client, and they may only ever touch their own client:{id} room. Team
// replies come in through /api/chat; both write to the same room.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ messages: listMessages(`client:${client.id}`) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  const authorName = client.contact_name?.trim() || client.name;
  const msg = postMessage({
    room: `client:${client.id}`,
    body: text,
    authorName,
    authorSlug: "",
    isClient: true,
  });
  return NextResponse.json({ message: msg });
}
