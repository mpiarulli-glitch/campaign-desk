import { NextResponse } from "next/server";
import { isValidAdminPerson } from "@/lib/admin-people";
import { isValidPerson } from "@/lib/people";
import {
  createAdminImpersonationSession,
  createForecastImpersonationSession,
  createSession,
  getSession,
} from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin" || session.person !== null) {
    return NextResponse.json({ error: "Owner access required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const person = typeof body.person === "string" ? body.person : "";
  const role = body.role === "forecast" ? "forecast" : "admin";

  if (role === "forecast") {
    if (!isValidPerson(person)) {
      return NextResponse.json({ error: "Unknown person" }, { status: 400 });
    }
    await createForecastImpersonationSession(person);
    return NextResponse.json({ ok: true, person, role });
  }

  if (!isValidAdminPerson(person)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 400 });
  }
  await createAdminImpersonationSession(person);
  return NextResponse.json({ ok: true, person, role });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.impersonating) {
    return NextResponse.json(
      { error: "Impersonated session required" },
      { status: 401 }
    );
  }

  await createSession();
  return NextResponse.json({ ok: true });
}
