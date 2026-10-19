import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAccountSnapshot, combineAccounts, deltaRatio, sumPoints } from "../src/lib/klaviyo-revenue/aggregate";
import { detectMetrics } from "../src/lib/klaviyo-revenue/detect";
import { buildFixtureDashboard } from "../src/lib/klaviyo-revenue/fixtures";
import { emailSeries, parseEvents, parseMetricAggregate, parseValuesReport, sumReport, undimensionedSeries } from "../src/lib/klaviyo-revenue/parse";
import { pullAccount } from "../src/lib/klaviyo-revenue/pull";
import { attributeSmsRecoveries } from "../src/lib/klaviyo-revenue/sms-recovery";
import type { AccountSnapshot, DailyPoint, KlaviyoRevenueAccount, TimelineEvent } from "../src/lib/klaviyo-revenue/types";
import { SMS_ABANDON_GAP_MS, SMS_RECOVERY_WINDOW_MS } from "../src/lib/klaviyo-revenue/types";
import { resolveWindow, zonedStartIso } from "../src/lib/klaviyo-revenue/window";
import { defaultAllowed, subjectFor } from "../src/lib/access";
import { OWNER_SLUG } from "../src/lib/people";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-10-01T15:00:00Z");
const RANGE = { startMs: T0 - DAY, endMs: T0 + 10 * DAY, timeZone: "UTC" };

function ev(profileId: string, at: number, kind: TimelineEvent["kind"], value?: number): TimelineEvent {
  return { profileId, at, kind, value };
}

test("booking metrics are detected only from specific names", () => {
  const found = detectMetrics([
    { id: "po", name: "Placed Order" },
    { id: "form", name: "Submitted Form" },
    { id: "profile", name: "Form submitted by profile" },
    { id: "sms", name: "Received SMS" },
    { id: "click", name: "Clicked SMS" },
    { id: "sent", name: "Sent Text Message" },
    { id: "email", name: "Clicked Email" },
    { id: "cancel", name: "Cancelled Order" },
  ]);
  assert.equal(found.booking, null);
  assert.equal(found.form?.name, "Submitted Form");
  assert.equal(found.conversion?.name, "Placed Order");
  assert.equal(found.sms?.name, "Received SMS");

  const text = detectMetrics([
    { id: "f", name: "Submitted Form" },
    { id: "o", name: "Placed Order" },
    { id: "r", name: "Received Text Message" },
    { id: "c", name: "Clicked Text Message" },
    { id: "s", name: "Sent Text Message" },
  ]);
  assert.equal(text.booking, null);
  assert.equal(text.sms?.name, "Received Text Message");

  const spa = detectMetrics([
    { id: "b", name: "Booked Appointment" },
    { id: "remind", name: "Appointment Reminder" },
    { id: "f", name: "Form submitted by profile" },
    { id: "sms", name: "Received SMS" },
  ]);
  assert.equal(spa.booking?.name, "Booked Appointment");
  assert.equal(spa.form?.name, "Form submitted by profile");
  assert.equal(spa.conversion, null);
});

test("windows are inclusive calendar ranges with an equal previous period", () => {
  const last30 = resolveWindow({ preset: "30", today: "2026-10-19", timeZone: "America/New_York" });
  assert.equal(last30.start, "2026-09-20");
  assert.equal(last30.end, "2026-10-20");
  assert.equal(last30.dayCount, 30);
  assert.equal(last30.previousEnd, "2026-09-20");
  assert.equal(last30.previousStart, "2026-08-21");
  assert.equal(zonedStartIso("2026-01-15", "America/New_York"), "2026-01-15T05:00:00Z");
  assert.equal(zonedStartIso("2026-07-15", "America/New_York"), "2026-07-15T04:00:00Z");

  const custom = resolveWindow({
    preset: "custom",
    start: "2026-10-01",
    end: "2026-10-02",
    today: "2026-10-19",
  });
  assert.equal(custom.end, "2026-10-03");
  assert.equal(custom.dayCount, 2);
  assert.throws(() => resolveWindow({ preset: "custom", start: "2026-10-02", end: "2026-01-01", today: "2026-10-19" }));
});

