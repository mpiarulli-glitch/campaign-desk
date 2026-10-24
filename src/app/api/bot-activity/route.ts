import { NextResponse } from "next/server";
import { botActivityApiGet, botActivityApiPost } from "@/lib/bot-activity";

export const dynamic = "force-dynamic";

function json(result: { status: number; body: unknown; headers?: Record<string, string> }) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store", ...result.headers },
  });
}

// Token-protected. Bots post status here and read Michael's replies.
// The browser session is not accepted.
export async function GET(request: Request) {
  return json(await botActivityApiGet(request));
}

export async function POST(request: Request) {
  return json(await botActivityApiPost(request));
}
