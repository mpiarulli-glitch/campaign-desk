import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { addLead, getAccount, listLeads, type LeadSource } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// Leads for an account. ?week=YYYY-MM-DD narrows to that week; omitting it
// (or passing week=all) returns every lead.
export async function GET(request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const week = new URL(request.url).searchParams.get("week") || "";
  return NextResponse.json({
    leads: listLeads(id, WEEK_RE.test(week) ? { week } : undefined),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  // Bulk insert, used by the CSV upload in the client services panel. Kept on
  // the same route as the single add so both go through one auth check and one
  // account lookup, and so the single-lead callers keep working untouched.
  //
  // Rows are validated first and inserted second: a file where row 40 is bad
  // should not leave rows 1 to 39 in the database with no way to tell what
  // landed. Anything rejected comes back with its row number so the person can
  // fix the sheet rather than guess.
  if (Array.isArray(body.leads)) {
    const MAX = 500;
    if (body.leads.length === 0) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }
    if (body.leads.length > MAX) {
      return NextResponse.json(
        { error: `Too many rows: ${body.leads.length}. The limit is ${MAX} per upload.` },
        { status: 400 }
      );
    }

    const clean: Parameters<typeof addLead>[0][] = [];
    const rejected: { row: number; reason: string }[] = [];

    body.leads.forEach((raw: Record<string, unknown>, i: number) => {
      const row = i + 1;
      const first = typeof raw?.firstName === "string" ? raw.firstName.trim() : "";
      if (!first) {
        rejected.push({ row, reason: "First name is required" });
        return;
      }
      const on = typeof raw?.receivedOn === "string" ? raw.receivedOn.trim() : "";
      if (on && !WEEK_RE.test(on)) {
        rejected.push({ row, reason: `Date must be YYYY-MM-DD, got "${on}"` });
        return;
      }
      clean.push({
        clientId: id,
        firstName: first,
        lastName: typeof raw?.lastName === "string" ? raw.lastName : "",
        email: typeof raw?.email === "string" ? raw.email : "",
        phone: typeof raw?.phone === "string" ? raw.phone : "",
        source: raw?.source as LeadSource,
        receivedOn: on,
        notes: typeof raw?.notes === "string" ? raw.notes : "",
      });
    });

    if (clean.length === 0) {
      return NextResponse.json(
        { error: "Nothing in that file could be imported.", rejected },
        { status: 400 }
      );
    }

    const created = clean.map((row) => addLead(row));
    return NextResponse.json(
      { added: created.length, leads: created, rejected },
      { status: 201 }
    );
  }

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  if (!firstName) {
    return NextResponse.json({ error: "First name is required" }, { status: 400 });
  }
  const receivedOn = typeof body.receivedOn === "string" ? body.receivedOn : "";
  if (receivedOn && !WEEK_RE.test(receivedOn)) {
    return NextResponse.json({ error: "receivedOn must be YYYY-MM-DD" }, { status: 400 });
  }
  const lead = addLead({
    clientId: id,
    firstName,
    lastName: typeof body.lastName === "string" ? body.lastName : "",
    email: typeof body.email === "string" ? body.email : "",
    phone: typeof body.phone === "string" ? body.phone : "",
    source: body.source as LeadSource,
    receivedOn,
    notes: typeof body.notes === "string" ? body.notes : "",
  });
  return NextResponse.json({ lead }, { status: 201 });
}
