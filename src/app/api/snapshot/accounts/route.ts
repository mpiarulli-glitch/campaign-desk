import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { listAccounts } from "@/lib/snapshot";

// Accounts are created via POST /api/revenue/clients (the same "add client"
// flow used on the revenue page) — there is only one place clients get
// created, so a client can't end up with two mismatched rev_clients rows.
export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ accounts: listAccounts() });
}
