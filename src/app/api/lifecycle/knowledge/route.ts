import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getEntry, getIndex, getSwipeFile, setRead } from "@/lib/knowledge";

/**
 * The Inbox Newsletter knowledge base.
 *
 *   GET  ?slug=…            one issue, full text
 *   GET  ?view=swipe        every featured email design and template
 *   GET  ?q=…&topic=…       the index, filtered
 *   PATCH { slug, read }    mark an issue read or unread
 */
export async function GET(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;

  const slug = params.get("slug");
  if (slug) {
    const entry = getEntry(slug);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ entry });
  }

  if (params.get("view") === "swipe") {
    return NextResponse.json({ swipe: getSwipeFile() });
  }

  return NextResponse.json(
    getIndex({ q: params.get("q") ?? "", topic: params.get("topic") ?? "" }),
  );
}

export async function PATCH(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.slug !== "string") {
    return NextResponse.json({ error: "A slug is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(setRead(body.slug, body.read !== false));
  } catch {
    return NextResponse.json({ error: "Unknown entry" }, { status: 404 });
  }
}
