import { NextResponse } from "next/server";
import { getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { createBoard, listBoards } from "@/lib/whiteboard";
import { teamLabel } from "@/lib/team";

export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ boards: listBoards() });
}

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  const createdBy = session?.person ? teamLabel(session.person) : "Team";
  const board = createBoard({ title, createdBy });
  return NextResponse.json({ board });
}
