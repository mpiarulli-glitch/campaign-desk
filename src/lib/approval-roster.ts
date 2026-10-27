// Who the campaign "Send to" list is loaded as, and what to say when it is empty.
//
// The panel used to call the project people endpoint only as King Kashflow and
// treat every failure as an empty roster. A saved id that is not a live project
// and a project the mascot was never added to produced the same sentence.
// The person looking at the campaign is tried first when they have connected
// Basecamp, because that is who the send will post as. A saved id that does not
// open for any of those accounts is replaced when the client name matches one
// live project.

import { sessionUserSlug } from "./auth";
import {
  SERVICE,
  asPerson,
  canonicalBasecampProjectId,
  findClientContact,
  getServiceIdentity,
  hasConnection,
  listProjectCatalog,
  readProjectRosterForMention,
  type BcIdentity,
  type BcPerson,
  type ProjectRosterProblem,
} from "./basecamp";
import { relinkUnresolvedClient, replaceProjectIdIfUnchanged } from "./basecamp-link-all";
import { personLabel } from "./people";

export type RosterAccount = {
  identity: BcIdentity;
  account: string;
};

export type SendRoster = {
  people: BcPerson[];
  peopleReason: string;
  projectId: string;
  /** The account that opened the roster. Null when nobody could. */
  reader: BcIdentity | null;
};

type RosterRead = (
  projectId: string,
  identity: BcIdentity
) => Promise<{ people: BcPerson[]; problem: ProjectRosterProblem | null }>;

type RosterDeps = {
  read: RosterRead;
  projectsFor: (identity: BcIdentity) => Promise<Array<{ id: string | number; name: string }>>;
};

const defaultDeps: RosterDeps = {
  read: readProjectRosterForMention,
  async projectsFor(identity) {
    const catalog = await listProjectCatalog(identity);
    return catalog.projects.map((project) => ({ id: project.id, name: project.name }));
  },
};

export function projectRosterMessage(input: {
  clientName: string;
  projectName?: string | null;
  problem: ProjectRosterProblem;
  accounts: string[];
}): string {
  const client = (input.clientName || "This client").trim() || "This client";
  const project = (input.projectName || "").trim();
  const subject = project || client;
  const accounts = input.accounts.map((name) => name.trim()).filter(Boolean);
  const accountText =
    accounts.length === 0
      ? "The connected Basecamp account"
      : accounts.length === 1
        ? accounts[0]
        : accounts.slice(0, -1).join(", ") + " or " + accounts[accounts.length - 1];

  if (input.problem === "empty") {
    return `${subject} has no people on it in Basecamp.`;
  }
  if (input.problem === "unreachable") {
    return `Couldn't reach Basecamp to load people for ${subject}.`;
  }
  if (input.problem === "forbidden") {
    return `${accountText} isn't allowed to see people on ${subject}.`;
  }
  if (accounts.length > 1) {
    return `${subject} didn't come back from Basecamp for ${accountText}. Neither account is on that project, or the project is no longer there.`;
  }
  return `${subject} didn't come back from Basecamp for ${accountText}. ${accountText} isn't on that project, or the project is no longer there.`;
}

/**
 * Name and email from a Basecamp project description's POC line.
 *
 * "POC: Mehtab Singh - piscataway@krakboba.com - (717) 386-6682" yields that
 * name and inbox. A phone in the same line is not treated as a name.
 */
