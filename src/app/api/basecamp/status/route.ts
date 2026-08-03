import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  basecampConfigured,
  basecampConnected,
  disconnectBasecamp,
  getServiceIdentity,
} from "@/lib/basecamp";
import { listConnections } from "@/lib/basecamp-identity";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identity = getServiceIdentity();

  // The service connection is meant to be the mascot account, not a person. If
  // its Basecamp id also belongs to somebody's personal connection, then every
  // reminder and approval card is going out under that person's name, which is
  // exactly what the per-person connections exist to avoid. Say so plainly
  // rather than reporting a cheerful "connected".
  const clash = identity
    ? listConnections().find((c) => c.bc_person_id === identity.id) || null
    : null;

  return NextResponse.json({
    configured: basecampConfigured(),
    connected: basecampConnected(),
    identity,
    // Null when the service account is nobody's personal login, which is right.
    personalLoginInUse: clash
      ? { person: clash.person, name: clash.bc_name }
      : null,
  });
}

// Disconnect (clear stored tokens).
export async function DELETE() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  disconnectBasecamp();
  return NextResponse.json({ ok: true });
}
