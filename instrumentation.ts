export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Root instrumentation.ts is the file Next.js loads in production.
    // src/instrumentation.ts is not this entry. Nothing below may touch the
    // database or Basecamp before this function returns: Next awaits
    // register() before it listens, and Railway's /api/health allows 30s.
    const { enqueueDeferredStartupJob, runContactRepairs } = await import(
      "./src/lib/deferred-startup"
    );
    enqueueDeferredStartupJob("deferred-startup", async () => {
      // Contact repair used to finish inside the first getDb(), before these
      // binds and link-all were started. Keep that order, then let the
      // network calls overlap the way the void calls did.
      await runContactRepairs();
      const {
        ensureKrakBobaPiscatawayGrowthOsClient,
        ensureFloorCoDesignGrowthOsClient,
        ensureCoronasDeOroClient,
      } = await import("./src/lib/basecamp-clients");
      const { linkAllBasecampProjectsOnStartup } = await import("./src/lib/basecamp-link-all");
      linkAllBasecampProjectsOnStartup();
      await Promise.all([
        ensureKrakBobaPiscatawayGrowthOsClient(),
        ensureFloorCoDesignGrowthOsClient(),
        ensureCoronasDeOroClient(),
      ]);
    });
    enqueueDeferredStartupJob("client-websites", async () => {
      const { runClientWebsiteSeedOnStartup } = await import(
        "./src/lib/client-website-seed"
      );
      await runClientWebsiteSeedOnStartup();
    });
    console.log(`[boot] ready to listen in ${Math.round(process.uptime() * 1000)}ms`);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
