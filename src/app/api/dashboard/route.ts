import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { countOpenComments, listCampaigns } from "@/lib/campaigns";
import { listSends } from "@/lib/calendar";
import { computeCycleStatus, nextWindow, todayYmd } from "@/lib/cadence";
import { portfolioSummary, listRevClients } from "@/lib/revenue";
import { listAccounts } from "@/lib/snapshot";

function ymdPlusDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayYmd();

  // ---- Campaigns needing attention -------------------------------------
  const campaigns = listCampaigns(false);
  const weekAgo = daysAgoIso(7);
  let inReview = 0;
  let needsChanges = 0;
  let draft = 0;
  let approvedThisWeek = 0;
  let openComments = 0;
  const attention: Array<{
    id: string;
    title: string;
    client_name: string;
    status: string;
    open_comments: number;
    updated_at: string;
  }> = [];

  for (const c of campaigns) {
    if (c.status === "in_review") inReview++;
    else if (c.status === "needs_changes") needsChanges++;
    else if (c.status === "draft") draft++;
    if (c.status === "approved" && (c.approved_at || "") >= weekAgo) approvedThisWeek++;

    const open = countOpenComments(c.id);
    openComments += open;
    if (c.status === "in_review" || c.status === "needs_changes" || open > 0) {
      attention.push({
        id: c.id,
        title: c.title,
        client_name: c.client_name,
        status: c.status,
        open_comments: open,
        updated_at: c.updated_at,
      });
    }
  }
  attention.sort((a, b) => {
    if (b.open_comments !== a.open_comments) return b.open_comments - a.open_comments;
    return b.updated_at.localeCompare(a.updated_at);
  });

  // ---- Upcoming sends (next 14 days) -----------------------------------
  const sends = listSends(today, ymdPlusDays(today, 14));
  const upcoming = sends.map((s) => ({
    id: s.id,
    title: s.title,
    client_name: s.client_name,
    send_date: s.send_date,
    send_time: s.send_time,
    status: s.status,
    requested_by_client: s.requested_by_client,
  }));
  const clientRequests = upcoming.filter((s) => s.requested_by_client).length;

  // ---- Production windows that are due ---------------------------------
  const revClients = listRevClients();
  const productionDue: Array<{
    id: string;
    name: string;
    window_start: string;
    window_end: string;
  }> = [];
  let productionRequested = 0;
  for (const client of revClients) {
    if (!client.production_enrolled) continue;
    const w = nextWindow(client, today);
    const status = computeCycleStatus(client, w, today);
    if (status === "due" && w) {
      productionDue.push({
        id: client.id,
        name: client.name,
        window_start: w.start,
        window_end: w.end,
      });
    } else if (status === "requested") {
      productionRequested++;
    }
  }
  productionDue.sort((a, b) => a.window_start.localeCompare(b.window_start));

  // ---- Revenue portfolio ------------------------------------------------
  const portfolio = portfolioSummary();

  // ---- Snapshot accounts -----------------------------------------------
  const snapshotAccounts = listAccounts().length;

  return NextResponse.json({
    today,
    campaigns: {
      total: campaigns.length,
      inReview,
      needsChanges,
      draft,
      approvedThisWeek,
      openComments,
      attention: attention.slice(0, 6),
    },
    calendar: {
      upcomingCount: upcoming.length,
      clientRequests,
      next: upcoming.slice(0, 6),
    },
    production: {
      dueCount: productionDue.length,
      requestedCount: productionRequested,
      due: productionDue.slice(0, 6),
    },
    revenue: {
      activeClients: portfolio.clients.length,
      totalRevenue: portfolio.totalRevenue,
      totalAgencyMargin: portfolio.totalAgencyMargin,
      blendedRoi: portfolio.blendedRoi,
    },
    snapshots: { accounts: snapshotAccounts },
  });
}
