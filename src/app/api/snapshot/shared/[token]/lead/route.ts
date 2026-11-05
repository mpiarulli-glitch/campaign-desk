import { NextResponse } from "next/server";
import { getAccountByToken } from "@/lib/snapshot";

type Params = { params: Promise<{ token: string }> };

// Clients are not asked to mark a lead won or lost. The token link used to
// accept that answer. It no longer writes. The team still records outcomes
// from the account page.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  await request.json().catch(() => ({}));
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "Clients are not asked to mark leads." },
    { status: 410 }
  );
}
