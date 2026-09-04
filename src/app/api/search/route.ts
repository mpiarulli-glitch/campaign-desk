import { NextResponse } from "next/server";
import { can, isWorkflowAuthenticated } from "@/lib/auth";
import { search } from "@/lib/search";

export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q") || "";
  const hits = (await can("page.social_qa"))
    ? search(q)
    : search(q).filter((hit) => hit.kind !== "social");
  return NextResponse.json({ hits });
}
