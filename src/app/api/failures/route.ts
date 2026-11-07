import { NextResponse } from "next/server";
import { isProductionAuthenticated } from "@/lib/auth";
import { failureContactNote, loadContactRoster } from "@/lib/client-contact-source";
import { dismissFailure, listOpenFailures } from "@/lib/failures";

// Everything the app tried and could not do. Staff only: the details name
// Basecamp projects and client contacts.
export async function GET() {
  if (!(await isProductionAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roster = loadContactRoster();
  const failures = listOpenFailures().map((failure) => ({
    ...failure,
    // Logged detail stays as it was recorded. This line is the contact now.
    current_contact_note: failureContactNote(failure, roster),
  }));
  return NextResponse.json({ failures });
}

// Dismissing is for failures that are handled or no longer relevant. Anything
// still genuinely broken comes back on the next attempt, which is the point.
export async function POST(request: Request) {
  if (!(await isProductionAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (!dismissFailure(body.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
