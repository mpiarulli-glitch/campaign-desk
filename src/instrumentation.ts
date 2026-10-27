// Next.js runs register() once when the server starts, when this file is the
// instrumentation entry. Production currently loads the root instrumentation.ts
// instead. This copy stays in step so a build that picks src/ does not open
// the database before the process can answer /api/health.
//
// Home for one-time data tasks that need more than the sync migration path in
// lib/db can do. Each guards itself with a flag in app_settings. The client
// website seed retries a name that did not match for a few boots, then stops.
export async function register() {
  // Only the Node runtime can reach SQLite; skip the edge runtime pass.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { enqueueDeferredStartupJob, runContactRepairs } = await import("./lib/deferred-startup");
  enqueueDeferredStartupJob("deferred-startup", async () => {
    await runContactRepairs();
    const { runClientCleanupOnce } = await import("./lib/client-cleanup");
    runClientCleanupOnce();

    const {
      runBasecampClientBackfillOnce,
      ensureKrakBobaPiscatawayGrowthOsClient,
      ensureFloorCoDesignGrowthOsClient,
      ensureSwingInnCafeClient,
      ensureCoronasDeOroClient,
    } = await import("./lib/basecamp-clients");
    const { runGhlExactLinkBackfillOnce } = await import("./lib/ghl-links");
    const { syncBasecampEventsIfStale } = await import("./lib/basecamp-events");
    const { syncClientMessagesIfStale } = await import("./lib/basecamp-messages");
    await Promise.all([
      runBasecampClientBackfillOnce(),
      ensureKrakBobaPiscatawayGrowthOsClient(),
      ensureFloorCoDesignGrowthOsClient(),
      ensureSwingInnCafeClient(),
      ensureCoronasDeOroClient(),
      runGhlExactLinkBackfillOnce(),
      syncBasecampEventsIfStale(),
      syncClientMessagesIfStale(),
    ]);
  });

  enqueueDeferredStartupJob("client-websites", async () => {
    const { runClientWebsiteSeedOnStartup } = await import("./lib/client-website-seed");
    await runClientWebsiteSeedOnStartup();
  });

  console.log(`[boot] ready to listen in ${Math.round(process.uptime() * 1000)}ms`);
}
