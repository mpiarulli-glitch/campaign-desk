import { NextResponse } from "next/server";
import { isWorkflowAuthenticated, sessionTeam } from "@/lib/auth";
import {
  behindDeliverablesForClient,
  contractStatus,
  getAccount,
  getOrCreateToken,
  listDeliverables,
  listMetricsRaw,
  listRevenueReports,
  listWins,
} from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const account = getAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    account: { id: account.id, name: account.name },
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
