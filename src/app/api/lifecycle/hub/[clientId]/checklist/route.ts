import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { type HubChecklistKind } from "@/lib/email-launch";
import { addHubChecklistItems } from "@/lib/lifecycle-hub";
import { getRevClient } from "@/lib/revenue";

const KINDS = new Set<HubChecklistKind>(["deliverable", "automation"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const kind = body.kind as HubChecklistKind;
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "Pick deliverable or automation." }, { status: 400 });
  }
  const titles =
    Array.isArray(body.titles) && body.titles.every((t: unknown) => typeof t === "string")
      ? (body.titles as string[])
      : typeof body.title === "string"
        ? body.title
        : "";
  const session = await getSession();
  const result = addHubChecklistItems(
    clientId,
    kind,
    titles,
    session?.person || "michael"
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    items: result.items,
    item: result.items[0],
  });
}
