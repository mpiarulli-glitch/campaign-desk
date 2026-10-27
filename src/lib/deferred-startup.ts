// Work that used to run before Next listened: contact repair, Basecamp
// client binds, and link-all. Railway probes /api/health for 30 seconds from
// container start and gives up if nothing answers. These jobs are queued here
// and start only after the server is already listening.

export const DEFERRED_STARTUP_DELAY_MS = 45_000;

type StartupJob = {
  name: string;
  run: () => Promise<void>;
};

const jobs: StartupJob[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let contactRepairsStarted = false;

export function enqueueDeferredStartupJob(name: string, run: () => Promise<void>): void {
  jobs.push({ name, run });
  if (timer || inflight) return;
  timer = setTimeout(() => {
    timer = null;
    inflight = runDeferredStartupJobs();
  }, DEFERRED_STARTUP_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export async function runDeferredStartupJobs(): Promise<void> {
  const pending = jobs.splice(0, jobs.length);
  for (const job of pending) {
    try {
      await job.run();
    } catch (err) {
      console.error(
        `[startup] ${job.name} failed`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Known contact emails and phones. Idempotent, and safe to call from every
 * boot: a valid value already on the client is left alone. Once per process.
 * A thrown repair is logged and does not stop the other one.
 */
export async function runContactRepairs(): Promise<void> {
  if (contactRepairsStarted) return;
  contactRepairsStarted = true;
  let database;
  try {
    const { getDb } = await import("./db");
    database = getDb();
  } catch (err) {
    console.error(
      "[startup] contact repair failed",
      err instanceof Error ? err.message : err
    );
    return;
  }
  try {
    const { backfillKnownContactEmails } = await import("./contact-email-backfill");
    backfillKnownContactEmails(database);
  } catch (err) {
    console.error(
      "[startup] contact-email repair failed",
      err instanceof Error ? err.message : err
    );
  }
  try {
    const { backfillKnownContactPhones } = await import("./contact-phone-backfill");
    backfillKnownContactPhones(database);
  } catch (err) {
    console.error(
      "[startup] contact-phone repair failed",
      err instanceof Error ? err.message : err
    );
  }
}

export function deferredStartupInflight(): Promise<void> | null {
  return inflight;
}

export function resetDeferredStartupForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  inflight = null;
  contactRepairsStarted = false;
  jobs.length = 0;
}
