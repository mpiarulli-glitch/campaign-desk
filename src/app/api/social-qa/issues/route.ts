import { NextResponse } from "next/server";
import { isSocialQaAuthenticated } from "@/lib/auth";
import { listSocialIssueRows, socialIssueCounts } from "@/lib/social-qa";

export async function GET() {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    counts: socialIssueCounts(),
    rows: listSocialIssueRows(),
  });
}
