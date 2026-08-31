import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured, listWorkflows } from "@/lib/ghl";
import { getRevClient } from "@/lib/revenue";

function resolveLocationId(clientId: string, memberIds: string[]): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    const loc = (getRevClient(id)?.ghl_location_id || "").trim();
    if (loc) return loc;
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const url = new URL(request.url);
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const locationId = resolveLocationId(clientId, memberIds);
  if (!locationId) {
    return NextResponse.json(
      {
        error:
          "This account has no GoHighLevel location linked. Map it from Lifecycle → Tools.",
      },
      { status: 422 }
    );
  }

  try {
    const workflows = (await listWorkflows(locationId))
      .map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        live: w.status === "published",
        updatedAt: w.updatedAt,
      }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));

    return NextResponse.json({
      clientId,
      clientName: client.name,
      locationId,
      fetchedAt: new Date().toISOString(),
      live: workflows.filter((w) => w.live).length,
      total: workflows.length,
      workflows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not load GoHighLevel workflows.",
      },
      { status: 502 }
    );
  }
}
