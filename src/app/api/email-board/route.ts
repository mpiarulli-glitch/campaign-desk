import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getEmailBoard } from "@/lib/email-board";

// One client's stored email designs, laid out for the board. Read only.
export async function GET(request: Request) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = getEmailBoard(url.searchParams.get("clientId"));
  return NextResponse.json(result.body, { status: result.status });
}
