/**
 * Ensure Marketing Empire Group exists as a Lifecycle hub client with its
 * own GHL location linked — so agency email → booking attribution is included
 * in the same rollup as client accounts.
 */

import { listLocations } from "./ghl";
import { addClientToHub } from "./lifecycle-hub";
import {
  createRevClient,
  listRevClients,
  updateRevClient,
} from "./revenue";

const MEG_NAMES = [
  "Marketing Empire Group",
  "Marketing Empire",
  "MEG",
];

export type EnsureMegResult = {
  clientId: string;
  clientName: string;
  locationId: string;
  created: boolean;
  locationUpdated: boolean;
  hubAdded: boolean;
  hubError: string | null;
};

function looksLikeMeg(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (n === "meg") return true;
  if (n.includes("marketing empire")) return true;
  return false;
}

async function resolveMegLocationId(): Promise<string> {
  const fromEnv = (process.env.GHL_OPPORTUNITIES_LOCATION_ID || "").trim();
  if (fromEnv) return fromEnv;

  const locations = await listLocations();
  const hit = locations.find((l) => looksLikeMeg(l.name || ""));
  if (hit?.id) return hit.id.trim();
  throw new Error(
    "Could not find a GHL location for Marketing Empire Group. Set GHL_OPPORTUNITIES_LOCATION_ID."
  );
}

export async function ensureMegLifecycleClient(): Promise<EnsureMegResult> {
  const locationId = await resolveMegLocationId();
  const existing = listRevClients(true).find((c) => looksLikeMeg(c.name));

  let clientId: string;
  let clientName: string;
  let created = false;
  let locationUpdated = false;

  if (existing) {
    clientId = existing.id;
    clientName = existing.name;
    if ((existing.ghl_location_id || "").trim() !== locationId) {
      updateRevClient(clientId, { ghlLocationId: locationId });
      locationUpdated = true;
    }
    if (!existing.active) {
      updateRevClient(clientId, { active: true });
    }
    // Prefer the canonical name if they were saved as "MEG" etc.
    if (existing.name.trim() !== "Marketing Empire Group") {
      updateRevClient(clientId, { name: "Marketing Empire Group" });
      clientName = "Marketing Empire Group";
    }
  } else {
    const createdClient = createRevClient({
      name: "Marketing Empire Group",
      businessModel: "b2b",
      ghlLocationId: locationId,
      retainer: 0,
      monthlyCost: 0,
    });
    clientId = createdClient.id;
    clientName = createdClient.name;
    created = true;
  }

  // Automations-only hub seat (no launch checklist) — board card for this period.
  const hub = addClientToHub(clientId, null, "michael");
  return {
    clientId,
    clientName,
    locationId,
    created,
    locationUpdated,
    hubAdded: hub.ok,
    hubError: hub.ok ? null : hub.error,
  };
}

export function isMegClientName(name: string): boolean {
  return looksLikeMeg(name);
}

/** Exported for tests / callers that only need the name list. */
export const MEG_CLIENT_NAMES = MEG_NAMES;
