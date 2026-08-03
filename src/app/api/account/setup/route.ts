import { NextResponse } from "next/server";
import { sessionUserSlug } from "@/lib/auth";
import { setupStateFor } from "@/lib/setup";

// What the signed-in person still has to finish before the app opens up. Read
// only: every step is completed through its own endpoint, so there is nothing
// here a client could mark as done on its own say-so.

export async function GET() {
  const slug = await sessionUserSlug();
  if (!slug) {
    return NextResponse.json(
      { error: "Sign in as yourself to finish setting up." },
      { status: 401 }
    );
  }
  const state = setupStateFor(slug);
  if (!state) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }
  return NextResponse.json(state);
}