test("SMS recovery follows form, then text, then booking", () => {
  const recovered = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + HOUR, "sms"), ev("p", T0 + 5 * HOUR, "book", 180)],
    RANGE
  );
  assert.equal(recovered.formFills, 1);
  assert.equal(recovered.directBookings, 0);
  assert.equal(recovered.abandoned, 0);
  assert.equal(recovered.recovered, 1);
  assert.equal(recovered.attributedValue, 180);
  assert.equal(recovered.recoveryRate, 1);
  assert.equal(recovered.formFills, recovered.directBookings + recovered.recovered + recovered.abandoned);

  const direct = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + 2 * HOUR, "book", 50), ev("p", T0 + 3 * HOUR, "sms")],
    RANGE
  );
  assert.equal(direct.directBookings, 1);
  assert.equal(direct.recovered, 0);
  assert.equal(direct.attributedValue, 0);

  const sameSession = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + 60_000, "sms"), ev("p", T0 + SMS_ABANDON_GAP_MS - 1, "book", 20)],
    RANGE
  );
  assert.equal(sameSession.directBookings, 1);
  assert.equal(sameSession.recovered, 0);

  const boundary = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + 10 * 60_000, "sms"), ev("p", T0 + SMS_ABANDON_GAP_MS, "book", 20)],
    RANGE
  );
  assert.equal(boundary.recovered, 1);

  const late = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + HOUR, "sms"), ev("p", T0 + HOUR + SMS_RECOVERY_WINDOW_MS + 1, "book", 90)],
    RANGE
  );
  assert.equal(late.recovered, 0);
  assert.equal(late.abandoned, 1);
  assert.equal(late.recoveryRate, 0);
  assert.equal(late.attributedValue, 0);

  const onWindow = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + HOUR, "sms"), ev("p", T0 + HOUR + SMS_RECOVERY_WINDOW_MS, "book", 10)],
    RANGE
  );
  assert.equal(onWindow.recovered, 1);

  const untouched = attributeSmsRecoveries([ev("p", T0, "form")], RANGE);
  assert.equal(untouched.abandoned, 1);
  assert.equal(untouched.recoveryRate, 0);

  const textOnly = attributeSmsRecoveries([ev("p", T0, "form"), ev("p", T0 + HOUR, "sms")], RANGE);
  assert.equal(textOnly.abandoned, 1);
  assert.equal(textOnly.recovered, 0);

  const textFirst = attributeSmsRecoveries(
    [ev("p", T0 - HOUR, "sms"), ev("p", T0, "form"), ev("p", T0 + 2 * HOUR, "book")],
    RANGE
  );
  assert.equal(textFirst.directBookings, 1);
  assert.equal(textFirst.recovered, 0);

  const two = attributeSmsRecoveries(
    [
      ev("a", T0, "form"),
      ev("a", T0 + 2 * HOUR, "sms"),
      ev("a", T0 + 4 * HOUR, "book", 40),
      ev("b", T0, "form"),
      ev("b", T0 + 3 * HOUR, "book", 15),
    ],
    RANGE
  );
  assert.equal(two.recovered, 1);
  assert.equal(two.directBookings, 1);
  assert.equal(two.attributedValue, 40);

  const outside = attributeSmsRecoveries(
    [ev("p", T0 - 2 * DAY, "form"), ev("p", T0 - 2 * DAY + HOUR, "sms"), ev("p", T0 - DAY, "book", 99)],
    RANGE
  );
  assert.equal(outside.formFills, 0);
  assert.equal(outside.recovered, 0);

  const tailEnd = T0 + 2 * DAY;
  const tail = attributeSmsRecoveries(
    [ev("p", T0, "form"), ev("p", T0 + HOUR, "sms"), ev("p", tailEnd + HOUR, "book", 70)],
    { startMs: T0 - HOUR, endMs: tailEnd, timeZone: "UTC" }
  );
  assert.equal(tail.recovered, 1);
  assert.equal(tail.tailRecoveries, 1);
  assert.equal(tail.attributedValue, 70);
  assert.equal(tail.series.reduce((sum, point) => sum + point.count, 0), 0);

  const superseded = attributeSmsRecoveries(
    [
      ev("p", T0, "form"),
      ev("p", T0 + 30 * 60_000, "form"),
      ev("p", T0 + 2 * HOUR, "sms"),
      ev("p", T0 + 5 * HOUR, "book", 25),
    ],
    RANGE
  );
  assert.equal(superseded.formFills, 2);
  assert.equal(superseded.abandoned, 1);
  assert.equal(superseded.recovered, 1);
  assert.equal(superseded.formFills, superseded.directBookings + superseded.recovered + superseded.abandoned);

  const allDirect = attributeSmsRecoveries([ev("p", T0, "form"), ev("p", T0 + HOUR, "book")], RANGE);
  assert.equal(allDirect.recoveryRate, null);
});

