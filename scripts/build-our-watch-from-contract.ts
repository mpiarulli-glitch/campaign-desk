/**
 * Build Our Watch snapshot deliverables from the signed Marketing Agreement
 * with Tim Thompson (SOW pages 2–3 / 12–13).
 *
 *   npx tsx scripts/build-our-watch-from-contract.ts
 */
import { getDb, nowIso } from "../src/lib/db";
import { applyContractDeliverables } from "../src/lib/contract-import";
import { createRevClient, updateRevClient } from "../src/lib/revenue";
import { setSnapshotLaunchDate } from "../src/lib/snapshot";

const KNOWN_ID = "QwK26EnPHp6g";
const LAUNCH = "2026-07-16";

const ROWS: Array<{
  category: string;
  team?: string;
  name: string;
  cadence: string;
  kind: "recurring" | "one_time";
  cadenceUnit?: "weekly" | "monthly" | "quarterly";
}> = [
  { category: "Strategy", name: "Go-to-market strategy", cadence: "Quarterly", kind: "recurring", cadenceUnit: "quarterly" },
  { category: "Strategy", name: "Market research", cadence: "One-time", kind: "one_time" },
  { category: "Strategy", name: "Monthly strategy meeting", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },
  { category: "CRM & Automation", team: "email", name: "CRM / email / SMS setup", cadence: "One-time", kind: "one_time" },
  { category: "Strategy", name: "Competitor analysis", cadence: "One-time", kind: "one_time" },
  { category: "SEO", team: "seo", name: "Keyword research", cadence: "One-time", kind: "one_time" },

  { category: "SEO", team: "seo", name: "Google Business Profile management", cadence: "Weekly", kind: "recurring", cadenceUnit: "weekly" },
  { category: "SEO", team: "seo", name: "Directory listing management (up to 60+ directories)", cadence: "One-time", kind: "one_time" },
  { category: "SEO", team: "seo", name: "SEO optimized descriptions", cadence: "One-time", kind: "one_time" },
  { category: "SEO", team: "seo", name: "Blog or content page publishing", cadence: "2 per month", kind: "recurring", cadenceUnit: "monthly" },

  { category: "CRM & Automation", team: "email", name: "Cookie and tracking setup (up to 150 actions/day)", cadence: "One-time", kind: "one_time" },
  { category: "Production", team: "social", name: "Monthly video production", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },
  { category: "Web", team: "web", name: "Funnel / lead magnet development", cadence: "One-time", kind: "one_time" },
  { category: "Web", team: "web", name: "Website optimization updates", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },
  { category: "Web", team: "web", name: "Landing page improvements", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },

  { category: "Email", team: "email", name: "Email marketing campaigns", cadence: "4 per month", kind: "recurring", cadenceUnit: "monthly" },
  { category: "Email", team: "email", name: "Email automation workflows", cadence: "One-time", kind: "one_time" },
  { category: "CRM & Automation", team: "email", name: "Facebook / Instagram auto replies", cadence: "One-time", kind: "one_time" },
  { category: "LinkedIn", team: "email", name: "LinkedIn outreach generation", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },

  { category: "Social", team: "social", name: "Social media content creation", cadence: "5 per week", kind: "recurring", cadenceUnit: "weekly" },
  { category: "Social", team: "social", name: "Social media management (up to 5 platforms)", cadence: "Weekly", kind: "recurring", cadenceUnit: "weekly" },
  { category: "Creative", team: "social", name: "Graphic design support", cadence: "2 per month", kind: "recurring", cadenceUnit: "monthly" },
  { category: "Social", team: "social", name: "Thumbnail creation for YouTube podcasts", cadence: "Monthly", kind: "recurring", cadenceUnit: "monthly" },
  { category: "Social", team: "social", name: "Short-form video content (Reels / Shorts / TikTok)", cadence: "Weekly", kind: "recurring", cadenceUnit: "weekly" },
  { category: "Social", team: "social", name: "YouTube posting and management", cadence: "Weekly", kind: "recurring", cadenceUnit: "weekly" },
];

function resolveClientId(): string {
  const db = getDb();
  const byId = db.prepare(`SELECT id FROM rev_clients WHERE id = ?`).get(KNOWN_ID) as
    | { id: string }
    | undefined;
  if (byId) return byId.id;
  const byName = db
    .prepare(
      `SELECT id FROM rev_clients
        WHERE active = 1 AND lower(name) LIKE '%our watch%'
        ORDER BY created_at ASC LIMIT 1`
    )
    .get() as { id: string } | undefined;
  if (byName) return byName.id;
  return createRevClient({
    name: "Our Watch With Tim Thompson",
    businessModel: "b2b",
    retainer: 5000,
  }).id;
}

function main() {
  const db = getDb();
  const clientId = resolveClientId();

  db.prepare(
    `UPDATE snapshot_deliverables SET active = 0, updated_at = ? WHERE client_id = ? AND active = 1`
  ).run(nowIso(), clientId);

  const { created, skipped } = applyContractDeliverables(
    clientId,
    ROWS.map((r) => ({
      name: r.name,
      category: r.category,
      team: r.team,
      cadence: r.cadence,
      kind: r.kind,
      cadenceUnit: r.cadenceUnit,
    }))
  );

  updateRevClient(clientId, {
    name: "Our Watch With Tim Thompson",
    retainer: 5000,
    contractStart: LAUNCH,
    contractEnd: "2027-01-16",
  });
  setSnapshotLaunchDate(clientId, LAUNCH, { contractMonths: 6 });

  const rows = db
    .prepare(
      `SELECT category, name, cadence, kind, cadence_unit, team
       FROM snapshot_deliverables WHERE client_id = ? AND active = 1
       ORDER BY sort_order`
    )
    .all(clientId);
  console.log(`Created ${created}, skipped ${skipped}`);
  console.log(
    `Account ${clientId}: Our Watch With Tim Thompson · $5,000/mo · launch ${LAUNCH} through 2027-01-16`
  );
  for (const r of rows as Array<Record<string, string>>) {
    console.log(`  [${r.kind}/${r.cadence_unit}] ${r.category} · ${r.name} · ${r.cadence} · ${r.team || "unassigned"}`);
  }
}

main();
