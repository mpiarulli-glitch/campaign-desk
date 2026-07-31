// Next.js runs register() once when the server starts.
//
// Used for the one-time Basecamp client backfill: linking existing clients to
// their project and importing client projects that had no client record. It
// guards itself with a flag in app_settings, so every boot after the first is a
// no-op. Deliberately not awaited — a slow or unreachable Basecamp must not hold
// up the server coming online.
export async function register() {
  // Only the Node runtime can reach SQLite; skip the edge runtime pass.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runBasecampClientBackfillOnce } = await import("./lib/basecamp-clients");
  void runBasecampClientBackfillOnce();
}
