import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import {
  isLinkedInPreset,
  pullClientLinkedInAnalytics,
  type LinkedInPreset,
} from "@/lib/skylead-client-analytics";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const url = new URL(request.url);
  const rangeRaw = url.searchParams.get("range") || "30d";
  const preset: LinkedInPreset = isLinkedInPreset(rangeRaw) ? rangeRaw : "30d";
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const force = url.searchParams.get("force") === "1";

  try {
    const analytics = await pullClientLinkedInAnalytics(
      clientId,
      memberIds,
      preset,
      force
    );
    return NextResponse.json({ analytics });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not load LinkedIn campaigns.",
      },
      { status: 502 }
    );
  }
}