test("metric aggregates and values reports keep email separate from SMS", () => {
  const body = {
    data: {
      attributes: {
        dates: ["2026-10-01T00:00:00-04:00", "2026-10-02T00:00:00-04:00"],
        data: [
          { dimensions: ["$email"], measurements: { count: [2, 3], sum_value: [40, 60] } },
          { dimensions: ["sms"], measurements: { count: [9, 9], sum_value: [500, 500] } },
        ],
      },
    },
  };
  const email = emailSeries(body);
  assert.deepEqual(sumPoints(email, "2026-10-01", "2026-10-03"), { count: 5, sumValue: 100 });
  assert.equal(parseMetricAggregate(body).rows.find((row) => row.channel === "sms")?.points[0].count, 9);

  const plain = undimensionedSeries({
    data: {
      attributes: {
        dates: ["2026-10-01T00:00:00Z"],
        data: [{ dimensions: [], measurements: { count: [4], sum_value: [0] } }],
      },
    },
  });
  assert.equal(plain[0].count, 4);

  const report = parseValuesReport({
    data: {
      attributes: {
        results: [
          {
            groupings: { campaign_id: "c1", campaign_name: "October battery drop", send_channel: "email" },
            statistics: { conversions: 2, conversion_value: 80 },
          },
          {
            groupings: { flow_id: "f1", flow_name: "Winback", send_channel: "sms" },
            statistics: { conversions: 7, conversion_value: 300 },
          },
        ],
      },
    },
  });
  assert.deepEqual(sumReport(report, "email"), { conversions: 2, revenue: 80 });
  assert.equal(report[1].name, "Winback");

  const events = parseEvents(
    {
      data: [
        {
          attributes: { datetime: "2026-10-01T15:00:00Z", event_properties: { $value: "180" } },
          relationships: { profile: { data: { id: "p1" } } },
        },
        { attributes: { datetime: "2026-10-01T15:00:00Z", event_properties: {} } },
      ],
    },
    "book"
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].value, 180);
  assert.equal(events[0].profileId, "p1");
});

function point(date: string, count: number, sumValue = 0): DailyPoint {
  return { date, count, sumValue };
}

function shell(overrides: Partial<AccountSnapshot> & Pick<AccountSnapshot, "id" | "name">): AccountSnapshot {
  const base: AccountSnapshot = {
    id: overrides.id,
    name: overrides.name,
    timezone: "America/New_York",
    currency: "USD",
    error: null,
    warnings: [],
    booking: { status: "untracked", metricName: null, count: null, previous: null, value: null, emailAttributed: null, series: [] },
    forms: { status: "untracked", metricName: null, count: null, previous: null, series: [] },
    email: {
      status: "untracked",
      metricName: null,
      method: "none",
      revenue: null,
      previousRevenue: null,
      conversions: null,
      previousConversions: null,
      series: [],
      campaigns: [],
      flows: [],
    },
    sms: {
      status: "untracked",
      metricName: null,
      formFills: 0,
      directBookings: 0,
      abandoned: 0,
      recovered: null,
      previousRecovered: null,
      previousAbandoned: null,
      recoveryRate: null,
      previousRecoveryRate: null,
      attributedValue: null,
      previousAttributedValue: null,
      series: [],
      flowAttributedBookings: null,
      flowAttributedValue: null,
      truncated: false,
      tailRecoveries: 0,
    },
  };
  return {
    ...base,
    ...overrides,
    booking: { ...base.booking, ...overrides.booking },
    forms: { ...base.forms, ...overrides.forms },
    email: { ...base.email, ...overrides.email },
    sms: { ...base.sms, ...overrides.sms },
  };
}

