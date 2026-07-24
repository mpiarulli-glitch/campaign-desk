import { NextResponse } from "next/server";
import { isAdminAuthenticated, isWorkflowAuthenticated } from "@/lib/auth";
import { getHubLinks, setHubLinks } from "@/lib/hub";

export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ links: getHubLinks() });
}

export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const links = setHubLinks({
    docsUrl: typeof body.docsUrl === "string" ? body.docsUrl : undefined,
    filesUrl: typeof body.filesUrl === "string" ? body.filesUrl : undefined,
  });
  return NextResponse.json({ links });
}
