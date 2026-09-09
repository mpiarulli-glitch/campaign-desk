import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import {
  identityForAssigner,
  listAssignTodolists,
} from "@/lib/assign-todo";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const projectId = (url.searchParams.get("basecampProjectId") || "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Pick a project first." }, { status: 400 });
  }
  const slug = await sessionUserSlug();
  const lists = await listAssignTodolists(projectId, identityForAssigner(slug));
  return NextResponse.json({ lists });
}
