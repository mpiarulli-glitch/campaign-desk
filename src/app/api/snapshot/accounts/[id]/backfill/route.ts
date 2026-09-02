import { NextResponse } from "next/server";
import { can, sessionTeam } from "@/lib/auth";
import { backfillColumns, backfillGridData, getVisibleSnapshotAccount } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const account = getVisibleSnapshotAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const grid = backfillGridData(id, { team: await sessionTeam() });
  return NextResponse.json({
    account: { id: account.id, name: account.name },
    weeks: grid.weeks,
    columns: backfillColumns(grid.weeks),
    rows: grid.rows,
  });
}