test("combined totals skip accounts that are not tracking a metric", () => {
  const tracked = shell({
    id: "a",
    name: "Apex",
    booking: { status: "value", metricName: "Booked Appointment", count: 10, previous: 8, value: 100, emailAttributed: 3, series: [point("2026-10-01", 10)] },
    forms: { status: "value", metricName: "Submitted Form", count: 20, previous: 10, series: [point("2026-10-01", 20)] },
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: 50,
      previousRevenue: 25,
      conversions: 4,
      previousConversions: 2,
      series: [point("2026-10-01", 4, 50)],
      campaigns: [],
      flows: [],
    },
    sms: {
      status: "value",
      metricName: "Received SMS",
      formFills: 4,
      directBookings: 1,
      abandoned: 1,
      recovered: 1,
      previousRecovered: 0,
      previousAbandoned: 2,
      recoveryRate: 0.5,
      previousRecoveryRate: 0,
      attributedValue: 40,
      previousAttributedValue: 0,
      series: [point("2026-10-01", 1, 40)],
      flowAttributedBookings: 2,
      flowAttributedValue: 80,
      truncated: false,
      tailRecoveries: 0,
    },
  });
  const quiet = shell({
    id: "b",
    name: "12volt",
    currency: "USD",
    forms: { status: "value", metricName: "Submitted Form", count: 5, previous: 5, series: [point("2026-10-01", 5)] },
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: 20,
      previousRevenue: 20,
      conversions: 1,
      previousConversions: 1,
      series: [point("2026-10-01", 1, 20)],
      campaigns: [],
      flows: [],
    },
  });
  const none = shell({ id: "c", name: "Hendos" });
  const combined = combineAccounts([tracked, quiet, none], "2026-10-01", "2026-10-02");
  assert.equal(combined.booking.status, "partial");
  assert.equal(combined.booking.count, 10);
  assert.deepEqual(combined.booking.untrackedNames.sort(), ["12volt", "Hendos"]);
  assert.equal(combined.forms.count, 25);
  assert.equal(combined.email.revenue, 70);
  assert.equal(combined.sms.recovered, 1);
  assert.equal(combined.sms.abandoned, 1);
  assert.equal(combined.sms.recoveryRate, 0.5);
  assert.equal(combined.series[0].bookings, 10);
  assert.equal(combined.series[0].formFills, 25);
  assert.equal(combined.series[0].emailRevenue, 70);

  const blank = combineAccounts([none, shell({ id: "d", name: "Other" })], "2026-10-01", "2026-10-02");
  assert.equal(blank.booking.status, "untracked");
  assert.equal(blank.booking.count, null);
  assert.equal(blank.sms.status, "untracked");
  assert.equal(blank.sms.recovered, null);
  assert.equal(deltaRatio(10, 8), 0.25);
  assert.equal(deltaRatio(1, 0), null);
  assert.equal(deltaRatio(null, 4), null);

  const eur = shell({
    id: "e",
    name: "Euro",
    currency: "EUR",
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: 5,
      previousRevenue: 5,
      conversions: 1,
      previousConversions: 1,
      series: [],
      campaigns: [],
      flows: [],
    },
  });
  const mixed = combineAccounts([tracked, eur], "2026-10-01", "2026-10-02");
  assert.equal(mixed.mixedCurrency, true);
  assert.equal(mixed.email.revenue, null);
  assert.equal(mixed.email.conversions, 5);
});

test("snapshot builder turns a profile timeline into recovery, and ignores SMS revenue", () => {
  const range = resolveWindow({ preset: "custom", start: "2026-10-01", end: "2026-10-02", today: "2026-10-19" });
  const snap = buildAccountSnapshot({
    id: "apex",
    name: "Apex",
    timezone: "America/New_York",
    currency: "USD",
    error: null,
    warnings: [],
    bookingMetricName: "Booked Appointment",
    formMetricName: "Submitted Form",
    conversionMetricName: "Placed Order",
    smsMetricName: "Received SMS",
    hasBooking: true,
    hasForm: true,
    hasConversion: true,
    hasSms: true,
    range,
    bookings: [point("2026-10-01", 2, 0), point("2026-09-30", 9, 0)],
    bookingEmail: [point("2026-10-01", 1, 0)],
    forms: [point("2026-10-01", 4), point("2026-09-30", 1)],
    conversionEmail: [point("2026-10-01", 2, 80), point("2026-09-30", 1, 10)],
    campaigns: [],
    flows: [],
    emailMethod: "metric-aggregate",
    emailValuesFallback: { revenue: 999, conversions: 999, previousRevenue: 999, previousConversions: 999 },
    events: [
      ev("p", Date.parse("2026-10-01T15:00:00Z"), "form"),
      ev("p", Date.parse("2026-10-01T16:30:00Z"), "sms"),
      ev("p", Date.parse("2026-10-01T20:00:00Z"), "book", 180),
    ],
    eventsTruncated: false,
    smsFlow: { conversions: 4, revenue: 20 },
  });
  assert.equal(snap.booking.count, 2);
  assert.equal(snap.booking.previous, 9);
  assert.equal(snap.email.revenue, 80);
  assert.equal(snap.email.previousRevenue, 10);
  assert.equal(snap.sms.recovered, 1);
  assert.equal(snap.sms.attributedValue, 180);
  assert.equal(snap.sms.flowAttributedBookings, 4);
  assert.notEqual(snap.email.revenue, 999);
});

