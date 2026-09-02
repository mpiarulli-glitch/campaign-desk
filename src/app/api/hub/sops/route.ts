import { NextResponse } from "next/server";
import { can, isAdminWithAccess } from "@/lib/auth";
import { createSop, listSops } from "@/lib/hub";

export async function GET() {
  if (!(await can("page.hub"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ sops: listSops() });
}

export async function POST(request: Request) {
  if (!(await isAdminWithAccess("page.hub"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });
  const sop = createSop({
    title,
    category: typeof body.category === "string" ? body.category : "",
    body: typeof body.body === "string" ? body.body : "",
    link: typeof body.link === "string" ? body.link : "",
  });
  return NextResponse.json({ sop });
}
