// The current client point of contact, shared by Friday ask and Production.
//
// Friday ask shows and edits contact name, email, and phone. A separate `poc`
// string and a saved Basecamp person id were allowed to win mentions and
// scheduling tags after those fields changed, so Production could chase a
// person Friday ask no longer names. This module is the one read path.
//
// It does not write the database and it does not send anything. A stored
// Basecamp id is kept only when it still agrees with the current contact.
// Empty fields stay empty. Names are never invented from an email handle.
// Two clients with the same name are not treated as the same client.
// Two Friday ask clients on one Basecamp project are not guessed between.

import { usableEmail } from "./email-address";

export type ContactRecord = {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  poc: string;
  basecamp_project_id: string;
  basecamp_contact_id: number;
  fridayAsk: boolean;
};

export type CurrentContact = {
  name: string;
  email: string;
  phone: string;
};

export type RosterPerson = {
  id: number;
  name: string;
  email_address: string;
};

export type ContactMatch =
  | { status: "matched"; person: RosterPerson; via: "saved_id" | "email" | "name" }
  | { status: "empty" }
  | { status: "ambiguous"; reason: "email" | "name" | "email_and_name" }
  | { status: "unmatched" };

export type CanonicalContact = {
  record: ContactRecord;
  borrowed: boolean;
  ambiguous: boolean;
};

