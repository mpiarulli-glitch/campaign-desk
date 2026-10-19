// One-time, idempotent fill of client contact emails that were blank or
// masked. Runs from the database migration on boot (including every deploy).
// A valid address already on the client is left alone. Nothing is emailed.

import type BetterSqlite from "better-sqlite3";
import { isUsableEmail } from "./email-address";

export interface ContactEmailBackfillEntry {
  /** Basecamp project name, or the client name once the Growth OS suffix is off. */
  name: string;
  email: string;
  /** When set, a client with this Basecamp project id wins over a name match. */
  projectId?: string;
}

export const CONTACT_EMAIL_BACKFILL: ContactEmailBackfillEntry[] = [
  { name: "Trailhead Family Chiropractic", email: "c@drchrisboman.com" },
  { name: "Superior Patios", email: "jacqueline.superiorpatiosinc@gmail.com" },
  { name: "Black's Shutters Shades & Blinds", email: "mark@blacksblinds.com" },
  { name: "Cuidando De Ti Advantage", email: "miriam@cuidandodetiadvantage.com" },
  { name: "ALL-IN-1 Construction", email: "wayne@allinone-const.com" },
  { name: "JG Seamless Gutters", email: "jaredyz125@yahoo.com" },
  { name: "Chaparral Junk Removal", email: "nicopanzera@gmail.com" },
  { name: "Kentina", email: "blaines12@gmail.com" },
  { name: "Bear Windows", email: "george@bearwindows.com" },
];

export type ContactEmailBackfillOutcome = "updated" | "skipped" | "not found";

export interface ContactEmailBackfillRow {
  client: string;
  outcome: ContactEmailBackfillOutcome;
  clientId?: string;
}

interface ClientEmailRow {
  id: string;
  name: string;
  basecamp_project_id: string;
  contact_email: string;
}

/** Compare a client name to a Basecamp project name. Punctuation is ignored. */
export function foldContactName(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/growth os.*$/i, "")
    .replace(/powered by.*$/i, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameMatch(clientName: string, projectName: string): "exact" | "prefix" | null {
  const client = foldContactName(clientName);
  const project = foldContactName(projectName);
  if (!client || !project) return null;
  if (client === project) return "exact";
  // "Chaparral Junk Removal" is the project; the account may be stored with
  // the longer "& Handyman Services" suffix, or the other way around.
  if (client.startsWith(`${project} `) || project.startsWith(`${client} `)) {
    return "prefix";
  }
  return null;
}

export function planContactEmailBackfill(
  clients: ClientEmailRow[],
  entries: ContactEmailBackfillEntry[] = CONTACT_EMAIL_BACKFILL
): Array<ContactEmailBackfillRow & { email?: string }> {
  return entries.map((entry) => {
    const byProject = entry.projectId
      ? clients.filter((client) => client.basecamp_project_id === entry.projectId)
      : [];
    // A resolved project id is the client, even when the stored name differs.
    const exact = clients.filter((client) => nameMatch(client.name, entry.name) === "exact");
    const matches = byProject.length === 1
      ? byProject
      : exact.length
        ? exact
        : clients.filter((client) => nameMatch(client.name, entry.name) === "prefix");
    if (matches.length !== 1) {
      return { client: entry.name, outcome: "not found" as const };
    }
    const client = matches[0];
    if (isUsableEmail(client.contact_email)) {
      return {
        client: entry.name,
        outcome: "skipped" as const,
        clientId: client.id,
      };
    }
    return {
      client: entry.name,
      outcome: "updated" as const,
      clientId: client.id,
      email: entry.email,
    };
  });
}

export function contactEmailBackfillLine(row: ContactEmailBackfillRow): string {
  const outcome =
    row.outcome === "skipped" ? "skipped (already valid)" : row.outcome;
  return `[contact-email] ${row.client}: ${outcome}`;
}

/**
 * Write the known addresses onto clients whose contact email is blank or not
 * a real address. Safe to run on every boot: a valid email is never replaced.
 * Logs one line per client. An empty client table logs nothing.
 */
export function backfillKnownContactEmails(
  database: BetterSqlite.Database,
  log: (line: string) => void = (line) => console.log(line)
): ContactEmailBackfillRow[] {
  const table = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rev_clients'`
    )
    .get();
  if (!table) return [];
  const clients = database
    .prepare(
      `SELECT id, name, basecamp_project_id, contact_email FROM rev_clients`
    )
    .all() as ClientEmailRow[];
  if (!clients.length) return [];

  const plan = planContactEmailBackfill(clients);
  const stamp = new Date().toISOString();
  const update = database.prepare(
    `UPDATE rev_clients SET contact_email = ?, updated_at = ? WHERE id = ?`
  );
  const write = database.transaction(() => {
    for (const row of plan) {
      if (row.outcome === "updated" && row.clientId && row.email) {
        update.run(row.email, stamp, row.clientId);
      }
    }
  });
  write();
  for (const row of plan) log(contactEmailBackfillLine(row));
  return plan.map(({ client, outcome, clientId }) => ({ client, outcome, clientId }));
}
