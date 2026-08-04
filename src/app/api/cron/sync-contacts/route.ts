import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { syncClientContacts } from "@/lib/contact-sync";

// Reconciles each client's Contact name against the person Basecamp has on their
// project, so scheduling cards can assign and tag the client.
//
// Previews by default. Writing needs ?apply=1, because this edits client records
// and a preview that quietly saved would be a trap.

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = createHmac("sha256", expected).update(provided).digest();
  const b = createHmac("sha256", expected).update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

async function handle(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }
  const apply = new URL(request.url).searchParams.get("apply") === "1";
  const result = await syncClientContacts({ apply });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
