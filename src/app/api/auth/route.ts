import { NextResponse } from "next/server";
import {
  createSession,
  createForecastSession,
  clearSession,
  getSession,
  verifyPassword,
  verifyForecastPassword,
} from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    authenticated: Boolean(session),
    role: session?.role || null,
    person: session?.role === "forecast" ? session.person : null,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const person = typeof body.person === "string" ? body.person : "";

  if (!verifyPassword(password)) {
    if (!person || !verifyForecastPassword(person, password)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await createForecastSession(person);
    return NextResponse.json({ ok: true, role: "forecast", person });
  }

  await createSession();
  return NextResponse.json({ ok: true, role: "admin" });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
