import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getVisibleSnapshotAccount, rotateToken } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getVisibleSnapshotAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const token = rotateToken(id);
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ token });
}
