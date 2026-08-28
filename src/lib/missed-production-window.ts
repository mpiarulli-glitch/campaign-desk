// A client who opens their scheduling link after the dates we asked them to
// pick from have passed. The link itself does not expire; this is how the
// booking page knows to stop offering those dates and instead let them request
// a makeup shoot, with a note that content timing will slip.

export type AllocatedWindow = { start: string; end: string };

export function resolveMissedAllocatedWindow(args: {
  today: string;
  openExtras: AllocatedWindow[];
  askedWindows: AllocatedWindow[];
  bookedWindowStarts: string[];
}): AllocatedWindow | null {
  const liveExtra = args.openExtras.find((w) => w.end >= args.today);
  // A still-open invite is the current ask. Don't treat an older closed week
  // as missed while that invite is in front of them.
  if (liveExtra) return null;

  const expiredExtra = args.openExtras.find((w) => w.end < args.today);
  if (expiredExtra) return expiredExtra;

  const booked = new Set(args.bookedWindowStarts);
  const missedAsk = args.askedWindows
    .filter((w) => w.end < args.today && !booked.has(w.start))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))[0];
  return missedAsk || null;
}
