import { listRevClients } from "./revenue";
import { listCampaigns } from "./campaigns";

export type SearchKind = "client" | "campaign";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

// Lightweight in-memory search across the two things people actually jump to:
// clients (→ their hub) and campaigns (→ the campaign page). Case-insensitive
// substring match, ranked by prefix-match first then alphabetical.
export function search(query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: Array<SearchHit & { rank: number }> = [];

  for (const c of listRevClients(true)) {
    const name = c.name.toLowerCase();
    const i = name.indexOf(q);
    if (i === -1) continue;
    hits.push({
      kind: "client",
      id: c.id,
      title: c.name,
      subtitle: c.active ? "Client" : "Client · inactive",
      href: `/admin/clients/${c.id}`,
      rank: i === 0 ? 0 : 1,
    });
  }

  for (const cam of listCampaigns()) {
    const hay = `${cam.title} ${cam.client_name}`.toLowerCase();
    const i = hay.indexOf(q);
    if (i === -1) continue;
    hits.push({
      kind: "campaign",
      id: cam.id,
      title: cam.title,
      subtitle: cam.client_name ? `Campaign · ${cam.client_name}` : "Campaign",
      href: `/admin/campaigns/${cam.id}`,
      rank: cam.title.toLowerCase().startsWith(q) ? 0 : 2,
    });
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ rank: _rank, ...hit }) => hit);
}
