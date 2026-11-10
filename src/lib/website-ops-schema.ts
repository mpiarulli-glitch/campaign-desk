// Website Operations tables. Additive only: CREATE TABLE IF NOT EXISTS.
// A production database that does not have these tables gains empty ones.
// Nothing here reads a spreadsheet or writes a row.
//
// Future columns belong in ensureWebsiteOpsSchema as ALTER TABLE, not only
// inside the CREATE, because CREATE is a no-op once the table exists.

import type Database from "better-sqlite3";

export const WEBSITE_OPS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS website_projects (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL,
  project_group TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  tier TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  deliverables TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'active',
  outsource TEXT NOT NULL DEFAULT '',
  owners TEXT NOT NULL DEFAULT '',
  waiting_on TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  start_on TEXT NOT NULL DEFAULT '',
  target_on TEXT NOT NULL DEFAULT '',
  launch_on TEXT NOT NULL DEFAULT '',
  last_touchpoint TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  basecamp_url TEXT NOT NULL DEFAULT '',
  quarter TEXT NOT NULL DEFAULT '',
  coverage INTEGER NOT NULL DEFAULT 0,
  coverage_when TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (client_id) REFERENCES rev_clients(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_website_projects_board
  ON website_projects(board, disposition);
CREATE INDEX IF NOT EXISTS idx_website_projects_target
  ON website_projects(target_on);
`;

export function ensureWebsiteOpsSchema(database: Database.Database): void {
  database.exec(WEBSITE_OPS_SCHEMA_SQL);
  // Fold retired stage names into the shorter list. Safe to run every boot.
  const columns = database.prepare(`PRAGMA table_info(website_projects)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "stage")) return;
  database.exec(`
    UPDATE website_projects SET stage = 'qa' WHERE stage = 'final_qa';
    UPDATE website_projects SET stage = 'briefing' WHERE stage = 'discovery';
    UPDATE website_projects SET stage = 'needs_information' WHERE stage = 'unknown';
  `);
}
