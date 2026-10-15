// Client-safe shapes for SEO Ops items. No database imports: the forecast
// page and calendar render these, and they must not pull in sqlite.

export const SEO_OPS_SYNC_MARKER = "Synced from SEO Ops";
export const UNMATCHED_CLIENT_LABEL = "Unmatched client";

export type ForecastSyncItemView = {
  id: string;
  date: string;
  itemKey: string;
  kind: "task" | "event";
  bucket: "client" | "internal";
  clientName: string;
  unmatched: boolean;
  title: string;
  hours: number;
  startTime: string | null;
  source: "actual" | "estimate";
};

export type ForecastSyncDayHours = {
  hours: number;
  internalHours: number;
};

/** Hours a Mon–Fri tracked bar should show: timesheet plus synced SEO Ops. */
export function dayBarHours(logged: number, synced: number): number {
  return Math.round(((logged || 0) + (synced || 0)) * 100) / 100;
}