test("fixture dashboard keeps 12volt and Hendos off the booking total", () => {
  const range = resolveWindow({ preset: "30", today: "2026-10-19" });
  const dashboard = buildFixtureDashboard(range, { canManage: true, fetchedAt: "2026-10-19T15:00:00Z" });
  const byName = Object.fromEntries(dashboard.accounts.map((account) => [account.name, account]));
  assert.equal(byName["12volt"].booking.status, "untracked");
  assert.equal(byName.Hendos.booking.status, "untracked");
  assert.equal(byName["12volt"].sms.status, "untracked");
  assert.equal(byName.Hendos.sms.status, "untracked");
  assert.equal(byName["Apex Med Spa"].booking.status, "value");
  assert.equal(byName["Lumen Fitness"].booking.status, "value");
  assert.equal(dashboard.combined.booking.status, "partial");
  assert.equal(
    dashboard.combined.booking.count,
    (byName["Apex Med Spa"].booking.count ?? 0) + (byName["Lumen Fitness"].booking.count ?? 0)
  );
  assert.ok((dashboard.combined.email.revenue ?? 0) > (byName["12volt"].email.revenue ?? 0));
  const apex = byName["Apex Med Spa"].sms;
  assert.equal(apex.formFills, apex.directBookings + (apex.recovered ?? 0) + apex.abandoned);
  assert.equal(dashboard.demo, true);
  assert.equal(defaultAllowed("page.klaviyo", subjectFor("sylvia")), true);
  assert.equal(defaultAllowed("page.klaviyo", subjectFor("jack")), false);
  assert.equal(defaultAllowed("page.klaviyo", subjectFor(OWNER_SLUG)), true);
});

