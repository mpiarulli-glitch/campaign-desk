import { NextResponse } from "next/server";
import {
  getAccountByToken,
  winsForClientWeek,
  metricsSeries,
  revenueAsk,
  snapshotLaunchDateFor,
  weekBounds,
  weekData,
} from "@/lib/snapshot";
import { filledDepartmentNotes } from "@/lib/snapshot-departments";
import { clientSnapshotWeeks, resolveUnpinnedSnapshotWeek } from "@/lib/snapshot-week-pin";
import { parseWeekStart } from "@/lib/week";

type Params = { params: Promise<{ token: string }> };

// Public, read-only. No admin auth — the token IS the access grant.
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params_ = new URL(request.url).searchParams;
  const rawWeek = params_.get("week");
  // A missing week is an older link. A present week is pinned, even when the
  // date falls on a Friday: it is read as that week's Monday.
  let week: string;
  let pinned = false;
  if (rawWeek === null) {
    week = resolveUnpinnedSnapshotWeek(account.id);
  } else {
    const parsed = parseWeekStart(rawWeek);
    if (!parsed) {
      return NextResponse.json({ error: "week (YYYY-MM-DD) required" }, { status: 400 });
    }
    week = parsed;
    pinned = true;
  }
  // Not team-scoped: the client is shown their whole account, not one team's slice.
  // Departments, wins, and rows are the ones saved for `week`, not this week's live fill.
  const rows = weekData(account.id, week);
  return NextResponse.json({
    account: {
      name: account.name,
      launchDate: snapshotLaunchDateFor(account),
    },
    week,
    pinned,
    // This client's weeks only. The page uses them for previous / next.
    weeks: clientSnapshotWeeks(account.id, week),
    // Authorship stays internal. updated_at is kept so "this week's work" can
    // see monthly rows that were progressed this week but filed under the 1st.
    rows: rows.map(({ logged_by, ...row }) => {
      void logged_by;
      return row;
    }),
    // Full contract / deliverable overview is hidden from the client view for now.
    wins: winsForClientWeek(account.id, week),
    departments: filledDepartmentNotes(account.id, week).map((note) => ({
      slug: note.department,
      label: note.label,
      items: note.items.map((item) => ({
        body: item.body,
        completed: item.completed,
        status: item.status,
      })),
    })),
    metrics: metricsSeries(account.id),
    // Bounds for the week picker, so it stops rather than paging into empty
    // future weeks that read like an account gone quiet.
    bounds: weekBounds(account.id),
    // Last month's revenue, if we're still asking them for it.
    revenueAsk: revenueAsk(account.id),
  });
}
