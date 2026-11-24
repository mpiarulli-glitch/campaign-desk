import { NextResponse } from "next/server";
import { listInviteCandidates } from "@/lib/whiteboard";
import { unauthorized, whiteboardActor } from "../guard";

export async function GET() {
  const slug = await whiteboardActor();
  if (!slug) return unauthorized();
  return NextResponse.json({ people: listInviteCandidates(slug) });
}
