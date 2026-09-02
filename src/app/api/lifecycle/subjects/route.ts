import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { buildSubjectBank } from "@/lib/subject-bank";

// The subject bank spans every client, so it follows the rest of Lifecycle in
// being admin-only. Read-only: there is no POST here by design.
export async function GET() {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json(buildSubjectBank());
}
