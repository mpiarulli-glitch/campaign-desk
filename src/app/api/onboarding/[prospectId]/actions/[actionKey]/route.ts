import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { runProspectAction } from "@/lib/onboarding";

type Params = { params: Promise<{ prospectId: string; actionKey: string }> };

// The card's "checkmarks that do the thing" all land here: create the
// Basecamp project, send the welcome email, add the client to Basecamp,
// notify the team, request the strategy meeting.
export async function POST(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prospectId, actionKey } = await params;
  const result = await runProspectAction(prospectId, actionKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