test("pull attributes email from the channel aggregate and recovery from events", async () => {
  const range = resolveWindow({
    preset: "custom",
    start: "2026-10-01",
    end: "2026-10-02",
    today: "2026-10-19",
    timeZone: "America/New_York",
  });
  const account: KlaviyoRevenueAccount = {
    id: "kr_test",
    name: "Apex",
    klaviyoAccountId: "acct",
    timezone: "America/New_York",
    currency: "USD",
    keyHint: "pk_••••test",
    bookingMetricId: "met_book",
    bookingMetricName: "Booked Appointment",
    bookingDetection: "auto",
    formMetricId: "met_form",
    formMetricName: "Submitted Form",
    formDetection: "auto",
    conversionMetricId: "met_order",
    conversionMetricName: "Placed Order",
    conversionDetection: "auto",
    smsMetricId: "met_sms",
    smsMetricName: "Received SMS",
    smsDetection: "auto",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };

  function aggregate(metricId: string, by: boolean) {
    if (by && metricId === "met_order") {
      return {
        data: {
          attributes: {
            dates: ["2026-10-01T00:00:00-04:00", "2026-09-30T00:00:00-04:00"],
            data: [
              { dimensions: ["email"], measurements: { count: [2, 1], sum_value: [80, 10] } },
              { dimensions: ["sms"], measurements: { count: [8, 8], sum_value: [400, 400] } },
            ],
          },
        },
      };
    }
    if (by) {
      return {
        data: {
          attributes: {
            dates: ["2026-10-01T00:00:00-04:00"],
            data: [{ dimensions: ["email"], measurements: { count: [1], sum_value: [0] } }],
          },
        },
      };
    }
    const count = metricId === "met_form" ? 4 : 2;
    return {
      data: {
        attributes: {
          dates: ["2026-10-01T00:00:00-04:00"],
          data: [{ dimensions: [], measurements: { count: [count], sum_value: [0] } }],
        },
      },
    };
  }

  const snap = await pullAccount(account, range, {
    async post(path, body) {
      const record = body as { data?: { attributes?: { metric_id?: string; by?: string[]; filter?: string } } };
      if (path.includes("metric-aggregates")) {
        return aggregate(String(record.data?.attributes?.metric_id), Boolean(record.data?.attributes?.by));
      }
      if (path.includes("flow-values") && String(record.data?.attributes?.filter).includes("sms")) {
        return {
          data: {
            attributes: {
              results: [
                {
                  groupings: { flow_id: "flow", flow_name: "Abandoned consult", send_channel: "sms" },
                  statistics: { conversions: 3, conversion_value: 90 },
                },
              ],
            },
          },
        };
      }
      return {
        data: {
          attributes: {
            results: [
              {
                groupings: { campaign_id: "camp", campaign_name: "October", send_channel: "email" },
                statistics: { conversions: 1, conversion_value: 40 },
              },
            ],
          },
        },
      };
    },
    async get(path) {
      if (path.includes("met_form")) {
        return {
          data: [
            {
              attributes: { datetime: "2026-10-01T15:00:00Z", event_properties: {} },
              relationships: { profile: { data: { id: "p1" } } },
            },
          ],
        };
      }
      if (path.includes("met_book")) {
        return {
          data: [
            {
              attributes: { datetime: "2026-10-01T20:00:00Z", event_properties: { $value: 180 } },
              relationships: { profile: { data: { id: "p1" } } },
            },
          ],
        };
      }
      if (path.includes("met_sms")) {
        return {
          data: [
            {
              attributes: { datetime: "2026-10-01T16:30:00Z", event_properties: {} },
              relationships: { profile: { data: { id: "p1" } } },
            },
          ],
        };
      }
      return { data: { attributes: { name: "October" } } };
    },
  });

  assert.equal(snap.email.revenue, 80);
  assert.equal(snap.email.method, "metric-aggregate");
  assert.equal(snap.booking.count, 2);
  assert.equal(snap.forms.count, 4);
  assert.equal(snap.sms.recovered, 1);
  assert.equal(snap.sms.attributedValue, 180);
  assert.equal(snap.sms.flowAttributedBookings, 3);
  assert.equal(snap.email.campaigns[0]?.name, "October");
});

test("revenue account keys are encrypted at rest", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-klaviyo-revenue-"));
  const original = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests, getDb } = await import("../src/lib/db");
  closeDbForTests();
  getDb();
  t.after(() => {
    closeDbForTests();
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const accounts = await import("../src/lib/klaviyo-revenue/accounts");
  const secret = "pk_abcdefghijklmnopqrstuv";
  accounts.persistRevenueAccount(
    {
      id: "kr_saved",
      name: "12volt",
      klaviyoAccountId: "",
      timezone: "America/Chicago",
      currency: "USD",
      keyHint: "",
      bookingMetricId: null,
      bookingMetricName: null,
      bookingDetection: "none",
      formMetricId: "form",
      formMetricName: "Submitted Form",
      formDetection: "auto",
      conversionMetricId: "order",
      conversionMetricName: "Placed Order",
      conversionDetection: "auto",
      smsMetricId: null,
      smsMetricName: null,
      smsDetection: "none",
      createdAt: "2026-10-19T00:00:00Z",
      updatedAt: "2026-10-19T00:00:00Z",
    },
    secret
  );
  const raw = getDb()
    .prepare(`SELECT key, value FROM app_settings WHERE key LIKE 'klaviyo_revenue%'`)
    .all() as Array<{ key: string; value: string }>;
  assert.ok(raw.length >= 2);
  for (const row of raw) assert.equal(row.value.includes(secret), false);
  assert.equal(accounts.readRevenueApiKey("kr_saved"), secret);
  assert.equal(accounts.listRevenueAccounts()[0].keyHint.includes(secret), false);
  accounts.removeRevenueAccount("kr_saved");
  assert.equal(accounts.readRevenueApiKey("kr_saved"), null);
});
