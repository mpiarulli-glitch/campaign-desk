import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import { handleGhlCallback } from "@/lib/ghl-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await handleGhlCallback({
    isAdmin: await isAdminAuthenticated(),
    person: await sessionUserSlug(),
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state") || "",
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
  });
  return new NextResponse(result.html, {
    status: result.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
