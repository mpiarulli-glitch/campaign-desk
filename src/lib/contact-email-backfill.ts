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
  {
    name: "ALL-IN-1 Construction",
    email: "wayne@allinone-const.com",
    // Basecamp project "ALL-IN-1 Construction Growth OS – Powered by the Empire Method™".
    // The desk client is "All In 1 Construction"; the October nurture campaign
    // (FOk4YyxjQGTJ) stores client_name "ALL-IN-1 Construction".
    projectId: "48158835",
  },
  { name: "JG Seamless Gutters", email: "jaredyz125@yahoo.com" },
  { name: "Chaparral Junk Removal", email: "nicopanzera@gmail.com" },
  { name: "Kentina", email: "blaines12@gmail.com" },
  { name: "Bear Windows", email: "george@bearwindows.com" },
];

export type ContactEmailBackfillOutcome = "updated" | "skipped" | "not found";

export interface ContactEmailMatch {
  id: string;
  name: string;
}

export interface ContactEmailBackfillRow {
  client: string;
  outcome: ContactEmailBackfillOutcome;
  clientId?: string;
  /** Name stored on the matched Campaign Desk client, when one was found. */
  matchedName?: string;
  /** Every client row this entry resolved to. */
  matches?: ContactEmailMatch[];
  /** Client and campaign names to print when nothing resolved. */
  closest?: string[];
}

interface ClientEmailRow {
  id: string;
  name: string;
  basecamp_project_id: string;
  contact_email: string;
}

export interface CampaignNameRow {
  id: string;
  client_name: string;
  client_id: string;
  title: string;
}

/**
 * Compare a client name to a Basecamp project name.
 * Case, punctuation, and hyphens are ignored. The word "one" and the digit
 * "1" are the same, so "All-In-One Construction" matches "ALL-IN-1 Construction".
 * Compatibility characters (a fullwidth 1, for example) fold to ASCII first.
 */
export function foldContactName(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/growth os.*$/i, "")
    .replace(/powered by.*$/i, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bone\b/g, "1");
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

