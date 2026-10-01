import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarMonthBounds,
  campaignRevenueRowFromAttribution,
  emailRowRevenue,
  estimatedCampaignRevenue,
  isYearMonth,
  ticketForClient,
} from "../src/lib/campaign-revenue";
import type { AttributionRollupRow } from "../src/lib/email-attribution-rollup";
import type { RevClient } from "../src/lib/db";

function client(partial: Partial<RevClient> & Pick<RevClient, "id" | "name">): RevClient {
  return {
    business_model: "home_service",
    ghl_location_id: "loc",
    klaviyo_account: "",
    retainer: 0,
    monthly_cost: 0,
    ltv: null,
    snapshot_token: null,
    snapshot_launch_date: null,
    calendar_token: null,
    calendar_approved_at: null,
    calendar_approved_by: null,
    active: 1,
    color_week: "",
    production_cadence: "",
    last_production_date: null,
    schedule_token: null,
    dashboard_token: null,
    contract_start: null,
    contract_end: null,
    blackout_dates: "[]",
    contact_name: "",
    contact_email: "",
    poc: "",
    account_manager: "",
    tier: "",
    website: "",
    logo_path: "",
    sentiment_override: "",
    production_enrolled: 1,
    status_override: "",
    outreach_paused: 0,
    basecamp_project_id: "",
    basecamp_contact_id: 0,
    videographer_id: "",
    monthly_email_quota: 0,
    created_at: "",
    updated_at: "",
    ...partial,
  } as RevClient;
}

function attr(
  partial: Partial<AttributionRollupRow> & Pick<AttributionRollupRow, "clientId" | "clientName">
): AttributionRollupRow {
  return {
    locationId: "loc",
    attributedAppointments: 0,
    attributedFormFills: 0,
    totalAppointments: 0,
    totalFormFills: 0,
    campaignSends: 0,
    flowSends: 0,
    error: null,
    ...partial,
  };
}

test("calendarMonthBounds covers the whole month", () => {
  assert.deepEqual(calendarMonthBounds("2026-09"), {
    start: "2026-09-01",
    end: "2026-09-30",
  });
  assert.deepEqual(calendarMonthBounds("2026-02"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
  assert.equal(isYearMonth("2026-09"), true);
  assert.equal(isYearMonth("2026-13"), false);
});

test("ticket prefers a set LTV over metrics history", () => {
  assert.deepEqual(
    ticketForClient({ ltv: 450 }, [{ revenue: 9000, orders: 10 }]),
    { amount: 450, source: "set" }
  );
  assert.deepEqual(
    ticketForClient({ ltv: null }, [
      { revenue: 1000, orders: 0 },
      { revenue: 8000, orders: 4 },
    ]),
    { amount: 2000, source: "metrics" }
  );
  assert.deepEqual(ticketForClient({ ltv: 0 }, []), {
    amount: null,
    source: "missing",
  });
});

test("estimatedCampaignRevenue is bookings times ticket", () => {
  assert.equal(estimatedCampaignRevenue(3, 450), 1350);
  assert.equal(estimatedCampaignRevenue(3, null), null);
});

test("emailRowRevenue is null until the send actually went out", () => {
  assert.equal(emailRowRevenue(2, 400, true), null);
  assert.equal(emailRowRevenue(2, 400, false), 800);
});

test("campaign revenue skips ecommerce and keeps home service", () => {
  const pipe = client({ id: "pipe", name: "Pipe It Right", ltv: 500 });
  const krak = client({
    id: "krak",
    name: "Krak Boba Corporate",
    business_model: "ecomm",
    ltv: 20,
  });
  const home = campaignRevenueRowFromAttribution(
    attr({
      clientId: "pipe",
      clientName: "Pipe It Right",
      attributedAppointments: 4,
    }),
    pipe,
    []
  );
  assert.equal(home?.estimatedRevenue, 2000);
  assert.equal(
    campaignRevenueRowFromAttribution(
      attr({ clientId: "krak", clientName: "Krak Boba Corporate" }),
      krak,
      []
    ),
    null
  );
});
