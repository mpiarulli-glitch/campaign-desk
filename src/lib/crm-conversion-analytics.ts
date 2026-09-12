/**
 * Optional CRM conversion rollups for clients on Housecall Pro or HubSpot
 * instead of GoHighLevel.
 */

import {
  getClientIntegration,
  type IntegrationProvider,
} from "./client-integrations";
import {
  emptyClientEmailAnalytics,
  type ClientEmailAnalytics,
} from "./ghl-email-analytics";
import {
  countHousecallJobsInRange,
  HousecallError,
} from "./housecall";
import {
  countHubSpotConversionsInRange,
  HubSpotError,
} from "./hubspot";

export type CrmTrackingSource = {
  provider: IntegrationProvider;
  label: string;
  appointments: number | null;
  formFills: number | null;
  error: string | null;
};

export function resolveCrmClientId(
  clientId: string,
  memberIds: string[],
  provider: IntegrationProvider
): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    const row = getClientIntegration(id, provider);
    if (row?.linked) return id;
  }
  return null;
}

export function clientHasCrmTracking(
  clientId: string,
  memberIds: string[] = []
): boolean {
  return Boolean(
    resolveCrmClientId(clientId, memberIds, "housecall") ||
      resolveCrmClientId(clientId, memberIds, "hubspot")
  );
}

/**
 * Build service-mode analytics from linked CRM(s) when GHL is absent.
 * Housecall Pro → appointments (jobs). HubSpot → form fills + deals as booked.
 */
export async function pullCrmConversionAnalytics(
  clientId: string,
  memberIds: string[],
  start: string,
  end: string
): Promise<{
  analytics: ClientEmailAnalytics;
  sources: CrmTrackingSource[];
}> {
  const analytics = emptyClientEmailAnalytics(start, end, "service");
  const sources: CrmTrackingSource[] = [];

  const housecallId = resolveCrmClientId(clientId, memberIds, "housecall");
  if (housecallId) {
    try {
      const summary = await countHousecallJobsInRange(housecallId, start, end);
      // Prefer scheduled+completed jobs as the "booked" money signal.
      analytics.appointments = summary.jobs;
      sources.push({
        provider: "housecall",
        label: "Housecall Pro",
        appointments: summary.jobs,
        formFills: null,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof HousecallError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Housecall Pro pull failed.";
      analytics.appointmentsError = message;
      sources.push({
        provider: "housecall",
        label: "Housecall Pro",
        appointments: null,
        formFills: null,
        error: message,
      });
    }
  }

  const hubspotId = resolveCrmClientId(clientId, memberIds, "hubspot");
  if (hubspotId) {
    try {
      const summary = await countHubSpotConversionsInRange(hubspotId, start, end);
      analytics.formFills = summary.formFills;
      // Deals created stand in for booked appointments when HCP is not linked.
      if (analytics.appointments == null) {
        analytics.appointments = summary.dealsCreated;
      }
      sources.push({
        provider: "hubspot",
        label: "HubSpot",
        appointments: summary.dealsCreated,
        formFills: summary.formFills,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof HubSpotError
          ? err.message
          : err instanceof Error
            ? err.message
            : "HubSpot pull failed.";
      if (analytics.formFills == null) analytics.formFillsError = message;
      if (analytics.appointments == null) analytics.appointmentsError = message;
      sources.push({
        provider: "hubspot",
        label: "HubSpot",
        appointments: null,
        formFills: null,
        error: message,
      });
    }
  }

  return { analytics, sources };
}
