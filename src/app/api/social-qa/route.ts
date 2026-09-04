import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor } from "@/lib/auth";
import { createSocialBatch, listSocialBatches } from "@/lib/social-qa";

export async function GET(request: Request) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  return NextResponse.json({ batches: listSocialBatches(archived) });
}

export async function POST(request: Request) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  const createdBy = await sessionActor();
  const posts = Array.isArray(body.posts)
    ? body.posts
        .filter((p: { title?: unknown }) => typeof p?.title === "string" && p.title.trim())
        .map((p: { title: string; channel?: string; goLiveOn?: string; createdBy?: string }) => ({
          title: p.title,
          channel: typeof p.channel === "string" ? p.channel : "",
          goLiveOn: typeof p.goLiveOn === "string" ? p.goLiveOn : null,
          createdBy: typeof p.createdBy === "string" ? p.createdBy : createdBy,
        }))
    : [];
  const batch = createSocialBatch({
    title,
    clientName: typeof body.clientName === "string" ? body.clientName : "",
    clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
    sproutUrl: typeof body.sproutUrl === "string" ? body.sproutUrl : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    createdBy,
    posts,
  });
  return NextResponse.json({ batch }, { status: 201 });
}
