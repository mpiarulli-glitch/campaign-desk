import { NextResponse } from "next/server";
import { can, sessionTeam } from "@/lib/auth";
import {
  behindDeliverablesForClient,
  backfillDeliverableTeams,
  contractStatus,
  getVisibleSnapshotAccount,
  getOrCreateToken,
  listDeliverables,
  listMetricsRaw,
  listRevenueReports,
  listWins,
  setSnapshotLaunchDate,
  snapshotLaunchDateFor,
} from "@/lib/snapshot";
import { isYmd } from "@/lib/snapshot-entry-date";

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
  // Persist inferred teams (strategy → Client Services, ads → Ads, etc.) so
  // Setup no longer shows those rows as Unassigned.
  backfillDeliverableTeams(id);
  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      launchDate: snapshotLaunchDateFor(account),
      contractStart: account.contract_start || null,
      contractEnd: account.contract_end || null,
    },
    // Scoped to the viewer's team; admins and the owner get everything.
    deliverables: listDeliverables(id, { team: await sessionTeam() }),
    token: getOrCreateToken(id),
    wins: listWins(id),
    metricsRaw: listMetricsRaw(id),
    contract: contractStatus(id),
    behind: behindDeliverablesForClient(id),
    revenueReports: listRevenueReports(id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const account = getVisibleSnapshotAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const raw = body.launchDate;
  if (raw !== null && raw !== "" && (typeof raw !== "string" || !isYmd(raw))) {
    return NextResponse.json({ error: "launchDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const contractMonths =
    typeof body.contractMonths === "number" && body.contractMonths > 0
      ? body.contractMonths
      : undefined;
  const saved = setSnapshotLaunchDate(
    id,
    typeof raw === "string" && raw ? raw : null,
    { contractMonths }
  );
  return NextResponse.json({ ok: true, ...saved });
}
