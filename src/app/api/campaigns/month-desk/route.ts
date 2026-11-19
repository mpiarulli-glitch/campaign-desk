import { after, NextResponse } from "next/server";
import {
  can,
  getSession,
  isAdminAuthenticated,
  isCampaignsReadAuthenticated,
  sessionCampaignKind,
} from "@/lib/auth";
import { accountManagerViewerSlug } from "@/lib/campaign-review-queue";
import {
  loadArchivedClientDesk,
  loadCampaignMonthDesk,
} from "@/lib/campaign-month-desk-load";
import { scheduleMissingClientLogos } from "@/lib/client-logo-fetch";
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
  const canArchive = await isAdminAuthenticated();
  const canSetTarget =
    !accountManagerViewerSlug(session) && (await can("tool.client_edit"));
  const params = new URL(request.url).searchParams;
  const clientKey = params.get("client");
  const archivedOnly = params.get("archived") === "1";
  if (archivedOnly && !canArchive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const desk = loadCampaignMonthDesk(session, archivedOnly ? null : kindScope, new Date(), {
    archivedOnly,
  });

  if (clientKey) {
    let client = desk.clients.find((card) => card.key === clientKey) || null;
    let archived = archivedOnly;
    if (!client) {
      client = loadArchivedClientDesk(session, clientKey)?.clients[0] || null;
      archived = Boolean(client);
    }
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      period: desk.period,
      nextPeriod: desk.nextPeriod,
      canSetTarget,
      canArchive,
      archived,
      rules: {
        thisMonth: MONTH_DESK_THIS_MONTH_RULE,
        nextMonth: MONTH_DESK_NEXT_MONTH_RULE,
      },
      client,
    });
  }

  if (!archivedOnly) {
    const ids = desk.clients.map((card) => card.id).filter((id): id is string => Boolean(id));
    after(() => scheduleMissingClientLogos(ids));
  }

  return NextResponse.json({
    period: desk.period,
    nextPeriod: desk.nextPeriod,
    canSetTarget,
    canArchive,
    archived: archivedOnly,
    rules: {
      thisMonth: MONTH_DESK_THIS_MONTH_RULE,
      nextMonth: MONTH_DESK_NEXT_MONTH_RULE,
    },
    clients: desk.clients.map(summary),
  });
}
