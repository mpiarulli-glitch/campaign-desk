// Minimal in-memory rate limiter for the login endpoint. Single-instance app,
// so an in-memory store is sufficient (it resets on redeploy, which is fine —
// the goal is to stop online brute-force, not to be a distributed limiter).

type Bucket = { fails: number; windowEnd: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const MAX_FAILS = 8; // failures allowed in a window before lockout
const LOCK_MS = 15 * 60 * 1000; // lockout duration once tripped
const MAX_KEYS = 10_000; // hard cap so the map can't grow unbounded

function prune(now: number): void {
  for (const [k, b] of buckets) {
    if (b.windowEnd < now && b.lockedUntil < now) buckets.delete(k);
  }
}

// Call before checking a password. Returns retryAfter (seconds) when locked.
export function loginAllowed(key: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (b && b.lockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// Call on a failed attempt. Trips a lockout once MAX_FAILS is reached.
export function loginFailed(key: string): void {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) prune(now);
  let b = buckets.get(key);
  if (!b || b.windowEnd < now) {
    b = { fails: 0, windowEnd: now + WINDOW_MS, lockedUntil: 0 };
    buckets.set(key, b);
  }
  b.fails += 1;
  if (b.fails >= MAX_FAILS) {
    b.lockedUntil = now + LOCK_MS;
    b.fails = 0;
    b.windowEnd = now + LOCK_MS;
  }
}

// Call on a successful login to clear the counter for that key.
export function loginSucceeded(key: string): void {
  buckets.delete(key);
}

// Best-effort client IP from proxy headers (Railway sets x-forwarded-for).
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
