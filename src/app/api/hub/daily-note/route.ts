import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { buildDailyNote, loadDailyNotePings } from "@/lib/hub-daily-note";

export async function GET() {
  if (!(await can("page.home"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const person = session?.person || null;
  const note = buildDailyNote();
  const pings = await loadDailyNotePings(person);
  return NextResponse.json({ note, pings, person });
}
