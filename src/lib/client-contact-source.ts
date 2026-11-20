// Load the client roster and apply the shared contact rules.
// Reading only. Nothing here updates a client, dismisses a failure, or sends.

import type { RevClient } from "./db";
import {
  contactForUse,
  currentPointOfContact,
  failureCurrentContactNote,
  matchRosterContact,
  unmatchedContactDetail,
  type ContactMatch,
  type ContactRecord,
  type CurrentContact,
  type RosterPerson,
} from "./client-contact";
import { listRevClients } from "./revenue";
import { enrolledClientIds } from "./snapshot-enrollment";

export type ContactClientInput = {
  id: string;
  name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  poc?: string | null;
  basecamp_project_id?: string | null;
  basecamp_contact_id?: number | null;
};

export type OutreachContact<T extends ContactClientInput = RevClient> = {
  contact: CurrentContact;
  basecampContactId: number;
  sourceClientId: string;
  borrowed: boolean;
  ambiguous: boolean;
  /** Same client, with contact fields replaced by the current point of contact. */
  client: T;
};

export function contactRecordFromClient(client: RevClient, fridayAsk: boolean): ContactRecord {
  return {
    id: client.id,
    name: client.name || "",
    contact_name: client.contact_name || "",
    contact_email: client.contact_email || "",
    contact_phone: client.contact_phone || "",
    poc: client.poc || "",
    basecamp_project_id: client.basecamp_project_id || "",
    basecamp_contact_id: client.basecamp_contact_id || 0,
    fridayAsk,
  };
}

export function loadContactRoster(): ContactRecord[] {
  const enrolled = enrolledClientIds();
  return listRevClients(true).map((client) =>
    contactRecordFromClient(client, enrolled.has(client.id))
  );
}

/**
 * Current contact for a send or a screen.
 * The passed client's own fields are the starting point, so a caller that
 * blanked a phone on a copy is respected. A uniquely linked Friday ask client
 * still supplies the contact when this row is not itself on Friday ask.
 */
export function outreachContact<T extends ContactClientInput>(
  client: T,
  roster: ContactRecord[] = loadContactRoster()
): OutreachContact<T> {
  const enrolled = roster.find((row) => row.id === client.id)?.fridayAsk ?? false;
  const self: ContactRecord = {
    id: client.id,
    name: client.name || "",
    contact_name: client.contact_name || "",
    contact_email: client.contact_email || "",
    contact_phone: client.contact_phone || "",
    poc: client.poc || "",
    basecamp_project_id: client.basecamp_project_id || "",
    basecamp_contact_id: client.basecamp_contact_id || 0,
    fridayAsk: enrolled,
  };
  const used = contactForUse(self, roster);
  return {
    contact: used.contact,
    basecampContactId: used.basecampContactId,
    sourceClientId: used.sourceClientId,
    borrowed: used.borrowed,
    ambiguous: used.ambiguous,
    client: {
      ...client,
      contact_name: used.contact.name,
      contact_email: used.contact.email,
      contact_phone: used.contact.phone,
      poc: used.contact.name,
      basecamp_contact_id: used.basecampContactId,
    },
  };
}

export function matchClientOnRoster(
  client: ContactClientInput,
  people: RosterPerson[],
  roster?: ContactRecord[]
): { match: ContactMatch; contact: CurrentContact; person: RosterPerson | null } {
  const view = outreachContact(client, roster);
  const match = matchRosterContact(view.contact, people, view.basecampContactId);
  const person =
    match.status === "matched"
      ? people.find((row) => row.id === match.person.id) || match.person
      : null;
  return { match, contact: view.contact, person };
}

export function contactMissDetail(
  client: ContactClientInput,
  people: RosterPerson[],
  action: string,
  roster?: ContactRecord[]
): { person: RosterPerson | null; detail: string; contact: CurrentContact } {
  const found = matchClientOnRoster(client, people, roster);
  if (found.person) {
    return { person: found.person, detail: "", contact: found.contact };
  }
  return {
    person: null,
    contact: found.contact,
    detail: unmatchedContactDetail({
      match: found.match,
      contact: found.contact,
      action,
    }),
  };
}

export function failureContactNote(
  failure: { kind: string; subject: string },
  roster: ContactRecord[] = loadContactRoster()
): string {
  return failureCurrentContactNote(failure, roster);
}

export { currentPointOfContact };
