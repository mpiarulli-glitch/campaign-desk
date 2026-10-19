import { KlaviyoError } from "../klaviyo";
import {
  errorMessage,
  fetchEvents,
  isAuthFailure,
  metricAggregateBody,
  type KlaviyoTransport,
} from "./api";
import { buildAccountSnapshot, type AccountPull } from "./aggregate";
import { emailSeries, parseValuesReport, sumReport, undimensionedSeries } from "./parse";
import {
  SMS_RECOVERY_WINDOW_MS,
  type AccountSnapshot,
  type DailyPoint,
  type KlaviyoRevenueAccount,
  type ReportRow,
} from "./types";
import { diffDays, zonedStartIso, type ResolvedWindow } from "./window";

function iso(ymd: string, timeZone: string): string {
  return zonedStartIso(ymd, timeZone);
}

async function seriesFor(
  transport: KlaviyoTransport,
  metricId: string,
  range: ResolvedWindow,
  timeZone: string,
  by?: string[]
): Promise<DailyPoint[]> {
  const load = async (start: string, end: string) => {
    const body = await transport.post(
      "/metric-aggregates/",
      metricAggregateBody({
        metricId,
        startIso: iso(start, timeZone),
        endIso: iso(end, timeZone),
        timezone: timeZone,
        by,
      })
    );
    return by?.length ? emailSeries(body) : undimensionedSeries(body);
  };
  if (diffDays(range.previousStart, range.end) <= 500) {
    return load(range.previousStart, range.end);
  }
  const previous = await load(range.previousStart, range.previousEnd);
  const current = await load(range.start, range.end);
  return [...previous, ...current];
}

async function reportLoose(
  transport: KlaviyoTransport,
  kind: "campaign" | "flow",
  metricId: string,
  startIso: string,
  endIso: string,
  channel: "email" | "sms"
): Promise<ReportRow[]> {
  const type = kind === "campaign" ? "campaign-values-report" : "flow-values-report";
  const path = kind === "campaign" ? "/campaign-values-reports/" : "/flow-values-reports/";
  const attributes = {
    statistics: ["conversions", "conversion_value", "conversion_uniques"],
    timeframe: { start: startIso, end: endIso },
    conversion_metric_id: metricId,
    filter: `equals(send_channel,"${channel}")`,
  };
  try {
    const body = await transport.post(path, { data: { type, attributes } });
    return parseValuesReport(body).map((row) => (row.channel === "other" ? { ...row, channel } : row));
  } catch (err) {
    if (!(err instanceof KlaviyoError) || err.status !== 400) throw err;
    const { filter: _ignored, ...rest } = attributes;
    void _ignored;
    const body = await transport.post(path, { data: { type, attributes: rest } });
    return parseValuesReport(body).filter((row) => row.channel === channel);
  }
}

async function hydrateNames(
  transport: KlaviyoTransport,
  rows: ReportRow[],
  kind: "campaign" | "flow"
): Promise<void> {
  const resource = kind === "campaign" ? "campaigns" : "flows";
  const field = kind === "campaign" ? "campaign" : "flow";
  for (const row of rows.slice(0, 4)) {
    if (!row.id || row.name !== row.id) continue;
    try {
      const body = (await transport.get(`/${resource}/${row.id}?fields[${field}]=name`)) as {
        data?: { attributes?: { name?: string } };
      };
      const name = body?.data?.attributes?.name?.trim();
      if (name) row.name = name;
    } catch {
      // The value still shows. The name is a convenience.
    }
  }
}

function blankPull(account: KlaviyoRevenueAccount, range: ResolvedWindow, error: string | null): AccountPull {
  return {
    id: account.id,
    name: account.name,
    timezone: account.timezone || range.timeZone,
    currency: account.currency || "USD",
    error,
    warnings: [],
    bookingMetricName: account.bookingMetricName,
    formMetricName: account.formMetricName,
    conversionMetricName: account.conversionMetricName,
    smsMetricName: account.smsMetricName,
    hasBooking: false,
    hasForm: false,
    hasConversion: false,
    hasSms: false,
    range,
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
  };
}

