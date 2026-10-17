import { NextResponse } from "next/server";
import { isProductionAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import {
  SERVICE,
  basecampActorName,
  basecampConnected,
  emptyProjectRosterReason,
  extractProjectId,
  getProjectRosterForMention,
} from "@/lib/basecamp";

// The roster of a client's Basecamp project, for picking their contact.
//
// The contact used to be a typed name that had to match Basecamp exactly, and
// when it did not, the scheduling card was withheld and the client was never
// asked. Picking from the real roster removes the class of mistake: you cannot
// misspell a person you selected from a list.
//
// The enriched roster is used (not plain project people) because a mention
// needs an attachable_sgid, and a contact who cannot be mentioned pings nobody.
// Anyone without one is returned flagged rather than hidden, so the reason a
// person is unpickable is visible instead of them just being missing.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isProductionAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const client = getRevClient(id);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  if (!client.basecamp_project_id) {
    return NextResponse.json({
      people: [],
      reason: "This client has no Basecamp project set.",
    });
  }
  if (!basecampConnected()) {
    return NextResponse.json({
      people: [],
      reason: "Basecamp is not connected.",
    });
  }

  const projectId =
    extractProjectId(client.basecamp_project_id) || client.basecamp_project_id;
  const roster = await getProjectRosterForMention(projectId);
  if (!roster.people.length) {
    return NextResponse.json({
      people: [],
      reason: emptyProjectRosterReason({
        status: roster.status,
        projectId,
        accountName: basecampActorName(SERVICE),
        clientName: client.name,
        serviceAccount: true,
      }),
    });
  }

  return NextResponse.json({
    people: roster.people
      .map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email_address,
        // Our own staff vs the client's people. Both are returned, since the
        // roster is the source of truth about who is actually reachable there,
        // but the picker groups them so a colleague is not chosen by accident.
        isClient: Boolean(person.client),
        mentionable: Boolean(person.attachable_sgid),
      }))
      .sort((a, b) => {
        if (a.isClient !== b.isClient) return a.isClient ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
  });
}
