import { redirect } from "next/navigation";

// Sunset 2026-07-31, alongside the revenue dashboard it belonged to.
//
// Two things lived only here and have no replacement in the app: entering a
// client's monthly revenue and orders, and deleting a client. Both are still
// reachable through the API (PUT /api/revenue/clients/[id]/metrics and
// DELETE /api/revenue/clients/[id]) and the page is in git history. Cadence
// editing and the scheduling-link copy moved to /admin/production before this
// was retired, so those are covered.
export default function RetiredRevenueClientPage() {
  redirect("/admin");
}
