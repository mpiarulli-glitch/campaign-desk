// Idempotent fill of client phone numbers taken from Basecamp POC lines.
// Runs from the database migration on boot (including every deploy).
// A valid phone already on the client is left alone. Nothing is texted.

import type BetterSqlite from "better-sqlite3";
import { foldContactName } from "./contact-email-backfill";
import { normalizePhoneE164 } from "./phone";

export interface ContactPhoneBackfillEntry {
  /** Client name with the Growth OS suffix removed. */
  name: string;
  /** Basecamp project id. Matched before the folded name. */
  projectId: string;
  /** Person on the POC line this number belongs to. */
  pocName: string;
  /** E.164. Written through normalizePhoneE164, which leaves this unchanged. */
  phone: string;
}

/**
 * The approved list of 50 client phones. Michael excluded Top Notch Auto
 * (29833578), Danza Del Sol (40435223), Swing Inn Cafe (49112019), Hendo's
 * Barrel House (47628800), and CIPO Cloud Software (41711679). A later row
 * for the same client does not replace a phone that is already valid.
 */
export const CONTACT_PHONE_BACKFILL: ContactPhoneBackfillEntry[] = [
  { name: "Milan and Associates", projectId: "49308040", pocName: "Jeremiah Milan", phone: "+17758530284" },
  { name: "Curt's Floor Covering", projectId: "49277608", pocName: "Curt Hinton", phone: "+19519419395" },
  { name: "Dolce Vita Wellness Spa", projectId: "49264101", pocName: "Fernando Leal", phone: "+17737442050" },
  { name: "FloorCo Design", projectId: "49198430", pocName: "Andy Mohajeri", phone: "+19513991470" },
  { name: "Krak Boba Piscataway", projectId: "49040791", pocName: "Mehtab Singh", phone: "+17173866682" },
  { name: "Maya's Construction", projectId: "48997930", pocName: "Ervin Rodas", phone: "+17604056020" },
  { name: "Stephanie's Construction", projectId: "48661885", pocName: "Oscar Hernandez", phone: "+19514251969" },
  { name: "Cuidando De Ti Advantage", projectId: "48416102", pocName: "Miriam Morales", phone: "+17607550550" },
  { name: "1off Creative Concepts", projectId: "48402949", pocName: "Fredrick Gunnison", phone: "+18588881383" },
  { name: "Black's Shutters Shades & Blinds", projectId: "48403041", pocName: "Mark Black", phone: "+17149138463" },
  { name: "ALL-IN-1 Construction", projectId: "48158835", pocName: "Wayne Meeks", phone: "+19099514915" },
  { name: "JG Seamless Gutters", projectId: "48019705", pocName: "Jared Green", phone: "+19512019735" },
  { name: "Looda House Auction", projectId: "47992032", pocName: "Sean Loodus", phone: "+19516007667" },
  { name: "Looda House Pawn", projectId: "47991754", pocName: "Sean Loodus", phone: "+19516007667" },
  { name: "Vitatherapy Wellness & Medspa", projectId: "47747763", pocName: "Katie Jones", phone: "+19513977444" },
  { name: "Krak Boba (Corporate)", projectId: "47729403", pocName: "Ben Pham", phone: "+17142109048" },
  { name: "Krak Boba Oceanside", projectId: "47496503", pocName: "Ben Pham", phone: "+17142109048" },
  { name: "The HR Innovator Group", projectId: "47257146", pocName: "Stephanie Heathman", phone: "+19514016849" },
  { name: "Kentina", projectId: "47256487", pocName: "Blaine Smith", phone: "+19512652143" },
  { name: "Chaparral Junk Removal", projectId: "47166180", pocName: "Nick Panzera", phone: "+19516942982" },
  { name: "Housecleaning by Christina", projectId: "46912240", pocName: "Christina Thornbrough", phone: "+17607550332" },
  { name: "12 Volt Power", projectId: "46422132", pocName: "Scott Quinn", phone: "+17143224801" },
  { name: "DH Construction", projectId: "46342714", pocName: "Cam Harder", phone: "+19168074787" },
  { name: "News & Views Podcast", projectId: "46236160", pocName: "Jennifer Sevilla", phone: "+19512693753" },
  { name: "Pacific Coast Generation", projectId: "46159972", pocName: "Josh Vasquez", phone: "+19512196146" },
  { name: "Inland Valley Chiropractic", projectId: "45990194", pocName: "Isaac Song", phone: "+19098090128" },
  { name: "Trailhead Family Chiropractic", projectId: "45845785", pocName: "Chris Boman", phone: "+19517333102" },
  { name: "A Tac Exterminators", projectId: "45845038", pocName: "Tommy Walker", phone: "+19514487140" },
  { name: "Krak Boba Temecula", projectId: "45767179", pocName: "Luis/Debbie Mares", phone: "+19512051155" },
  { name: "Passion Life Church", projectId: "45706270", pocName: "Phil Valdez", phone: "+19518528793" },
  { name: "Orangecrest Club", projectId: "45647295", pocName: "Jennifer Hudak", phone: "+13862959858" },
  { name: "Law Offices of Giselle Rodriguez", projectId: "45547448", pocName: "Giselle Rodriguez", phone: "+17077208293" },
  { name: "The BetterLife Coach", projectId: "45517328", pocName: "Randal Smalls", phone: "+17145195431" },
  { name: "BLuu Construction", projectId: "44886864", pocName: "Bryan Luu", phone: "+17144931576" },
  { name: "S.K. Produce Co.", projectId: "44479780", pocName: "Mishel Woods", phone: "+12064670789" },
  { name: "Premier Choice Management", projectId: "44251596", pocName: "Jared Bregen", phone: "+17606722860" },
  { name: "My 401k PEP Solution", projectId: "44055263", pocName: "Shawn West", phone: "+14808793051" },
  { name: "Ecoworkz", projectId: "43063862", pocName: "Tom Kelly", phone: "+17145827800" },
  { name: "Pristine Clean", projectId: "43030054", pocName: "Trevor Stenier", phone: "+19512592764" },
  { name: "MBros Pool Construction", projectId: "42663595", pocName: "Sergio Martinez", phone: "+17143921784" },
  { name: "Alliance Tops", projectId: "41139622", pocName: "Claudia Carrera", phone: "+16264075197" },
  { name: "Pipe It Right", projectId: "40889279", pocName: "Paulina Barrera", phone: "+17609061600" },
  { name: "CISCo Restaurant + Bar", projectId: "39953917", pocName: "Cisco Perez", phone: "+19495220370" },
  { name: "American Made Blue Collar LLC", projectId: "39941109", pocName: "Jason Apodaca", phone: "+13238952751" },
  { name: "GenEX Cleaning Services", projectId: "39618841", pocName: "Oscar Rodriguez", phone: "+19512286144" },
  { name: "Beyond the Walls Community Church", projectId: "38899767", pocName: "Demetric Felton", phone: "+16199470693" },
  { name: "Scott Cole Plumbing", projectId: "38327950", pocName: "Scott Cole", phone: "+19518338572" },
  { name: "Guardian Plumbers Heating Air & Electrical", projectId: "38169363", pocName: "Kristen Black", phone: "+19512163280" },
  { name: "Integrity Air", projectId: "34677126", pocName: "Chris Johnson", phone: "+19514632315" },
  { name: "Superior Patios", projectId: "34229213", pocName: "Jacqueline", phone: "+19099978068" },
];

