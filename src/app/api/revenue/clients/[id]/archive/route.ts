import { NextResponse } from "next/server";
import { archiveClient, unarchiveClient } from "@/lib/active-clients";
import { isAdminAuthenticated, sessionActor } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

export type ArchiveRequestResult = {
  status: number;
  body: {
    error?: string;
    client?: {
      id: string;
      name: string;
      archived_at: string | null;
      archived_by: string;
    };
  };
};

/** Shared by the route and tests. Auth is decided by the caller. */
export function applyClientArchive(input: {
  id: string;
  archived: unknown;
  isAdmin: boolean;
  actor: string;
}): ArchiveRequestResult {
  if (!input.isAdmin) return { status: 401, body: { error: "Unauthorized" } };
  if (!getRevClient(input.id)) return { status: 404, body: { error: "Not found" } };
  if (typeof input.archived !== "boolean") {
    return { status: 400, body: { error: "archived must be true or false." } };
  }
  const client = input.archived
    ? archiveClient(input.id, input.actor.trim() || "admin")
    : unarchiveClient(input.id);
  if (!client) return { status: 404, body: { error: "Not found" } };
  return {
    status: 200,
    body: {
      client: {
        id: client.id,
        name: client.name,
        archived_at: client.archived_at,
        archived_by: client.archived_by,
      },
    },
  };
}

// Admin-only. Archive hides the client from active lists. Unarchive puts the
// same row back. Neither deletes campaigns, snapshots, or anything else.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = applyClientArchive({
    id,
    archived: body.archived,
    isAdmin: await isAdminAuthenticated(),
    actor: await sessionActor(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
