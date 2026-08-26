import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated } from "@/lib/auth";
import { createLaunchTodos, setClientEmailPlatform } from "@/lib/lifecycle-hub";
import { isEmailPlatform, isYmd } from "@/lib/email-launch";
import { getRevClient } from "@/lib/revenue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const launchDate = typeof body.launchDate === "string" ? body.launchDate : startDate;
  const platform = isEmailPlatform(body.platform) ? body.platform : null;
  if (platform && !isYmd(launchDate)) {
    setClientEmailPlatform(clientId, platform);
    return NextResponse.json({ ok: true });
  }
  if (!isYmd(launchDate)) {
    return NextResponse.json({ error: "Pick a launch date." }, { status: 400 });
  }
  if (!platform) {
    return NextResponse.json({ error: "Pick a platform." }, { status: 400 });
  }
  const session = await getSession();
  const result = createLaunchTodos(clientId, launchDate, session?.person || "michael", platform);
  if (result.skipped && result.reason === "A launch checklist already exists for this client.") {
    return NextResponse.json(result, { status: 409 });
  }
  if (result.skipped) {
    return NextResponse.json({ error: result.reason || "Could not create those to-dos." }, { status: 400 });
  }
  return NextResponse.json(result);
}
