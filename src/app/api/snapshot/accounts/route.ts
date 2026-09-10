import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { backfillDeliverableTeams, listAccountPickerCards } from "@/lib/snapshot";

// Accounts are created via POST /api/revenue/clients (the same "add client"
// flow used on the revenue page) — there is only one place clients get
// created, so a client can't end up with two mismatched rev_clients rows.
export async function GET() {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Heal blank strategy/ads/etc. teams across accounts when the hub loads.
  backfillDeliverableTeams();
  return NextResponse.json({ accounts: listAccountPickerCards() });
}
