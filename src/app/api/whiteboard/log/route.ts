import { NextResponse } from "next/server";
import { can } from "@/lib/auth";

// Client-side whiteboard crash reporter. Logs to the server so a blank-screen
// error can be diagnosed from the deploy logs without a user's browser console.
export async function POST(request: Request) {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const where = typeof body.where === "string" ? body.where : "unknown";
  const boardId = typeof body.boardId === "string" ? body.boardId : "?";
  const message = typeof body.message === "string" ? body.message : "";
  console.error(
    `[whiteboard-client-error] board=${boardId} where=${where} :: ${message}`
  );
  return new NextResponse(null, { status: 204 });
}
