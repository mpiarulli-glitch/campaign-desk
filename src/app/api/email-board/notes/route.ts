import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { createEmailBoardNote } from "@/lib/email-board";
import { personLabel } from "@/lib/people";

function authorName(person: string | null | undefined): string {
  if (!person) return "Michael";
  return personLabel(person);
}

export async function POST(request: Request) {
  if (!(await can("page.email_board"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const result = createEmailBoardNote({
    clientId: typeof body.clientId === "string" ? body.clientId : "",
    x: body.x,
    y: body.y,
    body: body.body,
    color: body.color,
    author: authorName(session?.person),
  });
  return NextResponse.json(result.body, { status: result.status });
}
