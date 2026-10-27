import { NextResponse } from "next/server";
import { can, getSession, isCampaignsReadAuthenticated, sessionCampaignKind } from "@/lib/auth";
import { accountManagerViewerSlug } from "@/lib/campaign-review-queue";
import { loadCampaignMonthDesk } from "@/lib/campaign-month-desk-load";
import {
  MONTH_DESK_NEXT_MONTH_RULE,
  MONTH_DESK_THIS_MONTH_RULE,
  type MonthDeskCard,
} from "@/lib/campaign-month-desk";

function summary(card: MonthDeskCard) {
  return {
    key: card.key,
    id: card.id,
    name: card.name,
    logoUrl: card.logoUrl,
    website: card.website,
    target: card.target,
    thisMonth: card.thisMonth,
    nextMonth: card.nextMonth,
  };
}

export async function GET(request: Request) {
  if (!(await isCampaignsReadAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getSession();
  const kindScope = await sessionCampaignKind();
  const desk = loadCampaignMonthDesk(session, kindScope);
  const canSetTarget =
    !accountManagerViewerSlug(session) && (await can("tool.client_edit"));
  const clientKey = new URL(request.url).searchParams.get("client");

  if (clientKey) {
    const client = desk.clients.find((card) => card.key === clientKey);
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      period: desk.period,
      nextPeriod: desk.nextPeriod,
      canSetTarget,
      rules: {
        thisMonth: MONTH_DESK_THIS_MONTH_RULE,
        nextMonth: MONTH_DESK_NEXT_MONTH_RULE,
      },
      client,
    });
  }

  return NextResponse.json({
    period: desk.period,
    nextPeriod: desk.nextPeriod,
    canSetTarget,
    rules: {
      thisMonth: MONTH_DESK_THIS_MONTH_RULE,
      nextMonth: MONTH_DESK_NEXT_MONTH_RULE,
    },
    clients: desk.clients.map(summary),
  });
}
