import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { deleteEmailBoardNote, updateEmailBoardNote } from "@/lib/email-board";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = updateEmailBoardNote(id, {
    body: "body" in body ? body.body : undefined,
    color: "color" in body ? body.color : undefined,
    x: "x" in body ? body.x : undefined,
    y: "y" in body ? body.y : undefined,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = deleteEmailBoardNote(id);
  return NextResponse.json(result.body, { status: result.status });
}