export async function pullAccount(
  account: KlaviyoRevenueAccount,
  range: ResolvedWindow,
  transport: KlaviyoTransport
): Promise<AccountSnapshot> {
  const pull = blankPull(account, range, null);
  const zone = account.timezone || range.timeZone;
  pull.timezone = zone;
  const warnings: string[] = [];

  const guard = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (isAuthFailure(err)) throw err;
      warnings.push(`${label}: ${errorMessage(err)}`);
      return null;
    }
  };

  const dropWarning = (prefix: string) => {
    const index = warnings.findIndex((line) => line.startsWith(prefix));
    if (index >= 0) warnings.splice(index, 1);
  };

  try {
    if (account.formMetricId) {
      const forms = await guard("Form fills", () => seriesFor(transport, account.formMetricId!, range, zone));
      if (forms) {
        pull.hasForm = true;
        pull.forms = forms;
      }
    }

    if (account.bookingMetricId) {
      const bookings = await guard("Booked appointments", () =>
        seriesFor(transport, account.bookingMetricId!, range, zone)
      );
      if (bookings) {
        pull.hasBooking = true;
        pull.bookings = bookings;
      }
      const byChannel = await guard("Email-attributed bookings", () =>
        seriesFor(transport, account.bookingMetricId!, range, zone, ["$attributed_channel"])
      );
      if (byChannel && pull.hasBooking) pull.bookingEmail = byChannel;
    }

    if (account.conversionMetricId) {
      const email = await guard("Email attribution", () =>
        seriesFor(transport, account.conversionMetricId!, range, zone, ["$attributed_channel"])
      );
      if (email) {
        pull.hasConversion = true;
        pull.conversionEmail = email;
        pull.emailMethod = "metric-aggregate";
        const startIso = iso(range.start, zone);
        const endIso = iso(range.end, zone);
        pull.campaigns =
          (await guard("Email campaigns", () =>
            reportLoose(transport, "campaign", account.conversionMetricId!, startIso, endIso, "email")
          )) ?? [];
        pull.flows =
          (await guard("Email flows", () =>
            reportLoose(transport, "flow", account.conversionMetricId!, startIso, endIso, "email")
          )) ?? [];
        await hydrateNames(transport, pull.campaigns, "campaign");
        await hydrateNames(transport, pull.flows, "flow");
      } else {
        const startIso = iso(range.start, zone);
        const endIso = iso(range.end, zone);
        const prevStart = iso(range.previousStart, zone);
        const prevEnd = iso(range.previousEnd, zone);
        const campaigns = await guard("Email campaigns", () =>
          reportLoose(transport, "campaign", account.conversionMetricId!, startIso, endIso, "email")
        );
        const flows = await guard("Email flows", () =>
          reportLoose(transport, "flow", account.conversionMetricId!, startIso, endIso, "email")
        );
        const prevCampaigns = await guard("Previous email campaigns", () =>
          reportLoose(transport, "campaign", account.conversionMetricId!, prevStart, prevEnd, "email")
        );
        const prevFlows = await guard("Previous email flows", () =>
          reportLoose(transport, "flow", account.conversionMetricId!, prevStart, prevEnd, "email")
        );
        if (campaigns && flows && prevCampaigns && prevFlows) {
          dropWarning("Email attribution");
          const now = sumReport([...campaigns, ...flows]);
          const prev = sumReport([...prevCampaigns, ...prevFlows]);
          pull.hasConversion = true;
          pull.emailMethod = "values-report";
          pull.emailValuesFallback = {
            revenue: now.revenue,
            conversions: now.conversions,
            previousRevenue: prev.revenue,
            previousConversions: prev.conversions,
          };
          pull.campaigns = campaigns;
          pull.flows = flows;
          await hydrateNames(transport, pull.campaigns, "campaign");
          await hydrateNames(transport, pull.flows, "flow");
        }
      }
    }

    if (account.bookingMetricId) {
      const smsFlow = await guard("SMS flow attribution", () =>
        reportLoose(
          transport,
          "flow",
          account.bookingMetricId!,
          iso(range.start, zone),
          iso(range.end, zone),
          "sms"
        )
      );
      if (smsFlow) pull.smsFlow = sumReport(smsFlow);
    }

    if (account.formMetricId && account.bookingMetricId && account.smsMetricId) {
      const tail = new Date(Date.parse(iso(range.end, zone)) + SMS_RECOVERY_WINDOW_MS)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      const startIso = iso(range.previousStart, zone);
      const forms = await guard("Form events", () =>
        fetchEvents(transport, account.formMetricId!, startIso, tail, "form")
      );
      const books = await guard("Booking events", () =>
        fetchEvents(transport, account.bookingMetricId!, startIso, tail, "book")
      );
      const texts = await guard("Text events", () =>
        fetchEvents(transport, account.smsMetricId!, startIso, tail, "sms")
      );
      if (forms && books && texts) {
        pull.events = [...forms.events, ...books.events, ...texts.events];
        pull.eventsTruncated = forms.truncated || books.truncated || texts.truncated;
        pull.hasSms = true;
      }
    }
  } catch (err) {
    if (isAuthFailure(err)) {
      return buildAccountSnapshot(blankPull(account, range, errorMessage(err)));
    }
    warnings.push(errorMessage(err));
  }

  pull.warnings = warnings;
  return buildAccountSnapshot(pull);
}
