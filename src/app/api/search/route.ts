import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { search } from "@/lib/search";

export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q") || "";
  return NextResponse.json({ hits: search(q) });
}
