import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createAutomation, listAutomations } from "@/lib/lifecycle";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || undefined;
  return NextResponse.json({ automations: listAutomations(clientId) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  return NextResponse.json({
    automation: createAutomation({
      name,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      platform: typeof body.platform === "string" ? body.platform : undefined,
      kind: typeof body.kind === "string" ? body.kind : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      accountRef: typeof body.accountRef === "string" ? body.accountRef : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      link: typeof body.link === "string" ? body.link : undefined,
    }),
  });
}
