import { NextResponse } from "next/server";
import {
  deliverableOverview,
  getAccountByToken,
  listLeads,
  listWins,
  metricsSeries,
  revenueAsk,
  snapshotLaunchDateFor,
  weekBounds,
  weekData,
  weeksWithLeads,
} from "@/lib/snapshot";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ token: string }> };

// Public, read-only. No admin auth — the token IS the access grant.
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params_ = new URL(request.url).searchParams;
  const week = params_.get("week") || "";
  if (!WEEK_RE.test(week)) {
    return NextResponse.json({ error: "week (YYYY-MM-DD) required" }, { status: 400 });
  }
  // Not team-scoped: the client is shown their whole account, not one team's slice.
  const rows = weekData(account.id, week);
  // Leads default to the week being viewed; ?leads=all opens it up to every
  // lead we've ever logged for the account.
  const allLeads = params_.get("leads") === "all";
  return NextResponse.json({
    account: {
      name: account.name,
      launchDate: snapshotLaunchDateFor(account),
      contractEnd: account.contract_end || null,
    },
    week,
    // Authorship stays internal. updated_at is kept so "this week's work" can
    // see monthly rows that were progressed this week but filed under the 1st.
    rows: rows.map(({ logged_by, ...row }) => {
      void logged_by;
      return row;
    }),
    overview: deliverableOverview(account.id),
    wins: listWins(account.id),
    metrics: metricsSeries(account.id),
    // Bounds for the week picker, so it stops rather than paging into empty
    // future weeks that read like an account gone quiet.
    bounds: weekBounds(account.id),
    leads: listLeads(account.id, allLeads ? undefined : { week }),
    leadWeeks: weeksWithLeads(account.id),
    // Last month's revenue, if we're still asking them for it.
    revenueAsk: revenueAsk(account.id),
  });
}
