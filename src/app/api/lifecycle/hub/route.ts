import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated } from "@/lib/auth";
import { addClientToHub, buildLifecycleHub } from "@/lib/lifecycle-hub";
import { isEmailPlatform, isYmd } from "@/lib/email-launch";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json(buildLifecycleHub());
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const launchDate = typeof body.launchDate === "string" ? body.launchDate : "";
  const platform = isEmailPlatform(body.platform) ? body.platform : null;
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  if (!isYmd(launchDate)) {
    return NextResponse.json({ error: "Pick a launch date." }, { status: 400 });
  }
  if (!platform) {
    return NextResponse.json({ error: "Pick a platform." }, { status: 400 });
  }
  const session = await getSession();
  const result = addClientToHub(clientId, launchDate, session?.person || "michael", undefined, platform);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(buildLifecycleHub());
}
