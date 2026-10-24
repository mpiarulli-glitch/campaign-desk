import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { botActivityAdminGet, botActivityAdminPost } from "@/lib/bot-activity";

export const dynamic = "force-dynamic";

function json(result: { status: number; body: unknown; headers?: Record<string, string> }) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store", ...result.headers },
  });
}

// Owner session only. The bot token is not accepted on this route.
export async function GET() {
  return json(botActivityAdminGet(await getSession()));
}

export async function POST(request: Request) {
  return json(await botActivityAdminPost(request, await getSession()));
}
