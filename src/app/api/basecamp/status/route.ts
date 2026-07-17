import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConfigured, basecampConnected, disconnectBasecamp } from "@/lib/basecamp";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    configured: basecampConfigured(),
    connected: basecampConnected(),
  });
}

// Disconnect (clear stored tokens).
export async function DELETE() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  disconnectBasecamp();
  return NextResponse.json({ ok: true });
}
