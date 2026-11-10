import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { commitWebsiteImport } from "@/lib/website-ops";
import { parseWebsiteCsv } from "@/lib/website-ops-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await can("page.website"))) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    csv?: string;
    commit?: boolean;
    fileAs?: "auto" | "non_responsive";
  } | null;
  const csv = body?.csv || "";
  if (!csv.trim()) {
    return NextResponse.json({ error: "Paste a CSV first." }, { status: 400 });
  }
  const fileAs = body?.fileAs === "non_responsive" ? "non_responsive" : "auto";
  const preview = parseWebsiteCsv(csv, fileAs);
  if (!body?.commit) {
    return NextResponse.json({
      ...preview,
      created: 0,
      skipped: 0,
      committed: false,
    });
  }
  const result = commitWebsiteImport(
    preview.rows.map((row) => row.draft),
    await sessionActor()
  );
  return NextResponse.json({
    ...preview,
    ...result,
    errors: [...preview.errors, ...result.errors],
    committed: true,
  });
}
