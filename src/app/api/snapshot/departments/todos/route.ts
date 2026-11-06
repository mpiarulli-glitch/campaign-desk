import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import { listClientSnapshotTodos } from "@/lib/snapshot-basecamp-suggest";

// To-dos for the weekly snapshot add row. The fill page filters them in the
// picker the same way forecast filters a client's to-dos as you type.
export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ todos: [], status: "ok" });
  }
  const result = await listClientSnapshotTodos(clientId);
  return NextResponse.json({
    todos: result.todos,
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
  });
}