export function pocFromProjectDescription(description: string): { name: string; email: string } {
  const match = (description || "").match(/POC:\s*([^|\n]+)/i);
  if (!match) return { name: "", email: "" };
  let name = "";
  let email = "";
  for (const part of match[1].split(/\s+-\s+/)) {
    const text = part.trim();
    if (!text) continue;
    const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (found && !email) {
      email = found[0];
      continue;
    }
    if (/^\(?\+?\d[\d\s().-]*$/.test(text)) continue;
    if (!name) name = text;
  }
  return { name, email };
}

/**
 * Who the Send to dropdown opens on.
 *
 * A saved contact wins. Otherwise the client's name or email. Otherwise the
 * POC named in the project description, which is how Mehtab Singh is chosen
 * for Krak Boba Piscataway when the client row has no contact yet.
 */
export function pickApprovalRecipient(input: {
  people: BcPerson[];
  contactId?: number;
  contactEmail?: string;
  contactName?: string;
  projectDescription?: string;
}): BcPerson | null {
  const people = input.people || [];
  if (input.contactId && people.some((person) => person.id === input.contactId)) {
    return people.find((person) => person.id === input.contactId) || null;
  }
  const saved = findClientContact(people, input.contactEmail || "", input.contactName || "");
  if (saved) return saved;
  const poc = pocFromProjectDescription(input.projectDescription || "");
  return findClientContact(people, poc.email, poc.name);
}

export async function sendRosterIdentities(): Promise<RosterAccount[]> {
  const accounts: RosterAccount[] = [];
  const sender = await sessionUserSlug();
  if (sender && hasConnection(sender)) {
    accounts.push({ identity: asPerson(sender), account: personLabel(sender) });
  }
  accounts.push({
    identity: SERVICE,
    account: getServiceIdentity()?.name?.trim() || "King Kashflow",
  });
  return accounts;
}

function worstProblem(
  results: Array<{ problem: ProjectRosterProblem; account: string }>
): { problem: ProjectRosterProblem; accounts: string[] } {
  const order: ProjectRosterProblem[] = ["unreachable", "forbidden", "not_open", "empty"];
  for (const problem of order) {
    const hits = results.filter((row) => row.problem === problem);
    if (hits.length) return { problem, accounts: hits.map((row) => row.account) };
  }
  return { problem: "not_open", accounts: results.map((row) => row.account) };
}

export async function loadSendRoster(
  input: {
    clientId: string;
    clientName: string;
    projectId: string;
    identities: RosterAccount[];
  },
  deps: Partial<RosterDeps> = {}
): Promise<SendRoster> {
  const read = deps.read ?? defaultDeps.read;
  const projectsFor = deps.projectsFor ?? defaultDeps.projectsFor;
  const raw = (input.projectId || "").trim();
  const canonical = canonicalBasecampProjectId(raw);
  let projectId = canonical || raw;
  let projectName = "";

  const opened = await tryAccounts(read, input.identities, projectId);
  if (opened.people.length) {
    if (canonical && canonical !== raw) {
      replaceProjectIdIfUnchanged(input.clientId, raw, canonical);
    }
    return {
      people: opened.people,
      peopleReason: "",
      projectId: canonical || projectId,
      reader: opened.reader,
    };
  }

  const failure = worstProblem(opened.failures);
  const everyAccountMissed =
    opened.failures.length > 0 && opened.failures.every((row) => row.problem === "not_open");
  if (everyAccountMissed) {
    for (const entry of input.identities) {
      let projects: Array<{ id: string | number; name: string }> = [];
      try {
        projects = await projectsFor(entry.identity);
      } catch {
        continue;
      }
      if (!projects.length) continue;
      const relinked = relinkUnresolvedClient(input.clientId, projects);
      if (!relinked) continue;
      projectId = relinked.projectId;
      projectName = relinked.project;
      const again = await tryAccounts(read, input.identities, relinked.projectId);
      if (again.people.length) {
        return {
          people: again.people,
          peopleReason: "",
          projectId: relinked.projectId,
          reader: again.reader,
        };
      }
      const againFailure = worstProblem(again.failures);
      return {
        people: [],
        peopleReason: projectRosterMessage({
          clientName: input.clientName,
          projectName,
          problem: againFailure.problem,
          accounts: againFailure.accounts,
        }),
        projectId,
        reader: null,
      };
    }
  }

  return {
    people: [],
    peopleReason: projectRosterMessage({
      clientName: input.clientName,
      projectName,
      problem: failure.problem,
      accounts: failure.accounts,
    }),
    projectId,
    reader: null,
  };
}

async function tryAccounts(
  read: RosterRead,
  identities: RosterAccount[],
  projectId: string
): Promise<{
  people: BcPerson[];
  reader: BcIdentity | null;
  failures: Array<{ problem: ProjectRosterProblem; account: string }>;
}> {
  const failures: Array<{ problem: ProjectRosterProblem; account: string }> = [];
  for (const entry of identities) {
    let result: { people: BcPerson[]; problem: ProjectRosterProblem | null };
    try {
      result = await read(projectId, entry.identity);
    } catch {
      failures.push({ problem: "unreachable", account: entry.account });
      continue;
    }
    if (result.people.length) {
      return { people: result.people, reader: entry.identity, failures };
    }
    failures.push({ problem: result.problem || "empty", account: entry.account });
  }
  return { people: [], reader: null, failures };
}