export type ContactPhoneBackfillOutcome = "updated" | "skipped" | "not found";

export interface ContactPhoneMatch {
  id: string;
  name: string;
}

export interface ContactPhoneBackfillRow {
  client: string;
  outcome: ContactPhoneBackfillOutcome;
  clientId?: string;
  matchedName?: string;
  matches?: ContactPhoneMatch[];
  closest?: string[];
}

interface ClientPhoneRow {
  id: string;
  name: string;
  basecamp_project_id: string;
  contact_phone: string;
}

function projectIdOf(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  const text = String(value ?? "").trim();
  // SQLite can hand back a whole number as "48158835.0" when it was bound as a float.
  const dotted = text.match(/^(\d+)\.0+$/);
  return dotted ? dotted[1] : text;
}

function uniqueClients(rows: ClientPhoneRow[]): ClientPhoneRow[] {
  const seen = new Set<string>();
  const out: ClientPhoneRow[] = [];
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function nameKind(clientName: string, entryName: string): "exact" | "prefix" | null {
  const client = foldContactName(clientName);
  const entry = foldContactName(entryName);
  if (!client || !entry) return null;
  if (client === entry) return "exact";
  if (client.startsWith(`${entry} `) || entry.startsWith(`${client} `)) return "prefix";
  return null;
}

function matchesFor(clients: ClientPhoneRow[], entry: ContactPhoneBackfillEntry): ClientPhoneRow[] {
  const byProject = clients.filter(
    (client) => projectIdOf(client.basecamp_project_id) === entry.projectId
  );
  const exact = clients.filter((client) => nameKind(client.name, entry.name) === "exact");
  // Project id and the folded name are both this client. A stub that carries
  // the project id and a second row spelled "All In 1" / "ALL-IN-1" both get
  // the number. Prefix matches are only used when nothing else hit, and only
  // when there is a single one, so "Kentina" does not fan out across brands.
  const union = uniqueClients([...byProject, ...exact]);
  if (union.length) return union;
  const prefix = clients.filter((client) => nameKind(client.name, entry.name) === "prefix");
  return prefix.length === 1 ? prefix : [];
}

const CLOSEST_CAP = 8;
const CLOSEST_STOP = new Set(["and", "the", "inc", "llc", "for", "with"]);

/** Client names that share a distinctive folded word with the entry. */
export function closestPhoneNames(entryName: string, clients: ClientPhoneRow[]): string[] {
  const folded = foldContactName(entryName);
  const tokens = new Set(
    folded.split(" ").filter((token) => token.length >= 4 && !CLOSEST_STOP.has(token))
  );
  const scored = clients
    .map((client) => {
      const clientFolded = foldContactName(client.name);
      const clientTokens = clientFolded.split(" ").filter((token) => token.length >= 4);
      let score = 0;
      for (const token of clientTokens) {
        if (tokens.has(token)) score += token.length;
      }
      if (
        clientFolded &&
        folded &&
        (clientFolded.startsWith(`${folded} `) || folded.startsWith(`${clientFolded} `))
      ) {
        score += 50;
      }
      return { client, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name)
    );
  const labels = scored.map((item) => `${item.client.name} id=${item.client.id}`);
  if (labels.length <= CLOSEST_CAP) return labels;
  return [...labels.slice(0, CLOSEST_CAP), `+${labels.length - CLOSEST_CAP} more`];
}

export function planContactPhoneBackfill(
  clients: ClientPhoneRow[],
  entries: ContactPhoneBackfillEntry[] = CONTACT_PHONE_BACKFILL
): Array<ContactPhoneBackfillRow & { phone?: string; writeIds?: string[] }> {
  const phoneOf = new Map(clients.map((client) => [client.id, client.contact_phone || ""]));
  const rows: Array<ContactPhoneBackfillRow & { phone?: string; writeIds?: string[] }> = [];
  for (const entry of entries) {
    const phone = normalizePhoneE164(entry.phone);
    const matches = matchesFor(clients, entry);
    if (!matches.length || !phone) {
      rows.push({
        client: entry.name,
        outcome: "not found",
        closest: closestPhoneNames(entry.name, clients),
      });
      continue;
    }
    const listed = matches.map((client) => ({ id: client.id, name: client.name }));
    const matchedName =
      listed.length === 1 ? listed[0].name : listed.map((item) => item.name).join(", ");
    const writeIds = matches
      .filter((client) => !normalizePhoneE164(phoneOf.get(client.id) || ""))
      .map((client) => client.id);
    if (!writeIds.length) {
      rows.push({
        client: entry.name,
        outcome: "skipped",
        clientId: listed[0].id,
        matchedName,
        matches: listed,
      });
      continue;
    }
    for (const id of writeIds) phoneOf.set(id, phone);
    rows.push({
      client: entry.name,
      outcome: "updated",
      clientId: writeIds[0],
      matchedName,
      matches: listed,
      phone,
      writeIds,
    });
  }
  return rows;
}

export function contactPhoneBackfillLine(row: ContactPhoneBackfillRow): string {
  const outcome = row.outcome === "skipped" ? "skipped (already valid)" : row.outcome;
  const listed = row.matches || [];
  const matched = listed.length
    ? ` (${listed.map((match) => `${match.name} id=${match.id}`).join(", ")})`
    : "";
  const closest =
    row.outcome === "not found" && row.closest?.length
      ? `; closest: ${row.closest.join(", ")}`
      : "";
  return `[contact-phone] ${row.client}: ${outcome}${matched}${closest}`;
}

interface SqliteColumn {
  name: string;
}

/**
 * Write each POC number onto every matching client whose contact phone is
 * blank or not a real number. Safe to run on every boot: a valid phone is
 * never replaced. Logs one line per POC row. An empty client table logs nothing.
 */
export function backfillKnownContactPhones(
  database: BetterSqlite.Database,
  log: (line: string) => void = (line) => console.log(line),
  entries: ContactPhoneBackfillEntry[] = CONTACT_PHONE_BACKFILL
): ContactPhoneBackfillRow[] {
  const table = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rev_clients'`
    )
    .get();
  if (!table) return [];
  const cols = database.prepare(`PRAGMA table_info(rev_clients)`).all() as SqliteColumn[];
  if (!cols.some((col) => col.name === "contact_phone")) return [];
  const clients = (
    database
      .prepare(
        `SELECT id, name, basecamp_project_id, contact_phone FROM rev_clients`
      )
      .all() as Array<ClientPhoneRow & { basecamp_project_id: unknown }>
  ).map((client) => ({
    ...client,
    basecamp_project_id: projectIdOf(client.basecamp_project_id),
    contact_phone: client.contact_phone || "",
  }));
  if (!clients.length) return [];

  const plan = planContactPhoneBackfill(clients, entries);
  const stamp = new Date().toISOString();
  const update = database.prepare(
    `UPDATE rev_clients SET contact_phone = ?, updated_at = ? WHERE id = ?`
  );
  const write = database.transaction(() => {
    for (const row of plan) {
      if (row.outcome !== "updated" || !row.phone) continue;
      for (const id of row.writeIds || []) {
        update.run(row.phone, stamp, id);
      }
    }
  });
  write();
  for (const row of plan) log(contactPhoneBackfillLine(row));
  return plan.map(({ client, outcome, clientId, matchedName, matches, closest }) => ({
    client,
    outcome,
    clientId,
    matchedName,
    matches,
    closest,
  }));
}
