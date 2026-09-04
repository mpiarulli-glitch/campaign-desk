import { NextResponse } from "next/server";
import { isSocialQaAuthenticated } from "@/lib/auth";
import {
  deleteSocialBatch,
  getSocialBatch,
  isSocialBatchStatus,
  listSocialPosts,
  updateSocialBatch,
} from "@/lib/social-qa";
import { actorLabel } from "@/lib/people";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const batch = getSocialBatch(id);
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    batch: {
      ...batch,
      created_by_label: actorLabel(batch.created_by),
      approved_by_slug_label: batch.approved_by_slug
        ? actorLabel(batch.approved_by_slug)
        : null,
    },
    posts: listSocialPosts(id).map((p) => ({
      ...p,
      created_by_label: actorLabel(p.created_by),
      qa_by_label: p.qa_by ? actorLabel(p.qa_by) : null,
    })),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = isSocialBatchStatus(body.status) ? body.status : undefined;
  const batch = updateSocialBatch(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    clientName: typeof body.clientName === "string" ? body.clientName : undefined,
    clientId:
      body.clientId === null
        ? null
        : typeof body.clientId === "string"
          ? body.clientId
          : undefined,
    sproutUrl: typeof body.sproutUrl === "string" ? body.sproutUrl : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    status,
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
  });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ batch });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!deleteSocialBatch(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