function fold(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function namesEqual(a: string, b: string): boolean {
  const left = fold(a);
  const right = fold(b);
  return Boolean(left) && left === right;
}

function emailsEqual(a: string, b: string): boolean {
  const left = usableEmail(a).toLowerCase();
  const right = usableEmail(b).toLowerCase();
  return Boolean(left) && left === right;
}

/**
 * Name, email, and phone Friday ask would show for this one record.
 * The typed contact name wins. `poc` fills the name only when that is blank,
 * so an older point-of-contact string cannot hide a name set on the tab.
 */
export function currentPointOfContact(record: {
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  poc?: string | null;
}): CurrentContact {
  const contactName = (record.contact_name || "").trim();
  const poc = (record.poc || "").trim();
  return {
    name: contactName || poc,
    email: usableEmail(record.contact_email),
    phone: (record.contact_phone || "").trim(),
  };
}

/**
 * Which record's contact Production should use.
 *
 * An enrolled Friday ask client is its own source. Any other client uses the
 * Friday ask contact only when exactly one enrolled client shares its Basecamp
 * project id. A shared name is not an identity. Several enrolled clients on
 * the same project are left alone.
 */
export function canonicalContactRecord(
  client: ContactRecord,
  roster: ContactRecord[]
): CanonicalContact {
  if (client.fridayAsk) {
    return { record: client, borrowed: false, ambiguous: false };
  }
  const projectId = (client.basecamp_project_id || "").trim();
  if (!projectId) {
    return { record: client, borrowed: false, ambiguous: false };
  }
  const shares = roster.filter(
    (row) =>
      row.fridayAsk &&
      row.id !== client.id &&
      (row.basecamp_project_id || "").trim() === projectId
  );
  if (shares.length === 1) {
    return { record: shares[0], borrowed: true, ambiguous: false };
  }
  if (shares.length > 1) {
    return { record: client, borrowed: false, ambiguous: true };
  }
  return { record: client, borrowed: false, ambiguous: false };
}

/**
 * Contact fields a send or a screen should use.
 * Borrowed Friday ask values win. A blank borrowed field falls back to this
 * row's own current contact, which is still a stored value, not a guess.
 * The saved Basecamp id comes from the Friday ask row when one is borrowed,
 * and is not replaced with this row's older id.
 */
export function contactForUse(
  client: ContactRecord,
  roster: ContactRecord[]
): {
  contact: CurrentContact;
  basecampContactId: number;
  sourceClientId: string;
  borrowed: boolean;
  ambiguous: boolean;
} {
  const canonical = canonicalContactRecord(client, roster);
  const fromSource = currentPointOfContact(canonical.record);
  const fromSelf = currentPointOfContact(client);
  const contact = canonical.borrowed
    ? {
        name: fromSource.name || fromSelf.name,
        email: fromSource.email || fromSelf.email,
        phone: fromSource.phone || fromSelf.phone,
      }
    : fromSelf;
  return {
    contact,
    basecampContactId: canonical.borrowed
      ? canonical.record.basecamp_contact_id || 0
      : client.basecamp_contact_id || 0,
    sourceClientId: canonical.borrowed ? canonical.record.id : client.id,
    borrowed: canonical.borrowed,
    ambiguous: canonical.ambiguous,
  };
}

function savedIdAgrees(
  person: RosterPerson,
  contact: CurrentContact,
  people: RosterPerson[]
): boolean {
  const name = contact.name.trim();
  const email = usableEmail(contact.email);
  if (!name && !email) return true;
  if (name && namesEqual(person.name, name)) return true;
  if (email && emailsEqual(person.email_address, email)) return true;
  // The current contact names or emails somebody else. The saved id is stale.
  if (name && people.some((row) => row.id !== person.id && namesEqual(row.name, name))) {
    return false;
  }
  if (
    email &&
    people.some((row) => row.id !== person.id && emailsEqual(row.email_address, email))
  ) {
    return false;
  }
  // A different Friday ask name, with nothing that confirms this saved person,
  // does not keep tagging them. A Basecamp rename still matches when the
  // email above agreed.
  return false;
}

/**
 * Who on this roster is the current contact.
 * Exact email, then exact full name. A saved id is used only when it still
 * agrees. Several matches, or an email and a name that hit different people,
 * match nobody.
 */
export function matchRosterContact(
  contact: CurrentContact,
  people: RosterPerson[],
  basecampContactId = 0
): ContactMatch {
  const name = contact.name.trim();
  const email = usableEmail(contact.email);
  const id = basecampContactId || 0;
  if (id) {
    const picked = people.find((person) => person.id === id);
    if (picked && savedIdAgrees(picked, { name, email, phone: contact.phone }, people)) {
      return { status: "matched", person: picked, via: "saved_id" };
    }
  }
  if (!name && !email) return { status: "empty" };

  const byEmail = email ? people.filter((person) => emailsEqual(person.email_address, email)) : [];
  const byName = name ? people.filter((person) => namesEqual(person.name, name)) : [];

  if (email && name) {
    if (byEmail.length === 1 && byName.length === 1 && byEmail[0].id === byName[0].id) {
      return { status: "matched", person: byEmail[0], via: "email" };
    }
    if (byEmail.length === 1 && byName.length === 0) {
      return { status: "matched", person: byEmail[0], via: "email" };
    }
    if (byEmail.length === 0 && byName.length === 1) {
      return { status: "matched", person: byName[0], via: "name" };
    }
    if (byEmail.length === 0 && byName.length === 0) return { status: "unmatched" };
    if (byEmail.length > 1) return { status: "ambiguous", reason: "email" };
    if (byName.length > 1) return { status: "ambiguous", reason: "name" };
    return { status: "ambiguous", reason: "email_and_name" };
  }
  if (email) {
    if (byEmail.length === 1) return { status: "matched", person: byEmail[0], via: "email" };
    if (byEmail.length > 1) return { status: "ambiguous", reason: "email" };
    return { status: "unmatched" };
  }
  if (byName.length === 1) return { status: "matched", person: byName[0], via: "name" };
  if (byName.length > 1) return { status: "ambiguous", reason: "name" };
  return { status: "unmatched" };
}

/** Sentence for a contact that must not be tagged. Does not mention a guess. */
export function unmatchedContactDetail(input: {
  match: ContactMatch;
  contact: CurrentContact;
  action: string;
}): string {
  const who = input.contact.name.trim();
  if (input.match.status === "ambiguous") {
    const label = who || input.contact.email || "this contact";
    return `More than one Basecamp person matches "${label}", so ${input.action}.`;
  }
  if (who) {
    return `No Basecamp person matches "${who}" on this project, so ${input.action}.`;
  }
  if (input.contact.email) {
    return `No Basecamp person matches the contact email on this project, so ${input.action}.`;
  }
  return `No contact name on this client, so ${input.action}.`;
}

export type FailureContactInput = {
  kind: string;
  subject: string;
};

/**
 * A separate note for the failure panel. The logged detail stays as history.
 * Only contact and email rows get a note. A comment, text, or other delivery
 * error is not rewritten as a contact problem. Duplicate names and duplicate
 * addresses are not chosen between.
 */
export function failureCurrentContactNote(
  failure: FailureContactInput,
  roster: ContactRecord[]
): string {
  if (failure.kind === "contact_unresolved") {
    return noteForClientName(failure.subject, roster);
  }
  if (failure.kind === "email") {
    return noteForAddress(failure.subject, roster);
  }
  return "";
}

function noteForClientName(subject: string, roster: ContactRecord[]): string {
  const key = fold(subject);
  if (!key) return "";
  const hits = roster.filter((row) => fold(row.name) === key);
  if (hits.length === 0) return "";
  if (hits.length === 1) return noteForRecord(hits[0], roster);
  const resolved = hits.map((row) => contactForUse(row, roster));
  const distinct = new Set(
    resolved.map(
      (row) =>
        `${row.sourceClientId}|${row.contact.name}|${row.contact.email}|${row.contact.phone}`
    )
  );
  // Every row with this name resolves to one contact, so the name did not
  // have to choose between people. Different contacts stay unnamed.
  if (distinct.size === 1 && !resolved.some((row) => row.ambiguous)) {
    return formatContactNote(resolved[0]);
  }
  return `Several clients are named "${subject.trim()}". The current point of contact is not shown, because a name alone does not decide which client. The failure above is unchanged.`;
}

function noteForAddress(subject: string, roster: ContactRecord[]): string {
  const key = fold(subject);
  if (!key.includes("@")) return "";
  const ids = new Set<string>();
  for (const row of roster) {
    if (fold(row.contact_email) === key) ids.add(row.id);
    const used = contactForUse(row, roster);
    if (fold(used.contact.email) === key) ids.add(row.id);
  }
  if (ids.size === 0) return "";
  if (ids.size > 1) {
    return "Several clients use this address. The current point of contact is not shown. The failure above is unchanged.";
  }
  const id = [...ids][0];
  const row = roster.find((candidate) => candidate.id === id);
  if (!row) return "";
  return noteForRecord(row, roster);
}

function noteForRecord(row: ContactRecord, roster: ContactRecord[]): string {
  return formatContactNote(contactForUse(row, roster));
}

function formatContactNote(used: {
  contact: CurrentContact;
  borrowed: boolean;
  ambiguous: boolean;
}): string {
  if (used.ambiguous) {
    return "More than one Friday ask client is on this Basecamp project, so the current point of contact is not chosen. The failure above is unchanged.";
  }
  const parts = [used.contact.name, used.contact.email, used.contact.phone].filter(Boolean);
  if (!parts.length) {
    return "Current point of contact is not set. The failure above is unchanged.";
  }
  const label = used.borrowed ? "Current Friday ask contact" : "Current point of contact";
  return `${label}: ${parts.join(" · ")}. The failure above is unchanged.`;
}
