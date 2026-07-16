import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { rotateScheduleToken, getOrCreateScheduleToken } from "@/lib/cadence";

type Params = { params: Promise<{ id: string }> };

// Returns the client's existing schedule token, creating one on first request.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const token = getOrCreateScheduleToken(id);
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ token });
}

// Rotates the token, invalidating any previously shared schedule link.
export async function POST(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const token = rotateScheduleToken(id);
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ token });
}
