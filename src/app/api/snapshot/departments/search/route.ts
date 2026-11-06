import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import { searchClientBasecampTodos } from "@/lib/snapshot-basecamp-suggest";

export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const q = url.searchParams.get("q") || "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ hits: [], status: "ok" });
  }
  const result = await searchClientBasecampTodos(clientId, q);
  return NextResponse.json({
    hits: result.hits,
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
  });
}
