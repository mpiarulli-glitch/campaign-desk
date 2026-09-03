import { NextResponse } from "next/server";
import { can, getSession, isAdminWithAccess } from "@/lib/auth";
import { currentMonth, getMyCheckin, listCheckins, upsertCheckin } from "@/lib/hub";

export async function GET(request: Request) {
  if (!(await can("page.home"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const month = new URL(request.url).searchParams.get("month") || currentMonth();
  const mine = session?.person ? getMyCheckin(session.person, month) : null;
  const isAdmin = await isAdminWithAccess("page.home");
  return NextResponse.json({
    month,
    mine,
    // Admins get the full roster of responses; everyone else only their own.
    all: isAdmin ? listCheckins(month) : null,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  // Must be a named person to log a personal check-in (bare owner has none).
  if (session?.role === "forecast" || (session?.role === "admin" && session.person)) {
    const body = await request.json().catch(() => ({}));
    const month = typeof body.month === "string" && body.month ? body.month : currentMonth();
    const score = Number(body.score);
    if (!Number.isFinite(score)) {
      return NextResponse.json({ error: "Pick a score." }, { status: 400 });
    }
    const checkin = upsertCheckin(session.person!, month, score, typeof body.note === "string" ? body.note : "");
    return NextResponse.json({ checkin });
  }
  return NextResponse.json({ error: "A named account is required to check in." }, { status: 401 });
}
