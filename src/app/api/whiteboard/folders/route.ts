import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { createFolder, listFolders } from "@/lib/whiteboard";

export async function GET() {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ folders: listFolders() });
}

export async function POST(request: Request) {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  const folder = createFolder(title);
  return NextResponse.json({ folder });
}
