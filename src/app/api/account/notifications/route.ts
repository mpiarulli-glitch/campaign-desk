import { NextResponse } from "next/server";
import { sessionUserSlug } from "@/lib/auth";
import {
  getUser,
  setInternalReviewNotifications,
  wantsInternalReviewNotifications,
} from "@/lib/users";

// The signed-in person's own review reminders. Impersonated sessions cannot
// change someone else's setting.

export async function GET() {
  const slug = await sessionUserSlug();
  if (!slug) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = getUser(slug);
  if (!user) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  return NextResponse.json({
    internalReviews: wantsInternalReviewNotifications(slug),
    usingDefault: user.notify_internal_reviews == null,
  });
}

export async function POST(request: Request) {
  const slug = await sessionUserSlug();
  if (!slug) {
    return NextResponse.json(
      { error: "Sign in as yourself to change notifications." },
      { status: 401 }
    );
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.internalReviews !== "boolean") {
    return NextResponse.json({ error: "internalReviews must be true or false." }, { status: 400 });
  }
  if (!setInternalReviewNotifications(slug, body.internalReviews)) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }
  return NextResponse.json({
    internalReviews: body.internalReviews,
    usingDefault: false,
  });
}
