import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import { updateRevClient } from "@/lib/revenue";
import {
  applyContractDeliverables,
  parseContractText,
  type DeliverableInput,
} from "@/lib/contract-import";
import { extractPdfText, isPdf } from "@/lib/pdf-text";

type Params = { params: Promise<{ id: string }> };

// A signed services agreement is a handful of pages. Anything past this is not a
// contract, and refusing early beats inflating 50 MB of streams to find out.
const MAX_PDF_BYTES = 20_000_000;
const MAX_TEXT_CHARS = 400_000;

const CADENCE_UNITS = ["weekly", "monthly", "quarterly"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a contract into proposed deliverables. Never writes.
 *
 * Takes a PDF as multipart form data, or already-extracted text as JSON — the
 * second is both the paste-it-instead fallback for a scanned contract and how the
 * scope of work gets in when it lives in an email rather than a PDF.
 */
export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getVisibleSnapshotAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") || "";
  let text = "";
  let source = "text";
  let pages: number | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "That PDF is too large. Send just the agreement, not the full signing packet." },
        { status: 413 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isPdf(buf)) {
      return NextResponse.json(
        { error: "That is not a PDF. Upload the contract as a PDF, or paste its scope of work as text." },
        { status: 400 }
      );
    }
    let extracted;
    try {
      extracted = extractPdfText(buf);
    } catch {
      return NextResponse.json(
        {
          error:
            "This PDF could not be read. Paste the scope of work as text instead and it will be parsed the same way.",
        },
        { status: 422 }
      );
    }
    // A scan has no text layer to read. Say so plainly and point at the way
    // through, rather than returning zero deliverables and no explanation.
    if (extracted.looksScanned) {
      return NextResponse.json(
        {
          error:
            "This PDF has no readable text — it looks like a scan or an image export. Copy the scope of work and paste it as text instead.",
          looksScanned: true,
        },
        { status: 422 }
      );
    }
    text = extracted.text;
    pages = extracted.pages;
    source = "pdf";
  } else {
    const body = await request.json().catch(() => ({}));
    text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
      return NextResponse.json({ error: "Paste the contract text first." }, { status: 400 });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json({ error: "That is more text than a contract." }, { status: 413 });
    }
  }

  const parsed = parseContractText(id, text);
  return NextResponse.json({
    ...parsed,
    source,
    pages,
    // Returned so the review UI can show the text that was read. An admin who
    // sees the extraction can tell a bad parse from a bad PDF in one look.
    text,
  });
}

/**
 * Save the rows the admin approved, after editing.
 *
 * The rows come from the browser rather than from a re-parse, because the point
 * of the review table is that what gets saved is what the admin corrected — not
 * what the parser first guessed.
 */
export async function PUT(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getVisibleSnapshotAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body.deliverables) ? body.deliverables : [];
  if (!raw.length) {
    return NextResponse.json({ error: "Nothing selected to add." }, { status: 400 });
  }

  const rows: DeliverableInput[] = raw
    .filter((r: unknown): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r: Record<string, unknown>) => ({
      name: typeof r.name === "string" ? r.name : "",
      category: typeof r.category === "string" ? r.category : "",
      // Anything that is not a real team slug is normalised to unassigned in the
      // lib, so a stale browser cannot write a bogus team.
      team: typeof r.team === "string" ? r.team : "",
      cadence: typeof r.cadence === "string" ? r.cadence : "",
      kind: r.kind === "one_time" ? ("one_time" as const) : ("recurring" as const),
      cadenceUnit: CADENCE_UNITS.includes(r.cadenceUnit as (typeof CADENCE_UNITS)[number])
        ? (r.cadenceUnit as (typeof CADENCE_UNITS)[number])
        : undefined,
    }))
    .filter((r: DeliverableInput) => r.name.trim().length > 0);

  if (!rows.length) {
    return NextResponse.json({ error: "Every selected row is missing a name." }, { status: 400 });
  }

  const result = applyContractDeliverables(id, rows);

  // The contract's commercial terms, applied only when the admin ticked the box.
  // Kept separate from the deliverables so a good scope read is never held up by
  // a wrong retainer figure.
  let termsApplied = false;
  if (body.terms && typeof body.terms === "object") {
    const t = body.terms as Record<string, unknown>;
    const updates: Parameters<typeof updateRevClient>[1] = {};
    if (typeof t.monthlyRetainer === "number" && t.monthlyRetainer > 0) {
      updates.retainer = t.monthlyRetainer;
    }
    if (typeof t.contractStart === "string" && DATE_RE.test(t.contractStart)) {
      updates.contractStart = t.contractStart;
    }
    if (typeof t.contractEnd === "string" && DATE_RE.test(t.contractEnd)) {
      updates.contractEnd = t.contractEnd;
    }
    if (Object.keys(updates).length > 0) {
      updateRevClient(id, updates);
      termsApplied = true;
    }
  }

  return NextResponse.json({ ...result, termsApplied });
}
