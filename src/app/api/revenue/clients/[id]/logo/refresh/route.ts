import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { refreshClientLogo } from "@/lib/client-logo-fetch";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  if (!(await can("tool.client_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await refreshClientLogo(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ logo_url: result.logoUrl, source: result.source });
}
