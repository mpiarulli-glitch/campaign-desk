import { combineAccounts } from "./aggregate";
import {
  BOOKING_METHOD,
  EMAIL_METHOD_AGGREGATE,
  FORM_METHOD,
  SMS_RECOVERY_METHOD,
  type AccountSnapshot,
  type DailyPoint,
  type DashboardPayload,
  type ReportRow,
} from "./types";
import { diffDays, eachDate, type ResolvedWindow } from "./window";

function dayWeights(dates: string[], seed: number, weekendFactor: number): number[] {
  return dates.map((date, index) => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const wave = 0.7 + 0.3 * Math.sin(index / 2.7 + seed);
    return Math.max(0.08, wave * (weekend ? weekendFactor : 1));
  });
}

function splitTotal(total: number, weights: number[]): number[] {
  const acc = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const raw = weights.map((weight) => (weight / acc) * total);
  const floors = raw.map((value) => Math.floor(value));
  const left = Math.round(total) - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < left; i++) floors[order[i % floors.length].index] += 1;
  return floors;
}

function countSeries(total: number, dates: string[], seed: number, weekendFactor: number): DailyPoint[] {
  const counts = splitTotal(total, dayWeights(dates, seed, weekendFactor));
  return dates.map((date, index) => ({ date, count: counts[index], sumValue: 0 }));
}

function moneySeries(
  revenue: number,
  conversions: number,
  dates: string[],
  seed: number,
  weekendFactor: number
): DailyPoint[] {
  const weights = dayWeights(dates, seed, weekendFactor);
  const counts = splitTotal(conversions, weights);
  const dollars = splitTotal(revenue, weights);
  return dates.map((date, index) => ({ date, count: counts[index], sumValue: dollars[index] }));
}

function valuedCounts(points: DailyPoint[], totalValue: number): DailyPoint[] {
  const counts = points.reduce((sum, point) => sum + point.count, 0);
  if (!counts) return points.map((point) => ({ ...point, sumValue: 0 }));
  let assigned = 0;
  return points.map((point, index) => {
    if (index === points.length - 1) {
      return { ...point, sumValue: Math.round((totalValue - assigned) * 100) / 100 };
    }
    const share = Math.round(((totalValue * point.count) / counts) * 100) / 100;
    assigned += share;
    return { ...point, sumValue: share };
  });
}

function rows(entries: Array<[string, number, number]>): ReportRow[] {
  return entries.map(([name, revenue, conversions]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    channel: "email",
    conversions,
    revenue,
  }));
}

function base(input: {
  id: string;
  name: string;
  timezone: string;
  currency?: string;
}): Pick<AccountSnapshot, "id" | "name" | "timezone" | "currency" | "error" | "warnings"> {
  return {
    id: input.id,
    name: input.name,
    timezone: input.timezone,
    currency: input.currency ?? "USD",
    error: null,
    warnings: [],
  };
}

