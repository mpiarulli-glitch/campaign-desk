import { attributeSmsRecoveries } from "./sms-recovery";
import type {
  AccountSnapshot,
  CombinedSnapshot,
  DailyPoint,
  ReportRow,
  TimelineEvent,
} from "./types";
import { eachDate, zonedStartIso } from "./window";

export type AccountPull = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  error: string | null;
  warnings: string[];
  bookingMetricName: string | null;
  formMetricName: string | null;
  conversionMetricName: string | null;
  smsMetricName: string | null;
  hasBooking: boolean;
  hasForm: boolean;
  hasConversion: boolean;
  hasSms: boolean;
  range: { start: string; end: string; previousStart: string; previousEnd: string };
  bookings: DailyPoint[] | null;
  bookingEmail: DailyPoint[] | null;
  forms: DailyPoint[] | null;
  conversionEmail: DailyPoint[] | null;
  campaigns: ReportRow[];
  flows: ReportRow[];
  emailMethod: "metric-aggregate" | "values-report" | "none";
  emailValuesFallback: {
    revenue: number;
    conversions: number;
    previousRevenue: number;
    previousConversions: number;
  } | null;
  events: TimelineEvent[];
  eventsTruncated: boolean;
  smsFlow: { conversions: number; revenue: number } | null;
};

export function sumPoints(points: DailyPoint[], start: string, end: string): { count: number; sumValue: number } {
  let count = 0;
  let sumValue = 0;
  for (const point of points) {
    if (point.date >= start && point.date < end) {
      count += point.count;
      sumValue += point.sumValue;
    }
  }
  return { count, sumValue };
}

export function slicePoints(points: DailyPoint[], start: string, end: string): DailyPoint[] {
  const byDate = new Map(points.filter((p) => p.date >= start && p.date < end).map((p) => [p.date, p]));
  return eachDate(start, end).map((date) => byDate.get(date) ?? { date, count: 0, sumValue: 0 });
}

export function deltaRatio(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

function topRows(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions).slice(0, 8);
}

function rangeMs(start: string, end: string, timeZone: string): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(zonedStartIso(start, timeZone)),
    endMs: Date.parse(zonedStartIso(end, timeZone)),
  };
}

export function emptySnapshot(input: {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  error: string | null;
  warnings?: string[];
  range: AccountPull["range"];
}): AccountSnapshot {
  return buildAccountSnapshot({
    id: input.id,
    name: input.name,
    timezone: input.timezone,
    currency: input.currency,
    error: input.error,
    warnings: input.warnings ?? [],
    bookingMetricName: null,
    formMetricName: null,
    conversionMetricName: null,
    smsMetricName: null,
    hasBooking: false,
    hasForm: false,
    hasConversion: false,
    hasSms: false,
    range: input.range,
    bookings: null,
    bookingEmail: null,
    forms: null,
    conversionEmail: null,
    campaigns: [],
    flows: [],
    emailMethod: "none",
    emailValuesFallback: null,
    events: [],
    eventsTruncated: false,
    smsFlow: null,
  });
}

