import { NextResponse } from "next/server";
import {
  deliverableOverview,
  getAccountByToken,
  listLeads,
  listWins,
  metricsSeries,
  revenueAsk,
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
    account: { name: account.name },
    week,
    // Internal authorship is stripped here. The client-facing report is signed by
    // the agency, and which staff member typed a status is not theirs to read.
    rows: rows.map(({ logged_by, updated_at, ...row }) => {
      void logged_by;
      void updated_at;
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
