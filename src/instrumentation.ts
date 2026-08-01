// Next.js runs register() once when the server starts.
//
// Home for one-time data tasks that need more than the sync migration path in
// lib/db can do. Each guards itself with a flag in app_settings, so every boot
// after the first is a no-op.
export async function register() {
  // Only the Node runtime can reach SQLite; skip the edge runtime pass.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Local and synchronous, so it finishes before the server takes traffic.
  const { runClientCleanupOnce } = await import("./lib/client-cleanup");
  runClientCleanupOnce();

  // Both call Basecamp, so deliberately not awaited — a slow or unreachable
  // Basecamp must not hold up the server coming online.
  const { runBasecampClientBackfillOnce } = await import("./lib/basecamp-clients");
  void runBasecampClientBackfillOnce();

  // Refreshes the calendar's event cache when it's empty or over 12h old.
  // There's no scheduler here, so boot is what keeps it current.
  const { syncBasecampEventsIfStale } = await import("./lib/basecamp-events");
  void syncBasecampEventsIfStale();
}
