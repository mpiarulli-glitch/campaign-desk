import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { basecampConfigured } from "@/lib/basecamp";
import { disconnectPerson, getConnection } from "@/lib/basecamp-identity";

// Your own Basecamp connection. Always scoped to the session: there is no way to
// read or change somebody else's from here, and an impersonated session resolves
// to null so an admin cannot connect an account on a teammate's behalf.

export async function GET() {
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json({ error: "Sign in as yourself." }, { status: 401 });
  }
  const conn = getConnection(person);
  return NextResponse.json({
    configured: basecampConfigured(),
    connected: Boolean(conn),
    name: conn?.bc_name || null,
    email: conn?.bc_email || null,
    connectedAt: conn?.connected_at || null,
    // Present when a refresh has failed, which is the difference between
    // "not connected" and "reconnect, this stopped working".
    error: conn?.last_error || null,
    connectUrl: `${getAppUrl()}/api/basecamp/me/connect`,
  });
}

// Disconnect. Deliberately not a full revoke at Basecamp: dropping the tokens is
// what stops this app acting as them, and revoking the whole integration would
// also cut off everyone else on the shared client id.
export async function DELETE() {
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json({ error: "Sign in as yourself." }, { status: 401 });
  }
  disconnectPerson(person);
  return NextResponse.json({ ok: true });
}
