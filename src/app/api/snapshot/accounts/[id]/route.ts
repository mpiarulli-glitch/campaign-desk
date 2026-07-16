import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getAccount, getOrCreateToken, listDeliverables } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const account = getAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    account: { id: account.id, name: account.name },
    deliverables: listDeliverables(id),
    token: getOrCreateToken(id),
  });
}