export function buildAccountSnapshot(pull: AccountPull): AccountSnapshot {
  const { start, end, previousStart, previousEnd } = pull.range;
  const bookingPoints = pull.hasBooking && pull.bookings ? pull.bookings : null;
  const formPoints = pull.hasForm && pull.forms ? pull.forms : null;
  const bookingNow = bookingPoints ? sumPoints(bookingPoints, start, end) : null;
  const bookingPrev = bookingPoints ? sumPoints(bookingPoints, previousStart, previousEnd) : null;
  const formNow = formPoints ? sumPoints(formPoints, start, end) : null;
  const formPrev = formPoints ? sumPoints(formPoints, previousStart, previousEnd) : null;
  const emailPoints = pull.hasConversion && pull.conversionEmail ? pull.conversionEmail : null;
  const emailNow = emailPoints ? sumPoints(emailPoints, start, end) : null;
  const emailPrev = emailPoints ? sumPoints(emailPoints, previousStart, previousEnd) : null;
  const bookingEmailNow =
    pull.hasBooking && pull.bookingEmail ? sumPoints(pull.bookingEmail, start, end).count : null;

  let emailRevenue = emailNow?.sumValue ?? null;
  let emailConversions = emailNow?.count ?? null;
  let emailPrevRevenue = emailPrev?.sumValue ?? null;
  let emailPrevConversions = emailPrev?.count ?? null;
  let emailMethod = pull.emailMethod;
  if (pull.hasConversion && emailPoints == null && pull.emailValuesFallback) {
    emailRevenue = pull.emailValuesFallback.revenue;
    emailConversions = pull.emailValuesFallback.conversions;
    emailPrevRevenue = pull.emailValuesFallback.previousRevenue;
    emailPrevConversions = pull.emailValuesFallback.previousConversions;
    emailMethod = "values-report";
  }
  if (!pull.hasConversion) {
    emailRevenue = null;
    emailConversions = null;
    emailPrevRevenue = null;
    emailPrevConversions = null;
    emailMethod = "none";
  }

  const canRecover = pull.hasForm && pull.hasBooking && pull.hasSms && !pull.error;
  let sms: AccountSnapshot["sms"];
  if (!canRecover) {
    sms = {
      status: "untracked",
      metricName: pull.smsMetricName,
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
    };
  } else {
    const current = attributeSmsRecoveries(pull.events, {
      ...rangeMs(start, end, pull.timezone),
      timeZone: pull.timezone,
    });
    const previous = attributeSmsRecoveries(pull.events, {
      ...rangeMs(previousStart, previousEnd, pull.timezone),
      timeZone: pull.timezone,
    });
    const series = slicePoints(current.series, start, end);
    sms = {
      status: pull.eventsTruncated ? "truncated" : "value",
      metricName: pull.smsMetricName,
      formFills: current.formFills,
      directBookings: current.directBookings,
      abandoned: current.abandoned,
      recovered: current.recovered,
      previousRecovered: previous.recovered,
      previousAbandoned: previous.abandoned,
      recoveryRate: current.recoveryRate,
      previousRecoveryRate: previous.recoveryRate,
      attributedValue: current.attributedValue,
      previousAttributedValue: previous.attributedValue,
      series,
      flowAttributedBookings: pull.smsFlow?.conversions ?? null,
      flowAttributedValue: pull.smsFlow?.revenue ?? null,
      truncated: pull.eventsTruncated,
      tailRecoveries: current.tailRecoveries,
    };
  }

  return {
    id: pull.id,
    name: pull.name,
    timezone: pull.timezone,
    currency: pull.currency || "USD",
    error: pull.error,
    warnings: pull.warnings,
    booking: {
      status: pull.hasBooking ? "value" : "untracked",
      metricName: pull.bookingMetricName,
      count: pull.hasBooking ? bookingNow?.count ?? 0 : null,
      previous: pull.hasBooking ? bookingPrev?.count ?? 0 : null,
      value: pull.hasBooking ? bookingNow?.sumValue ?? 0 : null,
      emailAttributed: pull.hasBooking ? bookingEmailNow : null,
      series: pull.hasBooking && bookingPoints ? slicePoints(bookingPoints, start, end) : [],
    },
    forms: {
      status: pull.hasForm ? "value" : "untracked",
      metricName: pull.formMetricName,
      count: pull.hasForm ? formNow?.count ?? 0 : null,
      previous: pull.hasForm ? formPrev?.count ?? 0 : null,
      series: pull.hasForm && formPoints ? slicePoints(formPoints, start, end) : [],
    },
    email: {
      status: pull.hasConversion ? "value" : "untracked",
      metricName: pull.conversionMetricName,
      method: emailMethod,
      revenue: pull.hasConversion ? emailRevenue ?? 0 : null,
      previousRevenue: pull.hasConversion ? emailPrevRevenue ?? 0 : null,
      conversions: pull.hasConversion ? emailConversions ?? 0 : null,
      previousConversions: pull.hasConversion ? emailPrevConversions ?? 0 : null,
      series: pull.hasConversion && emailPoints ? slicePoints(emailPoints, start, end) : [],
      campaigns: topRows(pull.campaigns.filter((row) => row.channel === "email" || row.channel === "other")),
      flows: topRows(pull.flows.filter((row) => row.channel === "email" || row.channel === "other")),
    },
    sms,
  };
}

type NumField = {
  status: "value" | "untracked" | "partial";
  value: number | null;
  previous: number | null;
  trackedAccounts: number;
  untrackedAccounts: number;
  untrackedNames: string[];
};

