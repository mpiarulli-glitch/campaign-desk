import { NextResponse } from "next/server";
import { isOwnerToolsAuthenticated } from "@/lib/auth";
import { clearEditorialCalendar } from "@/lib/calendar";
import { getRevClient } from "@/lib/revenue";

/**
 * Clear one client's editorial calendar.
 *
 * Productions and campaign-tab scheduled sends are spared. Requires a clientId
 * and an explicit confirm flag so a stray DELETE cannot wipe a plan.
 */
export async function DELETE(request: Request) {
  if (!(await isOwnerToolsAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Pick a client first." }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Confirm clearing the editorial calendar." },
      { status: 400 }
    );
  }

  const result = clearEditorialCalendar(clientId);
  return NextResponse.json(result);
}
