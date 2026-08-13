import { NextResponse } from "next/server";
import { answerLead, getAccountByToken, type LeadConverted } from "@/lib/snapshot";

type Params = { params: Promise<{ token: string }> };

const CONVERTED: LeadConverted[] = ["unknown", "yes", "no"];

// The client answering "did this lead turn into business?" from the shared
// link. Public by design — the token is the access grant, same as the GET —
// but answerLead is scoped to the token's account, so a lead id belonging to
// another client can't be written through this route.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const converted = typeof body.converted === "string" ? body.converted : "";
  if (!leadId || !CONVERTED.includes(converted as LeadConverted)) {
    return NextResponse.json(
      { error: "leadId and converted (yes | no | unknown) are required" },
      { status: 400 }
    );
  }
  const lead = answerLead(
    account.id,
    leadId,
    converted as LeadConverted,
    typeof body.clientNote === "string" ? body.clientNote : undefined
  );
  if (!lead) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ lead });
}
