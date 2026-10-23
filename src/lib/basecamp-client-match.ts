// Confident name matching between a Forecast client and a Basecamp project.
//
// Used by the admin "match by name" action and by the one-time project import.
// A match is saved only when one normalized name points at one project. Anything
// else stays blank so a person can pick it. This module does not touch the
// database or the network.

const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "pllc",
  "llp",
  "lp",
  "pc",
  "dba",
]);

// Dotted forms collapse to separate letters once punctuation becomes spaces:
// "L.L.C." -> "l l c". Strip those only from the end, and only when a real
// name remains in front of them.
const DOTTED_SUFFIXES: string[][] = [
  ["p", "l", "l", "c"],
  ["l", "l", "c"],
  ["l", "l", "p"],
];

function stripLegalSuffixes(tokens: string[]): string[] {
  let rest = tokens;
  for (let guard = 0; guard < 6 && rest.length > 1; guard++) {
    const last = rest[rest.length - 1];
    if (LEGAL_SUFFIXES.has(last)) {
      rest = rest.slice(0, -1);
      continue;
    }
    const dotted = DOTTED_SUFFIXES.find(
      (seq) =>
        rest.length > seq.length &&
        seq.every((part, i) => rest[rest.length - seq.length + i] === part)
    );
    if (!dotted) break;
    rest = rest.slice(0, -dotted.length);
  }
  return rest;
}

/**
 * Fold a client or project title down to the words that identify the account.
 *
 * Case, punctuation, accents, "&" vs "and", a trailing "Growth OS" / "Powered
 * by…" campaign suffix, and legal suffixes (LLC, Inc, Co, L.L.C., …) all fold
 * away. The remaining words stay in order, so "NORLO" does not equal
 * "NORLO Peptides".
 */
