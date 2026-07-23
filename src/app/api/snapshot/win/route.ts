import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { addWin, getAccount } from "@/lib/snapshot";

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!clientId || !getAccount(clientId)) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!text) {
    return NextResponse.json({ error: "Win text is required" }, { status: 400 });
  }
  const win = addWin({
    clientId,
    body: text,
    happenedOn: typeof body.happenedOn === "string" ? body.happenedOn : "",
  });
  return NextResponse.json({ win }, { status: 201 });
}
