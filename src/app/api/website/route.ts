import { NextResponse } from "next/server";
import { accessSubject, can, sessionActor } from "@/lib/auth";
import { createWebsiteProject, listWebsiteClients, listWebsiteProjects } from "@/lib/website-ops";
import {
  LANDING_STAGES,
  WEBSITE_OWNER_CHIPS,
  WEBSITE_STAGES,
  deskToday,
  websitePersonName,
  weekLabel,
  type WebsiteDraft,
} from "@/lib/website-ops-model";

export const dynamic = "force-dynamic";

async function allowed(): Promise<NextResponse | null> {
  if (!(await can("page.website"))) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  return null;
}

function deskPayload(meName: string | null) {
  const today = deskToday();
  return {
    today,
    weekLabel: weekLabel(today),
    projects: listWebsiteProjects(),
    clients: listWebsiteClients(),
    meName,
    owners: WEBSITE_OWNER_CHIPS,
    stages: { website: WEBSITE_STAGES, landing: LANDING_STAGES },
  };
}

export async function GET() {
  const denied = await allowed();
  if (denied) return denied;
  const who = await accessSubject();
  const meName = websitePersonName(who?.owner ? null : who?.person);
  return NextResponse.json(deskPayload(meName));
}

export async function POST(request: Request) {
  const denied = await allowed();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Partial<WebsiteDraft> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "That project could not be read." }, { status: 400 });
  }
  const result = createWebsiteProject(body, await sessionActor());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ project: result.project });
}