export function normalizeClientMatchKey(name: string): string {
  let s = (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/\s*[-–—]?\s*growth os\b.*$/i, " ");
  s = s.replace(/\s*[-–—]?\s*powered by\b.*$/i, " ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return "";
  return stripLegalSuffixes(s.split(" ").filter(Boolean)).join(" ");
}

export type MatchClient = {
  id: string;
  name: string;
  basecampProjectId: string;
  /** Inactive rows are not Forecast clients. They still reserve a project id. */
  active?: boolean;
  /**
   * False for a person or an internal workspace stored as a client row.
   * Those are not Forecast clients: they are not linked and not listed as missing.
   * Omitted means eligible.
   */
  eligible?: boolean;
};

export type MatchProject = {
  id: string;
  name: string;
};

export type ConfidentClientMatch = {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
};

export type ClientMatchPlan = {
  matches: ConfidentClientMatch[];
  ambiguous: Array<{ clientId: string; clientName: string; options: string[] }>;
  unmatched: Array<{ clientId: string; clientName: string }>;
};

/**
 * A row whose name is a teammate or an internal MEG workspace is not a client
 * account. Matching is exact on the normalized name, so "Carlos Cleaning"
 * stays a client and "Carlos" does not.
 */
export function isPersonOrInternalClientName(
  name: string,
  personNames: readonly string[],
  isInternal: (name: string) => boolean
): boolean {
  if (isInternal(name)) return true;
  const key = normalizeClientMatchKey(name);
  if (!key) return false;
  for (const person of personNames) {
    if (normalizeClientMatchKey(person) === key) return true;
  }
  return false;
}

function optionLabel(project: MatchProject): string {
  const name = (project.name || "").trim() || "Untitled project";
  return `${name} (#${project.id})`;
}

/**
 * Pair unlinked clients to projects.
 *
 * A pair is confident when the normalized names are equal, exactly one visible
 * project has that name, no other client already owns that project, and no
 * second unlinked client normalizes to it. Internal workspaces are not
 * candidates. Curated aliases (project id -> client name) are confident when
 * that project is in the list.
 */
export function matchUnlinkedClients(
  clients: MatchClient[],
  projects: MatchProject[],
  opts?: {
    aliases?: Record<string, string>;
    isInternal?: (name: string) => boolean;
  }
): ClientMatchPlan {
  const aliases = opts?.aliases ?? {};
  const isInternal = opts?.isInternal ?? (() => false);

  const visible = projects
    .map((p) => ({ id: String(p.id ?? "").trim(), name: p.name || "" }))
    .filter((p) => p.id);
  const byId = new Map(visible.map((p) => [p.id, p]));
  const byKey = new Map<string, MatchProject[]>();
  for (const project of visible) {
    if (isInternal(project.name)) continue;
    const key = normalizeClientMatchKey(project.name);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) group.push(project);
    else byKey.set(key, [project]);
  }

  const taken = new Set(
    clients.map((c) => (c.basecampProjectId || "").trim()).filter(Boolean)
  );

  const aliasByClient = new Map<string, string>();
  for (const [projectId, clientName] of Object.entries(aliases)) {
    const key = clientName.trim().toLowerCase();
    if (key && projectId.trim()) aliasByClient.set(key, projectId.trim());
  }

  type Provisional = ConfidentClientMatch;
  const provisional: Provisional[] = [];
  const ambiguous: ClientMatchPlan["ambiguous"] = [];
  const unmatched: ClientMatchPlan["unmatched"] = [];

  for (const client of clients) {
    if (client.active === false || client.eligible === false) continue;
    const clientName = (client.name || "").trim();
    if ((client.basecampProjectId || "").trim()) continue;

    const aliasId = aliasByClient.get(clientName.toLowerCase());
    if (aliasId) {
      const project = byId.get(aliasId);
      if (!project || taken.has(project.id)) {
        unmatched.push({ clientId: client.id, clientName: client.name });
      } else {
        provisional.push({
          clientId: client.id,
          clientName: client.name,
          projectId: project.id,
          projectName: project.name,
        });
      }
      continue;
    }

    const key = normalizeClientMatchKey(client.name);
    if (!key) {
      unmatched.push({ clientId: client.id, clientName: client.name });
      continue;
    }
    const hits = byKey.get(key) ?? [];
    if (hits.length === 1 && !taken.has(hits[0].id)) {
      provisional.push({
        clientId: client.id,
        clientName: client.name,
        projectId: hits[0].id,
        projectName: hits[0].name,
      });
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push({
        clientId: client.id,
        clientName: client.name,
        options: hits.map(optionLabel),
      });
      continue;
    }
    unmatched.push({ clientId: client.id, clientName: client.name });
  }

  const matches: ConfidentClientMatch[] = [];
  const byProject = new Map<string, Provisional[]>();
  for (const choice of provisional) {
    const group = byProject.get(choice.projectId);
    if (group) group.push(choice);
    else byProject.set(choice.projectId, [choice]);
  }
  for (const group of byProject.values()) {
    if (group.length === 1) {
      matches.push(group[0]);
      continue;
    }
    const label = optionLabel({ id: group[0].projectId, name: group[0].projectName });
    for (const choice of group) {
      ambiguous.push({
        clientId: choice.clientId,
        clientName: choice.clientName,
        options: [label],
      });
    }
  }

  return { matches, ambiguous, unmatched };
}

/** Projects an admin can attach to a client. Internal MEG workspaces are omitted. */
export function basecampProjectChoices(
  projects: MatchProject[],
  isInternal: (name: string) => boolean
): Array<{ id: string; name: string }> {
  const visible = projects
    .map((p) => ({ id: String(p.id ?? "").trim(), name: (p.name || "").trim() }))
    .filter((p) => p.id && p.name && !isInternal(p.name));
  const counts = new Map<string, number>();
  for (const project of visible) {
    counts.set(project.name, (counts.get(project.name) ?? 0) + 1);
  }
  return visible
    .map((project) => ({
      id: project.id,
      name: (counts.get(project.name) ?? 0) > 1 ? `${project.name} (#${project.id})` : project.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
