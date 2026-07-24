import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import { generateOnboardingTodos, generateRecurringTodos } from "@/lib/strategy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const type = body.type === "recurring" ? "recurring" : "onboarding";
  const force = body.force === true;

  const result =
    type === "recurring"
      ? generateRecurringTodos(id, force)
      : generateOnboardingTodos(id, force);
  return NextResponse.json({ ...result, type });
}