export function buildFixtureAccounts(range: ResolvedWindow): AccountSnapshot[] {
  const dates = eachDate(range.start, range.end);
  const days = Math.max(1, diffDays(range.start, range.end));
  const scale = (perDay: number) => Math.max(0, Math.round(perDay * days));

  const voltForms = scale(28);
  const voltRevenue = scale(1550);
  const voltOrders = scale(10);
  const volt: AccountSnapshot = {
    ...base({ id: "fix-12volt", name: "12volt", timezone: "America/Chicago" }),
    booking: {
      status: "untracked",
      metricName: null,
      count: null,
      previous: null,
      value: null,
      emailAttributed: null,
      series: [],
    },
    forms: {
      status: "value",
      metricName: "Submitted Form",
      count: voltForms,
      previous: Math.round(voltForms * 0.92),
      series: countSeries(voltForms, dates, 1.2, 0.72),
    },
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: voltRevenue,
      previousRevenue: Math.round(voltRevenue * 0.91),
      conversions: voltOrders,
      previousConversions: Math.round(voltOrders * 0.9),
      series: moneySeries(voltRevenue, voltOrders, dates, 0.4, 0.7),
      campaigns: rows([
        ["October battery drop", Math.round(voltRevenue * 0.34), Math.round(voltOrders * 0.31)],
        ["Weekend install offer", Math.round(voltRevenue * 0.22), Math.round(voltOrders * 0.24)],
        ["Back in stock: AGM", Math.round(voltRevenue * 0.16), Math.round(voltOrders * 0.15)],
      ]),
      flows: rows([
        ["Abandoned checkout", Math.round(voltRevenue * 0.18), Math.round(voltOrders * 0.19)],
        ["Welcome", Math.round(voltRevenue * 0.1), Math.round(voltOrders * 0.11)],
      ]),
    },
    sms: {
      status: "untracked",
      metricName: "Received SMS",
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

  const hendoForms = scale(8);
  const hendoRevenue = scale(118);
  const hendoOrders = scale(2.4);
  const hendos: AccountSnapshot = {
    ...base({ id: "fix-hendos", name: "Hendos", timezone: "America/New_York" }),
    booking: {
      status: "untracked",
      metricName: null,
      count: null,
      previous: null,
      value: null,
      emailAttributed: null,
      series: [],
    },
    forms: {
      status: "value",
      metricName: "Submitted Form",
      count: hendoForms,
      previous: Math.round(hendoForms * 0.88),
      series: countSeries(hendoForms, dates, 2.4, 1.45),
    },
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: hendoRevenue,
      previousRevenue: Math.round(hendoRevenue * 0.86),
      conversions: hendoOrders,
      previousConversions: Math.round(hendoOrders * 0.84),
      series: moneySeries(hendoRevenue, hendoOrders, dates, 1.7, 1.4),
      campaigns: rows([
        ["Thursday pasta night", Math.round(hendoRevenue * 0.41), Math.round(hendoOrders * 0.38)],
        ["Sunday family table", Math.round(hendoRevenue * 0.27), Math.round(hendoOrders * 0.3)],
      ]),
      flows: rows([["Winback 30 day", Math.round(hendoRevenue * 0.32), Math.round(hendoOrders * 0.32)]]),
    },
    sms: {
      status: "untracked",
      metricName: "Received Text Message",
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

  const apexForms = scale(9.2);
  const apexDirect = Math.round(apexForms * 0.34);
  const apexRecovered = Math.max(1, Math.round(apexForms * 0.08));
  const apexAbandoned = Math.max(0, apexForms - apexDirect - apexRecovered);
  const apexBookings = apexDirect + apexRecovered + Math.round(apexForms * 0.08);
  const apexRevenue = scale(610);
  const apexOrders = scale(3.1);
  const apexValue = apexRecovered * 185;
  const apexRecoveredSeries = valuedCounts(
    countSeries(apexRecovered, dates, 0.9, 0.4),
    apexValue
  );
  const apex: AccountSnapshot = {
    ...base({ id: "fix-apex", name: "Apex Med Spa", timezone: "America/New_York" }),
    booking: {
      status: "value",
      metricName: "Booked Appointment",
      count: apexBookings,
      previous: Math.round(apexBookings * 0.9),
      value: apexBookings * 180,
      emailAttributed: Math.round(apexBookings * 0.27),
      series: countSeries(apexBookings, dates, 0.6, 0.45),
    },
    forms: {
      status: "value",
      metricName: "Submitted Form",
      count: apexForms,
      previous: Math.round(apexForms * 0.93),
      series: countSeries(apexForms, dates, 0.2, 0.5),
    },
    email: {
      status: "value",
      metricName: "Placed Order",
      method: "metric-aggregate",
      revenue: apexRevenue,
      previousRevenue: Math.round(apexRevenue * 0.87),
      conversions: apexOrders,
      previousConversions: Math.round(apexOrders * 0.85),
      series: moneySeries(apexRevenue, apexOrders, dates, 1.1, 0.48),
      campaigns: rows([
        ["New client facial", Math.round(apexRevenue * 0.46), Math.round(apexOrders * 0.44)],
        ["October fillers", Math.round(apexRevenue * 0.28), Math.round(apexOrders * 0.3)],
      ]),
      flows: rows([["Consult abandoned", Math.round(apexRevenue * 0.26), Math.round(apexOrders * 0.26)]]),
    },
    sms: {
      status: "value",
      metricName: "Received SMS",
      formFills: apexForms,
      directBookings: apexDirect,
      abandoned: apexAbandoned,
      recovered: apexRecovered,
      previousRecovered: Math.round(apexRecovered * 0.82),
      previousAbandoned: Math.round(apexAbandoned * 0.96),
      recoveryRate: apexAbandoned + apexRecovered > 0 ? apexRecovered / (apexAbandoned + apexRecovered) : null,
      previousRecoveryRate: null,
      attributedValue: apexValue,
      previousAttributedValue: Math.round(apexRecovered * 0.82) * 185,
      series: apexRecoveredSeries,
      flowAttributedBookings: Math.round(apexRecovered * 1.15),
      flowAttributedValue: Math.round(apexValue * 1.2),
      truncated: false,
      tailRecoveries: 0,
    },
  };
  const apexPrevDenom = (apex.sms.previousAbandoned ?? 0) + (apex.sms.previousRecovered ?? 0);
  apex.sms.previousRecoveryRate =
    apexPrevDenom > 0 ? (apex.sms.previousRecovered ?? 0) / apexPrevDenom : null;

  const lumenForms = scale(13.5);
  const lumenDirect = Math.round(lumenForms * 0.37);
  const lumenRecovered = Math.max(1, Math.round(lumenForms * 0.11));
  const lumenAbandoned = Math.max(0, lumenForms - lumenDirect - lumenRecovered);
  const lumenBookings = lumenDirect + lumenRecovered + Math.round(lumenForms * 0.06);
  const lumenRevenue = scale(420);
  const lumenConversions = scale(4.4);
  const lumenValue = lumenRecovered * 89;
  const lumen: AccountSnapshot = {
    ...base({ id: "fix-lumen", name: "Lumen Fitness", timezone: "America/Denver" }),
    booking: {
      status: "value",
      metricName: "Schedule Confirmed",
      count: lumenBookings,
      previous: Math.round(lumenBookings * 0.94),
      value: lumenBookings * 89,
      emailAttributed: lumenConversions,
      series: countSeries(lumenBookings, dates, 2.1, 0.62),
    },
    forms: {
      status: "value",
      metricName: "Form submitted by profile",
      count: lumenForms,
      previous: Math.round(lumenForms * 0.9),
      series: countSeries(lumenForms, dates, 1.4, 0.66),
    },
    email: {
      status: "value",
      metricName: "Schedule Confirmed",
      method: "metric-aggregate",
      revenue: lumenRevenue,
      previousRevenue: Math.round(lumenRevenue * 0.89),
      conversions: lumenConversions,
      previousConversions: Math.round(lumenConversions * 0.88),
      series: moneySeries(lumenRevenue, lumenConversions, dates, 2.2, 0.6),
      campaigns: rows([
        ["Foundations challenge", Math.round(lumenRevenue * 0.52), Math.round(lumenConversions * 0.5)],
      ]),
      flows: rows([
        ["Trial no-show", Math.round(lumenRevenue * 0.3), Math.round(lumenConversions * 0.31)],
        ["Welcome to the floor", Math.round(lumenRevenue * 0.18), Math.round(lumenConversions * 0.19)],
      ]),
    },
    sms: {
      status: "value",
      metricName: "Received SMS",
      formFills: lumenForms,
      directBookings: lumenDirect,
      abandoned: lumenAbandoned,
      recovered: lumenRecovered,
      previousRecovered: Math.round(lumenRecovered * 0.78),
      previousAbandoned: Math.round(lumenAbandoned * 0.97),
      recoveryRate:
        lumenAbandoned + lumenRecovered > 0 ? lumenRecovered / (lumenAbandoned + lumenRecovered) : null,
      previousRecoveryRate: null,
      attributedValue: lumenValue,
      previousAttributedValue: Math.round(lumenRecovered * 0.78) * 89,
      series: valuedCounts(countSeries(lumenRecovered, dates, 1.8, 0.55), lumenValue),
      flowAttributedBookings: lumenRecovered + 3,
      flowAttributedValue: lumenValue + 89,
      truncated: false,
      tailRecoveries: 0,
    },
  };
  const lumenPrevDenom = (lumen.sms.previousAbandoned ?? 0) + (lumen.sms.previousRecovered ?? 0);
  lumen.sms.previousRecoveryRate =
    lumenPrevDenom > 0 ? (lumen.sms.previousRecovered ?? 0) / lumenPrevDenom : null;

  return [volt, hendos, apex, lumen];
}

export function buildFixtureDashboard(
  range: ResolvedWindow,
  opts: { canManage: boolean; fetchedAt: string }
): DashboardPayload {
  const accounts = buildFixtureAccounts(range);
  return {
    demo: true,
    canManage: opts.canManage,
    fetchedAt: opts.fetchedAt,
    fromCache: false,
    stale: false,
    window: {
      preset: range.preset,
      start: range.start,
      end: range.end,
      label: range.label,
      timeZone: range.timeZone,
      previousStart: range.previousStart,
      previousEnd: range.previousEnd,
      dayCount: range.dayCount,
    },
    accounts,
    combined: combineAccounts(accounts, range.start, range.end),
    notes: [
      "Sample accounts, so you can see the shape before a key is connected. 12volt and Hendos have no booked-appointment metric.",
    ],
    method: {
      sms: SMS_RECOVERY_METHOD,
      email: EMAIL_METHOD_AGGREGATE,
      booking: BOOKING_METHOD,
      forms: FORM_METHOD,
    },
  };
}
