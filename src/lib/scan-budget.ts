/**
 * Portfolio scans talk to GoHighLevel for every account before they write a
 * response. Railway closes an HTTP request after 5 minutes with no bytes
 * sent (logged as 499). Stop waiting before that and let the caller return
 * the accounts that already finished.
 */

export const SCAN_BUDGET_MS = 240_000;

export const SCAN_TIME_LIMIT_ERROR =
  "This account did not finish before the scan time limit.";

/** True when a slot has not been written yet. Empty holes count as pending. */
export function scanHasPending(
  values: Array<unknown>,
  expected: number
): boolean {
  if (values.length < expected) return true;
  for (let i = 0; i < expected; i++) {
    if (values[i] === undefined) return true;
  }
  return false;
}

/**
 * Run `fn` over `items` with a concurrency cap.
 *
 * `withinBudget` resolves when every item has finished, or when `budgetMs`
 * elapses — whichever comes first. Slots that have not finished are
 * `undefined`. `all` resolves later with every slot filled, so a caller can
 * answer the HTTP request on time and keep the rest of the scan for the cache.
 */
export function mapWithBudget<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  budgetMs: number
): {
  withinBudget: Promise<{ values: Array<R | undefined>; timedOut: boolean }>;
  all: Promise<Array<R | undefined>>;
  values: Array<R | undefined>;
} {
  const values: Array<R | undefined> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        values[i] = await fn(items[i]);
      }
    }
  );
  const all = Promise.all(workers).then(() => values);
  // The HTTP side may return first. A later failure must not surface as an
  // unhandled rejection once nobody is awaiting `all`.
  const guarded = all.catch(() => values);

  const withinBudget = new Promise<{
    values: Array<R | undefined>;
    timedOut: boolean;
  }>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ values: values.slice(), timedOut: true });
    }, Math.max(0, budgetMs));
    guarded.then((done) => {
      clearTimeout(timer);
      resolve({ values: done, timedOut: false });
    });
  });

  return { withinBudget, all: guarded, values };
}
