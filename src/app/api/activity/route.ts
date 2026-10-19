import { NextResponse } from "next/server";
import { can, getSession, sessionCampaignKind } from "@/lib/auth";
import { mergeActivityWithFollowups } from "@/lib/approval-followup-nudge";
import { listActivity } from "@/lib/campaigns";
import { OWNER_SLUG } from "@/lib/people";
import { filterInternalReviewFollowups } from "@/lib/review-notifications";
import { wantsInternalReviewNotifications } from "@/lib/users";

function viewerSlug(session: Awaited<ReturnType<typeof getSession>>): string | null {
  if (!session) return null;
  if (session.role === "admin" && !session.person) return OWNER_SLUG;
  return session.person;
}

export async function GET() {
  // Campaigns readers (Carlos, Abel) need the sidebar; it is filtered to the
  // packages they are allowed to open.
  if (!(await can("page.activity")) && !(await can("page.campaigns"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kindScope = await sessionCampaignKind();
  const activity = listActivity(150, undefined, kindScope);
  const slug = viewerSlug(await getSession());
  const includeInternal = wantsInternalReviewNotifications(slug);
  return NextResponse.json({
    activity: filterInternalReviewFollowups(
      mergeActivityWithFollowups(activity, undefined, kindScope, 150),
      includeInternal
    ),
    notifyInternalReviews: includeInternal,
  });
}
