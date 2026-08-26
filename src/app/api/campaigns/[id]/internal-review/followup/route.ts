import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import { followUpInternalReview } from "@/lib/internal-review";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
  const result = await followUpInternalReview(id, identity);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
