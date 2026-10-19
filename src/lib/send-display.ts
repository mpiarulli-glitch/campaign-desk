/**
 * The send instant to show on a campaigns list row.
 *
 * Upcoming times win (the earliest one still ahead). When every known time
 * is in the past, the latest is the send that already happened. ISO
 * timestamps sort as text. This file stays free of the database so list
 * tests can import it without opening a connection.
 */
export function pickDisplayedSendAt(
  times: Array<string | null | undefined>,
  now = new Date().toISOString()
): { at: string | null; upcoming: boolean } {
  const stamps = times.filter((t): t is string => Boolean(t && t.trim()));
  const upcoming = stamps.filter((t) => t >= now).sort();
  if (upcoming.length) return { at: upcoming[0], upcoming: true };
  const past = [...stamps].sort();
  if (past.length) return { at: past[past.length - 1], upcoming: false };
  return { at: null, upcoming: false };
}
