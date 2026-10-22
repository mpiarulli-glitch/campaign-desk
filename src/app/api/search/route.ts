import { NextResponse } from "next/server";
import { can, getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { listCampaigns } from "@/lib/campaigns";
import {
  accountManagerViewerSlug,
  campaignVisibleToAccountManager,
} from "@/lib/campaign-review-queue";
import { search } from "@/lib/search";

export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q") || "";
  let hits = (await can("page.social_qa"))
    ? search(q)
    : search(q).filter((hit) => hit.kind !== "social");
  const amSlug = accountManagerViewerSlug(await getSession());
  if (amSlug) {
    const allowed = new Set(
      listCampaigns()
        .filter((campaign) => campaignVisibleToAccountManager(campaign, amSlug))
        .map((campaign) => campaign.id)
    );
    hits = hits.filter((hit) => hit.kind !== "campaign" || allowed.has(hit.id));
  }
  return NextResponse.json({ hits });
}
