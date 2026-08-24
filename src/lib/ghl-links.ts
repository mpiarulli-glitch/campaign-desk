// Apply exact client → GoHighLevel location matches without a person ticking
// them. The Tools panel still proposes close matches for a human; this path
// only writes the pairs Find matches would have pre-ticked.

import { getDb, nowIso } from "./db";
import { isGhlConfigured, listLocations } from "./ghl";
import { planLinks, type LinkPlan } from "./ghl-tools";
import { listRevClients, updateRevClient } from "./revenue";

/** Write the exact pairs Find matches would have pre-ticked. */
export function applyExactLinkPlan(plan: LinkPlan): { linked: number; names: string[] } {
  const taken = new Set(
    listRevClients(true)
      .map((c) => (c.ghl_location_id || "").trim())
      .filter(Boolean)
  );
  const names: string[] = [];

  for (const p of plan.proposals) {
    if (p.confidence !== "exact") continue;
    const client = listRevClients(true).find((c) => c.id === p.clientId);
    if (!client) continue;
    if ((client.ghl_location_id || "").trim()) continue;
    if (taken.has(p.locationId)) continue;
    updateRevClient(client.id, { ghlLocationId: p.locationId });
    taken.add(p.locationId);
    names.push(client.name);
  }

  return { linked: names.length, names };
}

export async function applyExactGhlLinks(): Promise<{ linked: number; names: string[] }> {
  const clients = listRevClients(true).map((c) => ({
    id: c.id,
    name: c.name,
    ghl_location_id: c.ghl_location_id || "",
  }));
  const locations = (await listLocations()).map((l) => ({ id: l.id, name: l.name }));
  return applyExactLinkPlan(planLinks(clients, locations));
}

const BACKFILL_KEY = "ghl_exact_links_backfill_v1";

function backfillDone(): boolean {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BACKFILL_KEY) as { value: string } | undefined;
  return Boolean(row?.value);
}

function markBackfillDone(summary: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(BACKFILL_KEY, summary, nowIso());
}

export async function runGhlExactLinkBackfillOnce(): Promise<void> {
  try {
    if (backfillDone()) return;
    if (!isGhlConfigured()) return;
    const report = await applyExactGhlLinks();
    const summary = `linked=${report.linked} at=${nowIso()}`;
    markBackfillDone(summary);
    console.log(`[ghl-links] ${summary}`);
    if (report.names.length) {
      console.log(`[ghl-links] linked: ${report.names.join(", ")}`);
    }
  } catch (err) {
    console.error("[ghl-links] failed", (err as Error).message);
  }
}
