import assert from "node:assert/strict";
import test from "node:test";
import { buildEmailRecommendations } from "../src/lib/email-analytics-tips";
import type { ClientEmailAnalytics } from "../src/lib/ghl-email-analytics";

function sample(partial: Partial<ClientEmailAnalytics> & {
  totals: ClientEmailAnalytics["totals"];
  campaigns: ClientEmailAnalytics["campaigns"];
}): ClientEmailAnalytics {
  return {
    locationId: "loc",
    start: "2026-08-01",
    end: "2026-08-31",
    fetchedAt: "2026-08-31T00:00:00.000Z",
    appointments: null,
    appointmentsError: null,
    ...partial,
  };
}

test("buildEmailRecommendations flags low opens and cites a winning subject", () => {
  const tips = buildEmailRecommendations(
    sample({
      appointments: 2,
      totals: {
        campaigns: 2,
        withStats: 2,
        sent: 1000,
        delivered: 980,
        opened: 180,
        clicked: 8,
        bounced: 10,
        unsubscribed: 1,
        openRate: 18.4,
        clickRate: 0.8,
      },
      campaigns: [
        {
          id: "1",
          name: "Winner",
          subject: "Free patio consult this week",
          status: "complete",
          sentOn: "2026-08-10",
          bulkRequestId: "a",
          sent: 500,
          delivered: 490,
          opened: 140,
          clicked: 6,
          bounced: 5,
          unsubscribed: 0,
          openRate: 28.6,
          clickRate: 1.2,
          statsAvailable: true,
        },
        {
          id: "2",
          name: "Loser",
          subject: "Newsletter",
          status: "complete",
          sentOn: "2026-08-20",
          bulkRequestId: "b",
          sent: 500,
          delivered: 490,
          opened: 40,
          clicked: 2,
          bounced: 5,
          unsubscribed: 1,
          openRate: 8.2,
          clickRate: 0.4,
          statsAvailable: true,
        },
      ],
    })
  );

  assert.ok(tips.some((t) => t.id === "low-open"));
  assert.ok(tips.some((t) => t.id === "low-click"));
  const winner = tips.find((t) => t.id === "winner-subject");
  assert.ok(winner);
  assert.match(winner!.detail, /Free patio consult this week/);
});
