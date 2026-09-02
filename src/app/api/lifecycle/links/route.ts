import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { createLink, listLinks } from "@/lib/lifecycle";

export async function GET(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  return NextResponse.json({
    links: listLinks({
      clientId: sp.get("clientId") || undefined,
      category: sp.get("category") || undefined,
    }),
  });
}

export async function POST(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!title || !url) {
    return NextResponse.json({ error: "A title and a URL are required." }, { status: 400 });
  }
  // Only allow real web links. Blocks javascript: and data: URLs, which would
  // otherwise be rendered as clickable hrefs on the dashboard.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "That URL is not valid." }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Links must start with http or https." }, { status: 400 });
  }

  return NextResponse.json({
    link: createLink({
      title,
      url,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      category: typeof body.category === "string" ? body.category : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    }),
  });
}
