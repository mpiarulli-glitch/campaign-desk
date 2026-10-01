/**
 * Department KPI: campaign-attributed dollars for home service and B2B.
 *
 * GHL does not invoice the job. This estimates:
 *   email-attributed bookings × ticket (or deal size).
 * Ecommerce (Krak, etc.) is out of this board on purpose.
 */

import { APP_TIME_ZONE } from "./cadence";
import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";
import {
  pullAttributionRollup,
  type AttributionRollupRow,
} from "./email-attribution-rollup";
import { isGhlCampaignNotYetSent } from "./ghl-email-campaign-status";
import type { ClientEmailAnalytics } from "./ghl-email-analytics";
import { getRevClient, listMetrics } from "./revenue";
import type { BusinessModel, RevClient, RevMetric } from "./db";

export const MONEY_MODELS = new Set<BusinessModel>(["home_service", "b2b"]);

export type TicketSource = "set" | "metrics" | "missing";

export type CampaignTicket = {
  amount: number | null;
  source: TicketSource;
};

export type CampaignRevenueRow = {
  clientId: string;
  clientName: string;
  businessModel: BusinessModel;
  attributedAppointments: number;
  attributedFormFills: number;
  ticket: number | null;
  ticketSource: TicketSource;
  estimatedRevenue: number | null;
  error: string | null;
};

export type CampaignRevenueBoard = {
  month: string;
  start: string;
  end: string;
  attributionDays: number;
  fetchedAt: string;
  cached: boolean;
  scanned: number;
  withTicket: number;
  missingTicket: number;
  totals: {
    attributedAppointments: number;
    estimatedRevenue: number;
  };
  rows: CampaignRevenueRow[];
};

const MONTH_RE = /^\d{4}-\d{2}$/;

export function isYearMonth(value: string): boolean {
  if (!MONTH_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function currentYearMonth(now = new Date(), timeZone = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

export function calendarMonthBounds(month: string): { start: string; end: string } {
  if (!isYearMonth(month)) {
    throw new Error("Month must be YYYY-MM.");
  }
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function ticketForClient(
  client: Pick<RevClient, "ltv">,
  metrics: Pick<RevMetric, "revenue" | "orders">[]
): CampaignTicket {
  if (typeof client.ltv === "number" && client.ltv > 0) {
    return { amount: client.ltv, source: "set" };
  }
  for (let i = metrics.length - 1; i >= 0; i--) {
    const row = metrics[i];
    if (row.orders > 0 && row.revenue > 0) {
      return { amount: row.revenue / row.orders, source: "metrics" };
    }
  }
  return { amount: null, source: "missing" };
}

export function emailRowRevenue(
  attributedAppointments: number,
  ticket: number | null,
  pending: boolean
): number | null {
  if (pending || ticket == null) return null;
  return attributedAppointments * ticket;
}

export function estimatedCampaignRevenue(
  attributedAppointments: number,
  ticket: number | null
): number | null {
  if (ticket == null || ticket <= 0) return null;
  return attributedAppointments * ticket;
}

export function isMoneyModel(model: string | null | undefined): boolean {
  return MONEY_MODELS.has((model || "") as BusinessModel);
}

export function campaignRevenueRowFromAttribution(
  row: AttributionRollupRow,
  client: RevClient | null,
  metrics: Pick<RevMetric, "revenue" | "orders">[]
): CampaignRevenueRow | null {
  if (!client || !isMoneyModel(client.business_model)) return null;
  const ticket = ticketForClient(client, metrics);
  return {
    clientId: row.clientId,
    clientName: client.name || row.clientName,
    businessModel: client.business_model,
    attributedAppointments: row.attributedAppointments,
    attributedFormFills: row.attributedFormFills,
    ticket: ticket.amount,
    ticketSource: ticket.source,
    estimatedRevenue: estimatedCampaignRevenue(
      row.attributedAppointments,
      ticket.amount
    ),
    error: row.error,
  };
}

export async function pullCampaignRevenueBoard(options: {
  month?: string | null;
  refresh?: boolean;
  attributionDays?: number;
}): Promise<CampaignRevenueBoard> {
  const month = options.month && isYearMonth(options.month)
    ? options.month
    : currentYearMonth();
  const { start, end } = calendarMonthBounds(month);
  const attributionDays = options.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS;
  const rollup = await pullAttributionRollup({
    range: "custom",
    from: start,
    to: end,
    attributionDays,
    refresh: options.refresh,
  });

  const rows: CampaignRevenueRow[] = [];
  for (const row of [...rollup.wins, ...rollup.others]) {
    const client = getRevClient(row.clientId);
    const built = campaignRevenueRowFromAttribution(
      row,
      client,
      client ? listMetrics(client.id) : []
    );
    if (built) rows.push(built);
  }

  rows.sort(
    (a, b) =>
      (b.estimatedRevenue || 0) - (a.estimatedRevenue || 0) ||
      b.attributedAppointments - a.attributedAppointments ||
      a.clientName.localeCompare(b.clientName)
  );

  const withTicket = rows.filter((r) => r.ticket != null).length;
  return {
    month,
    start,
    end,
    attributionDays,
    fetchedAt: rollup.fetchedAt,
    cached: rollup.cached,
    scanned: rows.length,
    withTicket,
    missingTicket: rows.length - withTicket,
    totals: {
      attributedAppointments: rows.reduce(
        (n, r) => n + r.attributedAppointments,
        0
      ),
      estimatedRevenue: rows.reduce((n, r) => n + (r.estimatedRevenue || 0), 0),
    },
    rows,
  };
}

export function attachServiceMoney(
  analytics: ClientEmailAnalytics,
  clientId: string
): ClientEmailAnalytics {
  const client = getRevClient(clientId);
  if (!client || !isMoneyModel(client.business_model)) {
    return { ...analytics, serviceMoney: null };
  }
  const ticket = ticketForClient(client, listMetrics(client.id));
  const sentCampaigns = analytics.campaigns.filter(
    (row) => !isGhlCampaignNotYetSent(row.status) && row.sent > 0
  );
  let estimated = 0;
  let countable = false;
  if (ticket.amount != null) {
    countable = true;
    for (const row of sentCampaigns) {
      estimated += row.attributedAppointments * ticket.amount;
    }
    for (const row of analytics.flows) {
      estimated += row.attributedAppointments * ticket.amount;
    }
  }
  const sentEmails = sentCampaigns.length;
  return {
    ...analytics,
    serviceMoney: {
      ticket: ticket.amount,
      ticketSource: ticket.source,
      estimatedRevenue: countable ? estimated : null,
      sentEmails,
      revenuePerEmail:
        countable && sentEmails > 0 ? estimated / sentEmails : null,
    },
  };
}
