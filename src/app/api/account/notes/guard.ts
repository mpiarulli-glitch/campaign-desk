import { NextResponse } from "next/server";
import { getSession, sessionUserSlug } from "@/lib/auth";

// Whose notebook this request may touch. Null while impersonating, on purpose:
// "view as" is for seeing the app as someone else, not for reading their notes.

export async function requireNotesOwner(): Promise<
  { slug: string } | { response: NextResponse }
> {
  const slug = await sessionUserSlug();
  if (slug) return { slug };
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return {
    response: NextResponse.json(
      { error: "Sign in as yourself to use your notes." },
      { status: 403 }
    ),
  };
}

export function isNotesOwner(
  result: { slug: string } | { response: NextResponse }
): result is { slug: string } {
  return "slug" in result;
}
