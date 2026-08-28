import { NextResponse } from "next/server";
import { isOwnerToolsAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import {
  applyCalendarImport,
  listImportBatches,
  previewCalendarImport,
  undoCalendarImport,
  type ImportMode,
} from "@/lib/calendar-import";

// A year of editorial planning is a few hundred rows at most. The cap is here to
// stop a wrong file (a database dump, a video) being parsed, not to ration real
// calendars.
const MAX_CSV_BYTES = 4_000_000;

const MODES: ImportMode[] = ["add", "skip_duplicates", "replace_range"];

/** Recent import batches for the client, so a bad import can be undone. */
export async function GET(request: Request) {
  if (!(await isOwnerToolsAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ batches: listImportBatches(clientId) });
}

/**
 * Preview or commit a calendar import.
 *
 * `commit: false` (the default) parses and diffs without writing anything, which
 * is the only way the UI ever reaches this on the first pass. A commit re-parses
 * the same text rather than trusting a row list posted back from the browser, so
 * there is no window where the preview and the write can disagree.
 */
export async function POST(request: Request) {
  if (!(await isOwnerToolsAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const csv = typeof body.csv === "string" ? body.csv : "";

  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Pick a client to import into." }, { status: 400 });
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json(
      { error: "That file is too big to be a calendar. Export just the calendar sheet as CSV." },
      { status: 413 }
    );
  }

  if (body.commit !== true) {
    return NextResponse.json({
      preview: previewCalendarImport(clientId, csv),
      client: { id: client.id, name: client.name },
    });
  }

  const mode: ImportMode = MODES.includes(body.mode) ? body.mode : "skip_duplicates";
  const result = applyCalendarImport(clientId, csv, mode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ result });
}

/** Undo an import by its batch id. */
export async function DELETE(request: Request) {
  if (!(await isOwnerToolsAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const batchId = typeof body.batchId === "string" ? body.batchId : "";
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = undoCalendarImport(clientId, batchId);
  if (!result.ok) {
    return NextResponse.json({ error: "That import is already gone." }, { status: 404 });
  }
  return NextResponse.json(result);
}
