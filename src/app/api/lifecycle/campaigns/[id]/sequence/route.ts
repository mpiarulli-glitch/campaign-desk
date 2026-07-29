import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getSequence, sweep } from "@/lib/skylead";

/**
 * The sequence for one Skylead campaign: every step, its copy, and its own
 * accept/reply rate.
 *
 * The seat id is resolved from the cached sweep rather than taken from the
 * query string, so a caller can't point this at an arbitrary account.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: "Bad campaign id" }, { status: 400 });
  }

  let data;
  try {
    data = await sweep();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach Skylead" },
      { status: 502 }
    );
  }

  const owner = data.seats.find((s) => s.campaigns.some((c) => c.id === campaignId));
  if (!owner) {
    return NextResponse.json({ error: "Unknown campaign" }, { status: 404 });
  }

  try {
    const sequence = await getSequence(data.userId, owner.seat.id, campaignId);
    return NextResponse.json({ sequence });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load the sequence" },
      { status: 502 }
    );
  }
}