function combineCount(
  rows: Array<{ name: string; status: "value" | "untracked" | "truncated"; value: number | null; previous: number | null }>
): NumField & { truncated: boolean } {
  const tracked = rows.filter((row) => row.status !== "untracked" && row.value != null);
  const untracked = rows.filter((row) => row.status === "untracked" || row.value == null);
  const truncated = rows.some((row) => row.status === "truncated");
  if (!tracked.length) {
    return {
      status: "untracked",
      value: null,
      previous: null,
      trackedAccounts: 0,
      untrackedAccounts: rows.length,
      untrackedNames: untracked.map((row) => row.name),
      truncated,
    };
  }
  const value = tracked.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const previous = tracked.every((row) => row.previous != null)
    ? tracked.reduce((sum, row) => sum + (row.previous ?? 0), 0)
    : null;
  return {
    status: untracked.length ? "partial" : truncated ? "value" : "value",
    value,
    previous,
    trackedAccounts: tracked.length,
    untrackedAccounts: untracked.length,
    untrackedNames: untracked.map((row) => row.name),
    truncated,
  };
}

export function combineAccounts(accounts: AccountSnapshot[], start: string, end: string): CombinedSnapshot {
  const booking = combineCount(
    accounts.map((account) => ({
      name: account.name,
      status: account.booking.status,
      value: account.booking.count,
      previous: account.booking.previous,
    }))
  );
  const forms = combineCount(
    accounts.map((account) => ({
      name: account.name,
      status: account.forms.status,
      value: account.forms.count,
      previous: account.forms.previous,
    }))
  );
  const emailCounts = combineCount(
    accounts.map((account) => ({
      name: account.name,
      status: account.email.status,
      value: account.email.conversions,
      previous: account.email.previousConversions,
    }))
  );

  const revenueRows = accounts.filter((account) => account.email.status === "value" && account.email.revenue != null);
  const currencies = [...new Set(revenueRows.map((account) => account.currency || "USD"))];
  const mixedCurrency = currencies.length > 1;
  const revenueCurrency = currencies.length === 1 ? currencies[0] : null;
  const emailRevenue = !revenueRows.length
    ? null
    : mixedCurrency
      ? null
      : revenueRows.reduce((sum, account) => sum + (account.email.revenue ?? 0), 0);
  const emailPrevRevenue =
    !revenueRows.length || mixedCurrency
      ? null
      : revenueRows.every((account) => account.email.previousRevenue != null)
        ? revenueRows.reduce((sum, account) => sum + (account.email.previousRevenue ?? 0), 0)
        : null;
  const emailUntracked = accounts.filter((account) => account.email.status !== "value");

  const bookingEmailRows = accounts.filter(
    (account) => account.booking.status === "value" && account.booking.emailAttributed != null
  );
  const emailAttributedBookings = bookingEmailRows.length
    ? bookingEmailRows.reduce((sum, account) => sum + (account.booking.emailAttributed ?? 0), 0)
    : null;

  const smsTracked = accounts.filter((account) => account.sms.status !== "untracked" && account.sms.recovered != null);
  const smsUntracked = accounts.filter((account) => account.sms.status === "untracked" || account.sms.recovered == null);
  const smsTruncated = accounts.some((account) => account.sms.truncated);
  const smsValueCurrencies = [
    ...new Set(smsTracked.map((account) => account.currency || "USD")),
  ];
  const smsMixed = smsValueCurrencies.length > 1;
  let smsRecovered: number | null = null;
  let smsPrev: number | null = null;
  let smsRate: number | null = null;
  let smsPrevRate: number | null = null;
  let smsValue: number | null = null;
  let smsPrevValue: number | null = null;
  let smsFills = 0;
  let smsDirect = 0;
  let smsAbandoned = 0;
  if (smsTracked.length) {
    smsRecovered = smsTracked.reduce((sum, account) => sum + (account.sms.recovered ?? 0), 0);
    smsPrev = smsTracked.every((account) => account.sms.previousRecovered != null)
      ? smsTracked.reduce((sum, account) => sum + (account.sms.previousRecovered ?? 0), 0)
      : null;
    smsFills = smsTracked.reduce((sum, account) => sum + account.sms.formFills, 0);
    smsDirect = smsTracked.reduce((sum, account) => sum + account.sms.directBookings, 0);
    smsAbandoned = smsTracked.reduce((sum, account) => sum + account.sms.abandoned, 0);
    const denom = smsAbandoned + (smsRecovered ?? 0);
    smsRate = denom > 0 ? (smsRecovered ?? 0) / denom : null;
    if (smsPrev != null && smsTracked.every((account) => account.sms.previousAbandoned != null)) {
      const prevAbandoned = smsTracked.reduce((sum, account) => sum + (account.sms.previousAbandoned ?? 0), 0);
      const prevDenom = prevAbandoned + smsPrev;
      smsPrevRate = prevDenom > 0 ? smsPrev / prevDenom : null;
    }
    if (!smsMixed) {
      smsValue = smsTracked.reduce((sum, account) => sum + (account.sms.attributedValue ?? 0), 0);
      smsPrevValue = smsTracked.every((account) => account.sms.previousAttributedValue != null)
        ? smsTracked.reduce((sum, account) => sum + (account.sms.previousAttributedValue ?? 0), 0)
        : null;
    }
  }
  const flowRows = smsTracked.filter((account) => account.sms.flowAttributedBookings != null);
  const flowBookings = flowRows.length
    ? flowRows.reduce((sum, account) => sum + (account.sms.flowAttributedBookings ?? 0), 0)
    : null;
  const flowValue =
    flowRows.length && !smsMixed
      ? flowRows.reduce((sum, account) => sum + (account.sms.flowAttributedValue ?? 0), 0)
      : null;

  const dates = eachDate(start, end);
  const series = dates.map((date) => {
    const trackedForms = accounts.filter((account) => account.forms.status === "value");
    const trackedBookings = accounts.filter((account) => account.booking.status === "value");
    const trackedEmail = accounts.filter(
      (account) => account.email.status === "value" && !mixedCurrency && account.email.series.length
    );
    const trackedSms = accounts.filter((account) => account.sms.status !== "untracked");
    const at = (rows: AccountSnapshot[], pick: (account: AccountSnapshot) => DailyPoint[]) => {
      let total = 0;
      for (const account of rows) {
        const point = pick(account).find((row) => row.date === date);
        total += point?.count ?? 0;
      }
      return total;
    };
    const money = (rows: AccountSnapshot[]) => {
      let total = 0;
      for (const account of rows) {
        const point = account.email.series.find((row) => row.date === date);
        total += point?.sumValue ?? 0;
      }
      return total;
    };
    return {
      date,
      formFills: trackedForms.length ? at(trackedForms, (account) => account.forms.series) : null,
      bookings: trackedBookings.length ? at(trackedBookings, (account) => account.booking.series) : null,
      emailRevenue: trackedEmail.length && !mixedCurrency ? money(trackedEmail) : null,
      smsRecovered: trackedSms.length ? at(trackedSms, (account) => account.sms.series) : null,
    };
  });

  const smsStatus: CombinedSnapshot["sms"]["status"] = !smsTracked.length
    ? "untracked"
    : smsUntracked.length
      ? "partial"
      : smsTruncated
        ? "truncated"
        : "value";

  return {
    currency: revenueCurrency,
    mixedCurrency,
    booking: {
      status: booking.status,
      count: booking.value,
      previous: booking.previous,
      trackedAccounts: booking.trackedAccounts,
      untrackedAccounts: booking.untrackedAccounts,
      untrackedNames: booking.untrackedNames,
    },
    forms: {
      status: forms.status,
      count: forms.value,
      previous: forms.previous,
      trackedAccounts: forms.trackedAccounts,
      untrackedAccounts: forms.untrackedAccounts,
      untrackedNames: forms.untrackedNames,
    },
    email: {
      status: !revenueRows.length ? "untracked" : emailUntracked.length || mixedCurrency ? "partial" : "value",
      revenue: emailRevenue,
      previousRevenue: emailPrevRevenue,
      conversions: emailCounts.value,
      previousConversions: emailCounts.previous,
      trackedAccounts: revenueRows.length,
      untrackedAccounts: emailUntracked.length,
      untrackedNames: emailUntracked.map((account) => account.name),
      emailAttributedBookings,
      emailAttributedBookingsStatus: !bookingEmailRows.length
        ? "untracked"
        : bookingEmailRows.length === accounts.filter((account) => account.booking.status === "value").length
          ? "value"
          : "partial",
    },
    sms: {
      status: smsStatus,
      formFills: smsFills,
      directBookings: smsDirect,
      abandoned: smsAbandoned,
      recovered: smsRecovered,
      previousRecovered: smsPrev,
      recoveryRate: smsRate,
      previousRecoveryRate: smsPrevRate,
      attributedValue: smsValue,
      previousAttributedValue: smsPrevValue,
      trackedAccounts: smsTracked.length,
      untrackedAccounts: smsUntracked.length,
      untrackedNames: smsUntracked.map((account) => account.name),
      truncated: smsTruncated,
      flowAttributedBookings: flowBookings,
      flowAttributedValue: flowValue,
    },
    series,
  };
}
