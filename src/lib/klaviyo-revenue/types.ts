/** Shared types for the cross-account Klaviyo revenue dashboard. */

export const AGENCY_TIME_ZONE = "America/New_York";

/** A booking after the text counts only inside this window. */
export const SMS_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A booking this soon after the form is still the same session, even if a
 * text already went out. It is not an abandoned-booking recovery.
 */
export const SMS_ABANDON_GAP_MS = 15 * 60 * 1000;

/** Stop paging profile events past this so one busy account cannot stall the rest. */
export const MAX_EVENTS_PER_METRIC = 3000;

export const CACHE_TTL_MS = 15 * 60 * 1000;

export const SMS_RECOVERY_METHOD =
  "A form fill is abandoned when the person does not book before a text message, unless they book within 15 minutes of the form (same session). It counts as recovered when they book within 7 days after that text. Confirmation texts sent after a booking are ignored. Counts come from each profile's form, text, and booking events. Klaviyo's SMS flow values report sits beside this as a cross-check and can include texts that did not follow a form.";

export const EMAIL_METHOD_AGGREGATE =
  "Revenue and conversions Klaviyo attributes to email, counted on the day the conversion happened ($attributed_channel). Campaign and flow tables are grouped by send, so those totals can differ from this card. The attribution window is the one configured in that Klaviyo account.";

export const EMAIL_METHOD_VALUES =
  "Klaviyo would not group the conversion metric by channel, so this card sums campaign and flow values reports for email sends in the window. That follows send date, not the day the order or booking happened.";

export const BOOKING_METHOD =
  "Count of the metric mapped as Booked appointment, in each account's timezone. Accounts with no booking metric are left blank rather than counted as zero.";

export const FORM_METHOD =
  "Count of the metric mapped as the form fill (usually Submitted Form). One metric per account, so Submitted Form and Form submitted by profile are not added together.";

export type Preset = "7" | "30" | "90" | "custom";

export type DetectionSource = "auto" | "manual" | "none";

export type KlaviyoRevenueAccount = {
  id: string;
  name: string;
  klaviyoAccountId: string;
  timezone: string;
  currency: string;
  keyHint: string;
  bookingMetricId: string | null;
  bookingMetricName: string | null;
  bookingDetection: DetectionSource;
  formMetricId: string | null;
  formMetricName: string | null;
  formDetection: DetectionSource;
  conversionMetricId: string | null;
  conversionMetricName: string | null;
  conversionDetection: DetectionSource;
  smsMetricId: string | null;
  smsMetricName: string | null;
  smsDetection: DetectionSource;
  createdAt: string;
  updatedAt: string;
};

export type CatalogMetric = { id: string; name: string };

export type MetricChoice = { id: string; name: string; score: number };

export type MetricDetection = {
  booking: MetricChoice | null;
  bookingSuggestions: MetricChoice[];
  form: MetricChoice | null;
  formSuggestions: MetricChoice[];
  conversion: MetricChoice | null;
  sms: MetricChoice | null;
  smsSuggestions: MetricChoice[];
};

export type DailyPoint = {
  date: string;
  count: number;
  sumValue: number;
};

export type ReportRow = {
  id: string;
  name: string;
  channel: string;
  conversions: number;
  revenue: number;
};

export type TimelineEvent = {
  profileId: string;
  at: number;
  kind: "form" | "book" | "sms";
  value?: number;
};

export type AccountSnapshot = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  error: string | null;
  warnings: string[];
  booking: {
    status: "value" | "untracked";
    metricName: string | null;
    count: number | null;
    previous: number | null;
    value: number | null;
    emailAttributed: number | null;
    series: DailyPoint[];
  };
  forms: {
    status: "value" | "untracked";
    metricName: string | null;
    count: number | null;
    previous: number | null;
    series: DailyPoint[];
  };
  email: {
    status: "value" | "untracked";
    metricName: string | null;
    method: "metric-aggregate" | "values-report" | "none";
    revenue: number | null;
    previousRevenue: number | null;
    conversions: number | null;
    previousConversions: number | null;
    series: DailyPoint[];
    campaigns: ReportRow[];
    flows: ReportRow[];
  };
  sms: {
    status: "value" | "untracked" | "truncated";
    metricName: string | null;
    formFills: number;
    directBookings: number;
    abandoned: number;
    recovered: number | null;
    previousRecovered: number | null;
    previousAbandoned: number | null;
    recoveryRate: number | null;
    previousRecoveryRate: number | null;
    attributedValue: number | null;
    previousAttributedValue: number | null;
    series: DailyPoint[];
    flowAttributedBookings: number | null;
    flowAttributedValue: number | null;
    truncated: boolean;
    tailRecoveries: number;
  };
};

export type CombinedSnapshot = {
  currency: string | null;
  mixedCurrency: boolean;
  booking: {
    status: "value" | "untracked" | "partial";
    count: number | null;
    previous: number | null;
    trackedAccounts: number;
    untrackedAccounts: number;
    untrackedNames: string[];
  };
  forms: {
    status: "value" | "untracked" | "partial";
    count: number | null;
    previous: number | null;
    trackedAccounts: number;
    untrackedAccounts: number;
    untrackedNames: string[];
  };
  email: {
    status: "value" | "untracked" | "partial";
    revenue: number | null;
    previousRevenue: number | null;
    conversions: number | null;
    previousConversions: number | null;
    trackedAccounts: number;
    untrackedAccounts: number;
    untrackedNames: string[];
    emailAttributedBookings: number | null;
    emailAttributedBookingsStatus: "value" | "untracked" | "partial";
  };
  sms: {
    status: "value" | "untracked" | "partial" | "truncated";
    formFills: number;
    directBookings: number;
    abandoned: number;
    recovered: number | null;
    previousRecovered: number | null;
    recoveryRate: number | null;
    previousRecoveryRate: number | null;
    attributedValue: number | null;
    previousAttributedValue: number | null;
    trackedAccounts: number;
    untrackedAccounts: number;
    untrackedNames: string[];
    truncated: boolean;
    flowAttributedBookings: number | null;
    flowAttributedValue: number | null;
  };
  series: Array<{
    date: string;
    formFills: number | null;
    bookings: number | null;
    emailRevenue: number | null;
    smsRecovered: number | null;
  }>;
};

export type DashboardPayload = {
  demo: boolean;
  canManage: boolean;
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  window: {
    preset: Preset;
    start: string;
    end: string;
    label: string;
    timeZone: string;
    previousStart: string;
    previousEnd: string;
    dayCount: number;
  };
  accounts: AccountSnapshot[];
  combined: CombinedSnapshot;
  notes: string[];
  method: {
    sms: string;
    email: string;
    booking: string;
    forms: string;
  };
};
