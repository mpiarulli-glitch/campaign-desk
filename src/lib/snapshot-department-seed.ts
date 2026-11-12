import type { SnapshotDepartmentSlug } from "./snapshot-department-list";

/**
 * One department assignment per login we can match on the roster.
 *
 *   jack        Jack              Jack Butler       Video
 *   paula       Paula             Paula Loomis      Video
 *   abel        Abel              Abel              Video and SEO
 *   carlos      Carlos            Carlos            Video and SEO
 *   randi       Randi             Randi             Social Media
 *   lana        Lana Verrecchio   Lana              Social Media
 *   mike_hines  Mike Hines        Mike Hines        Ads
 *   saqib       Saqib             Saqib             Web
 *   roy         Roy               Roy               Web
 *   cassidy     Cassidy           Cassidy           Strategy
 *   jerald      Jerald            Jerald            Strategy
 *   kyle_morris Kyle Morris       Kyle Morris       Strategy
 *   luis_romero Luis Romero       Luis Romero       Strategy
 *
 * Abel and Carlos are on both Video and SEO, so the desk shows both sections.
 * Cassidy, Jerald, Kyle Morris, and Luis Romero are Strategy, and they also
 * send the Friday snapshot, so the desk still shows every department.
 *
 * Nathan Box, JC Zipagan, Samar Naeem, and Maroof Rahman are not on the
 * login roster, so they are not seeded. An account added for them later
 * stays unassigned until Michael sets a department on Access.
 *
 * Each slug+department is applied once. Clearing it on Access stays cleared.
 * A row added here later is applied on the next boot when that user exists.
 */
export const SNAPSHOT_DEPARTMENT_SEED: ReadonlyArray<{
  slug: string;
  department: SnapshotDepartmentSlug;
}> = [
  { slug: "jack", department: "video" },
  { slug: "paula", department: "video" },
  { slug: "abel", department: "video" },
  { slug: "abel", department: "seo" },
  { slug: "carlos", department: "video" },
  { slug: "carlos", department: "seo" },
  { slug: "randi", department: "social" },
  { slug: "lana", department: "social" },
  { slug: "mike_hines", department: "ads" },
  { slug: "saqib", department: "web" },
  { slug: "roy", department: "web" },
  { slug: "cassidy", department: "strategy" },
  { slug: "jerald", department: "strategy" },
  { slug: "kyle_morris", department: "strategy" },
  { slug: "luis_romero", department: "strategy" },
];

export const SNAPSHOT_DEPARTMENT_SEED_KEY = "snapshot_department_seed_v1";
