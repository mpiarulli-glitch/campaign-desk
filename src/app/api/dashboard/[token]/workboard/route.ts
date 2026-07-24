import { NextResponse } from "next/server";
import { getClientByDashboardToken, getClientWorkboard } from "@/lib/dashboard";

type Params = { params: Promise<{ token: string }> };

// Public, read-only, token-gated. Polled by the client dashboard's live
// workroom so the office tower reflects to-do movement in near-real-time.
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ workboard: getClientWorkboard(client.id) });
}
