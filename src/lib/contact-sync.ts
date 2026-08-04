// Reconcile each client's Contact name against the person Basecamp actually has
// on their project.
//
// Campaign Desk matches a client to their Basecamp person by exact name, so a
// spelling difference means nobody gets assigned and nobody gets tagged. Guardian
// Plumbers held "Kristin" while Basecamp has "Kristen Black", and the scheduling
// card had no assignee and a plain-text greeting because of it.
//
// Working out which person on a project is the client is the whole problem. The
// app's own team list holds first names ("Michael", "Jack"), which cannot be used
// to exclude staff: "Michael" matches both Piarulli Michael and a client called
// Michael Marx, and picking wrong is exactly the bug being fixed. Project
// membership is the reliable signal instead. Staff sit on nearly every project
// and a client sits on one, so anyone on a large share of projects is internal
// and everyone left is client side.
//
// Only a project with exactly one client-side person is touched. Several
// candidates or none are reported for a human to decide, never guessed.

import { getProjectPeople, listProjects, type BcPerson } from "./basecamp";
import { listRevClients, updateRevClient } from "./revenue";

// A person on at least this share of all projects is treated as internal. Staff
// land well above it (the lowest sits around a third) and clients well below
// (one project out of dozens), so the gap is wide and the exact value is not
// delicate.
export const INTERNAL_PROJECT_SHARE = 0.2;

export interface ContactSyncRow {
  client: string;
  clientId: string;
  project: string;
  current: string;
  proposed: string | null;
  // "renamed" and "already correct" need nothing from anybody. The rest do.
  outcome:
    | "renamed"
    | "would rename"
    | "already correct"
    | "no client on project"
    | "several candidates"
    // A name is already on the record and no person on the project resembles
    // it. Left alone: overwriting it would be a guess.
    | "no candidate matches"
    | "no basecamp project";
  candidates?: string[];
}

export interface ContactSyncResult {
  apply: boolean;
  projectsScanned: number;
  internal: string[];
  rows: ContactSyncRow[];
}

// "Dr. Isaac" and "Kristin" both need to resolve, so compare on the first word
// with titles and punctuation stripped.
function firstToken(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss|prof)\.?\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)[0] || "";
}

// One substitution, insertion or deletion apart. Enough for Kristin against
// Kristen, and tight enough that two different people never collide.
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slack = 1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (!slack--) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return true;
}

// Which candidate is the person already named on the client record.
export function matchExistingContact(current: string, candidates: string[]): string | null {
  const want = firstToken(current);
  if (!want) return null;
  const exact = candidates.filter((c) => firstToken(c) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const near = candidates.filter((c) => nearlyEqual(firstToken(c), want));
  return near.length === 1 ? near[0] : null;
}

export async function syncClientContacts(opts?: {
  apply?: boolean;
}): Promise<ContactSyncResult> {
  const apply = Boolean(opts?.apply);
  const projects = await listProjects();

  // One pass over every project to learn who is internal.
  const rosters = new Map<string, BcPerson[]>();
  const appearances = new Map<string, number>();
  for (const project of projects) {
    const people = await getProjectPeople(String(project.id));
    if (!people.length) continue;
    rosters.set(String(project.id), people);
    for (const person of people) {
      appearances.set(person.name, (appearances.get(person.name) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(rosters.size * INTERNAL_PROJECT_SHARE));
  const internal = new Set(
    [...appearances.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([name]) => name)
  );

  const rows: ContactSyncRow[] = [];
  for (const client of listRevClients(true)) {
    if (!client.production_enrolled) continue;
    const base: Omit<ContactSyncRow, "outcome" | "proposed"> = {
      client: client.name,
      clientId: client.id,
      project: client.basecamp_project_id,
      current: client.contact_name || "",
    };
    if (!client.basecamp_project_id) {
      rows.push({ ...base, proposed: null, outcome: "no basecamp project" });
      continue;
    }
    const people = rosters.get(client.basecamp_project_id);
    if (!people) {
      rows.push({ ...base, proposed: null, outcome: "no client on project" });
      continue;
    }
    const candidates = people
      .filter((person) => !internal.has(person.name))
      .map((person) => person.name);

    if (candidates.length === 0) {
      rows.push({ ...base, proposed: null, outcome: "no client on project" });
      continue;
    }

    // Match against the name already on the record first. Taking the sole
    // candidate instead would overwrite a real contact with whoever happens to
    // be on the project: Bear Windows has "George" on file and one candidate,
    // Chris Evans, who is staff sitting below the internal threshold. A name
    // already entered by a human is better evidence than a lone roster entry.
    const matched = matchExistingContact(base.current, candidates);
    const proposed =
      matched || (!base.current.trim() && candidates.length === 1 ? candidates[0] : null);

    if (!proposed) {
      rows.push({
        ...base,
        proposed: null,
        outcome: base.current.trim() ? "no candidate matches" : "several candidates",
        candidates,
      });
      continue;
    }
    if ((client.contact_name || "").trim() === proposed) {
      rows.push({ ...base, proposed, outcome: "already correct" });
      continue;
    }
    if (apply) {
      updateRevClient(client.id, { contactName: proposed });
      rows.push({ ...base, proposed, outcome: "renamed" });
    } else {
      rows.push({ ...base, proposed, outcome: "would rename" });
    }
  }

  return {
    apply,
    projectsScanned: rosters.size,
    internal: [...internal].sort(),
    rows,
  };
}
