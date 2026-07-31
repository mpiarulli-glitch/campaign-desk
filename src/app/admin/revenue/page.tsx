import { redirect } from "next/navigation";

// Sunset 2026-07-31. The revenue dashboard is hidden from every role, including
// the owner. The previous page is in git history if it needs to come back.
//
// Only the UI is retired. The /api/revenue endpoints stay exactly as they are,
// because /api/revenue/clients is the client registry the whole app reads from
// (production, calendar, campaigns, snapshots, forecast, add-client) rather than
// a revenue feature. Deleting it would take most of the app with it.
export default function RetiredRevenuePage() {
  redirect("/admin");
}
