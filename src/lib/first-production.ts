// Copy and helpers for a client's first production. The invite itself is an
// extra_production_requests row with kind = "first" (see extra-requests.ts).
import type { RevClient } from "./db";
import { CADENCE_LABEL, COLOR_LABEL, nextWindow } from "./cadence";

export function isFirstProductionClient(
  client: Pick<RevClient, "last_production_date">
): boolean {
  return !client.last_production_date;
}

export const FIRST_PRODUCTION_EXPECTATIONS = [
  "A videographer comes to you for four hours or a full day.",
  "You pick the locations, who is on camera, and what we should capture.",
  "We turn the shoot into ads, email, and social content.",
  "After this first one, you'll have a regular production window so you always know when you're up.",
];

export function firstProductionEmailCopy(windowText: string): {
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  cta: string;
} {
  return {
    subject: "Let's book your first production",
    preheader: `Pick a day ${windowText}. This is the shoot that starts your content engine.`,
    headline: "Your first production is next",
    intro:
      "We're excited to get on site with you. A production day is us showing up with a camera, capturing the real people and work behind your business, and turning that into content you can actually use. Pick a weekday that works, tell us where to go, and we'll handle the rest.",
    cta: "Book my first production",
  };
}

export function firstProductionCardCopy(windowText: string): {
  title: string;
  intro: string;
} {
  return {
    title: "Let's book your first production",
    intro: `We're excited to shoot with you. Any weekday between ${windowText} works. A production day is a videographer on site with you — you pick the locations and who is on camera, and we turn it into content for your marketing.`,
  };
}

export function defaultFirstWindow(
  client: RevClient,
  today: string
): { start: string; end: string } {
  const cadence = nextWindow(client, today);
  if (cadence) return cadence;
  const start = addDays(today, 3);
  return { start, end: addDays(start, 4) };
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export { COLOR_LABEL, CADENCE_LABEL };
