"use client";

import Link from "next/link";

/**
 * Opens the existing create-client form on Client Services.
 * There is no standalone add-client route. The revenue page that used to host
 * the one create form now redirects away, and Deliverable setup → Add account
 * is the form that still POSTs /api/revenue/clients.
 */
export const ADD_CLIENT_HREF = "/admin/client-services?add=1";

/** Client Services hub (deliverable setup and the Friday ask dashboard). */
export const CLIENT_SERVICES_DASHBOARD_HREF = "/admin/client-services";

/**
 * Replaces the Friday ask / Behind report / How to fill links.
 * The dashboard link is left off the Client Services page, the same way the
 * old row left off the link for the page already on screen.
 */
export function SnapshotNavLinks({
  hideDashboard = false,
  onAddClient,
}: {
  hideDashboard?: boolean;
  /** When set, Add client runs here instead of navigating. Used on Client Services. */
  onAddClient?: () => void;
}) {
  return (
    <>
      {onAddClient ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAddClient}>
          Add client
        </button>
      ) : (
        <Link className="btn btn-ghost btn-sm" href={ADD_CLIENT_HREF}>
          Add client
        </Link>
      )}
      {hideDashboard ? null : (
        <Link className="btn btn-ghost btn-sm" href={CLIENT_SERVICES_DASHBOARD_HREF}>
          View Client Services Dashboard
        </Link>
      )}
    </>
  );
}