function projectIdOf(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueClients(rows: ClientEmailRow[]): ClientEmailRow[] {
  const seen = new Set<string>();
  const out: ClientEmailRow[] = [];
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function clientsForCampaigns(
  clients: ClientEmailRow[],
  campaigns: CampaignNameRow[],
  entryName: string,
  kind: "exact" | "prefix"
): ClientEmailRow[] {
  const byId = new Map(clients.map((client) => [client.id, client]));
  const linked: ClientEmailRow[] = [];
  for (const campaign of campaigns) {
    const clientId = (campaign.client_id || "").trim();
    if (!clientId) continue;
    if (nameMatch(campaign.client_name || "", entryName) !== kind) continue;
    const client = byId.get(clientId);
    if (client) linked.push(client);
  }
  return linked;
}

const CLOSEST_NAME = /construct|all/i;
const CLOSEST_CAP = 24;

/** Names a miss should print: clients and campaigns containing "construct" or "all". */
export function closestContactNames(
  clients: ClientEmailRow[],
  campaigns: CampaignNameRow[] = []
): string[] {
  const labels: string[] = [];
  const hits = clients
    .filter((client) => CLOSEST_NAME.test(client.name || ""))
    .sort((a, b) => {
      const aConstruct = /construct/i.test(a.name) ? 0 : 1;
      const bConstruct = /construct/i.test(b.name) ? 0 : 1;
      if (aConstruct !== bConstruct) return aConstruct - bConstruct;
      return a.name.localeCompare(b.name);
    });
  for (const client of hits) labels.push(`${client.name} id=${client.id}`);
  for (const campaign of campaigns) {
    const blob = `${campaign.client_name || ""} ${campaign.title || ""}`;
    if (!CLOSEST_NAME.test(blob)) continue;
    const who = (campaign.client_name || campaign.title || "").trim();
    labels.push(
      `campaign ${who} campaign=${campaign.id} client=${(campaign.client_id || "").trim() || "-"}`
    );
  }
  if (labels.length <= CLOSEST_CAP) return labels;
  return [...labels.slice(0, CLOSEST_CAP), `+${labels.length - CLOSEST_CAP} more`];
}

export function planContactEmailBackfill(
  clients: ClientEmailRow[],
  entries: ContactEmailBackfillEntry[] = CONTACT_EMAIL_BACKFILL,
  campaigns: CampaignNameRow[] = []
): Array<ContactEmailBackfillRow & { email?: string; writeIds?: string[] }> {
  return entries.map((entry) => {
    const byProject = entry.projectId
      ? clients.filter((client) => projectIdOf(client.basecamp_project_id) === entry.projectId)
      : [];
    // Every row on this Basecamp project is this client, even when a stub and
    // the original account both carry the id. One match used to be required,
    // so two copies were reported as not found and neither email was saved.
    const exact = uniqueClients([
      ...clients.filter((client) => nameMatch(client.name, entry.name) === "exact"),
      ...clientsForCampaigns(clients, campaigns, entry.name, "exact"),
    ]);
    const prefix = uniqueClients([
      ...clients.filter((client) => nameMatch(client.name, entry.name) === "prefix"),
      ...clientsForCampaigns(clients, campaigns, entry.name, "prefix"),
    ]);
    const matches = byProject.length
      ? uniqueClients(byProject)
      : exact.length
        ? exact
        : prefix.length === 1
          ? prefix
          : [];
    if (!matches.length) {
      return {
        client: entry.name,
        outcome: "not found" as const,
        closest: closestContactNames(clients, campaigns),
      };
    }
    const writeIds = matches
      .filter((client) => !isUsableEmail(client.contact_email))
      .map((client) => client.id);
    const listed = matches.map((client) => ({ id: client.id, name: client.name }));
    const matchedName =
      listed.length === 1 ? listed[0].name : listed.map((item) => item.name).join(", ");
    if (!writeIds.length) {
      return {
        client: entry.name,
        outcome: "skipped" as const,
        clientId: listed[0].id,
        matchedName,
        matches: listed,
      };
    }
    return {
      client: entry.name,
      outcome: "updated" as const,
      clientId: writeIds[0],
      matchedName,
      matches: listed,
      email: entry.email,
      writeIds,
    };
  });
}

export function contactEmailBackfillLine(row: ContactEmailBackfillRow): string {
  const outcome =
    row.outcome === "skipped" ? "skipped (already valid)" : row.outcome;
  const listed = row.matches || [];
  const renamed = listed.filter((match) => match.name && match.name !== row.client);
  // A single row whose stored name is already the entry name keeps the short
  // line. A different name, or more than one row, is spelled out with its id.
  const matched =
    renamed.length || listed.length > 1
      ? ` (${listed
          .map((match) =>
            match.name && match.name !== row.client
              ? `${match.name} id=${match.id}`
              : `id=${match.id}`
          )
          .join(", ")})`
      : row.matchedName && row.matchedName !== row.client
        ? ` (${row.matchedName})`
        : "";
  const closest =
    row.outcome === "not found" && row.closest?.length
      ? `; closest: ${row.closest.join(", ")}`
      : "";
  return `[contact-email] ${row.client}: ${outcome}${matched}${closest}`;
}

interface SqliteColumn {
  name: string;
}

function loadCampaignNames(database: BetterSqlite.Database): CampaignNameRow[] {
  const table = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'`
    )
    .get();
  if (!table) return [];
  const cols = database.prepare(`PRAGMA table_info(campaigns)`).all() as SqliteColumn[];
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("client_name")) return [];
  const clientId = names.has("client_id") ? "client_id" : "''";
  const title = names.has("title") ? "title" : "''";
  return database
    .prepare(
      `SELECT id, client_name, ${clientId} AS client_id, ${title} AS title FROM campaigns`
    )
    .all() as CampaignNameRow[];
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
  const clients = (
    database
      .prepare(
        `SELECT id, name, basecamp_project_id, contact_email FROM rev_clients`
      )
      .all() as Array<ClientEmailRow & { basecamp_project_id: unknown }>
  ).map((client) => ({
    ...client,
    basecamp_project_id: projectIdOf(client.basecamp_project_id),
  }));
  if (!clients.length) return [];

  const campaigns = loadCampaignNames(database);
  const plan = planContactEmailBackfill(clients, CONTACT_EMAIL_BACKFILL, campaigns);
  const stamp = new Date().toISOString();
  const update = database.prepare(
    `UPDATE rev_clients SET contact_email = ?, updated_at = ? WHERE id = ?`
  );
  const write = database.transaction(() => {
    for (const row of plan) {
      if (row.outcome !== "updated" || !row.email) continue;
      for (const id of row.writeIds || []) {
        update.run(row.email, stamp, id);
      }
    }
  });
  write();
  for (const row of plan) log(contactEmailBackfillLine(row));
  return plan.map(({ client, outcome, clientId, matchedName, matches, closest }) => ({
    client,
    outcome,
    clientId,
    matchedName,
    matches,
    closest,
  }));
}
