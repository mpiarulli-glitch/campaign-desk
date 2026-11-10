import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { deleteWebsiteProject, updateWebsiteProject } from "@/lib/website-ops";
import type { WebsiteDraft } from "@/lib/website-ops-model";

export const dynamic = "force-dynamic";

async function allowed(): Promise<NextResponse | null> {
  if (!(await can("page.website"))) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await allowed();
  if (denied) return denied;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Partial<WebsiteDraft> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "That project could not be read." }, { status: 400 });
  }
  const result = updateWebsiteProject(id, body, await sessionActor());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ project: result.project });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await allowed();
  if (denied) return denied;
  const { id } = await context.params;
  if (!deleteWebsiteProject(id)) {
    return NextResponse.json({ error: "That project is gone." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
