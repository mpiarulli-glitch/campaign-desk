import { NextResponse } from "next/server";
import { can, getSession, isAdminWithAccess } from "@/lib/auth";
import { createTraining, listTraining } from "@/lib/hub";

export async function GET() {
  if (!(await can("page.hub"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ posts: listTraining() });
}

export async function POST(request: Request) {
  if (!(await isAdminWithAccess("page.hub"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });
  const post = createTraining({
    title,
    kind: body.kind === "ai" ? "ai" : "marketing",
    body: typeof body.body === "string" ? body.body : "",
    link: typeof body.link === "string" ? body.link : "",
    createdBy: session?.person || "admin",
  });
  return NextResponse.json({ post });
}
