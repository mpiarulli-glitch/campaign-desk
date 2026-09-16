import { NextResponse } from "next/server";
import { can, sessionCampaignKind } from "@/lib/auth";
import { mergeActivityWithFollowups } from "@/lib/approval-followup-nudge";
import { listActivity } from "@/lib/campaigns";

export async function GET() {
  // Campaigns readers (Carlos, Abel) need the sidebar; it is filtered to the
  // packages they are allowed to open.
  if (!(await can("page.activity")) && !(await can("page.campaigns"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kindScope = await sessionCampaignKind();
  const activity = listActivity(150, undefined, kindScope);
  return NextResponse.json({
    activity: mergeActivityWithFollowups(activity, undefined, kindScope, 150),
  });
}
