import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { clearEmailBoardLayout, saveEmailBoardLayout } from "@/lib/email-board";

// Saves frame positions for one client. Does not write the campaign.
export async function PUT(request: Request) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const result = saveEmailBoardLayout(clientId, body.positions);
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(request: Request) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = clearEmailBoardLayout(url.searchParams.get("clientId") || "");
  return NextResponse.json(result.body, { status: result.status });
}
