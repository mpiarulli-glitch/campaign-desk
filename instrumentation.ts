export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Root instrumentation.ts is the file Next.js loads. The Basecamp Forecast
    // bind lives here so it actually runs in production (src/instrumentation.ts
    // is not this entry).
    const {
      ensureKrakBobaPiscatawayGrowthOsClient,
      ensureFloorCoDesignGrowthOsClient,
      ensureCoronasDeOroClient,
    } = await import("./src/lib/basecamp-clients");
    void ensureKrakBobaPiscatawayGrowthOsClient();
    void ensureFloorCoDesignGrowthOsClient();
    // Known project id, SQLite only. Does not page Basecamp.
    void ensureCoronasDeOroClient();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
