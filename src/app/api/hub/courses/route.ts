import { NextResponse } from "next/server";
import { can, isAdminWithAccess } from "@/lib/auth";
import { listCourses, upsertCourseWithLessons } from "@/lib/courses";

export async function GET() {
  if (!(await can("page.hub"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ courses: listCourses() });
}

// Rebuilds a course from a full payload (course + lessons), keyed by slug.
// Admin-only. Lets a seed script push course content to the live app over HTTP.
export async function POST(request: Request) {
  if (!(await isAdminWithAccess("page.hub"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!slug || !title) {
    return NextResponse.json({ error: "slug and title are required." }, { status: 400 });
  }
  const parseQuiz = (raw: unknown) =>
    Array.isArray(raw)
      ? raw
          .filter(
            (q: unknown) =>
              q &&
              typeof (q as { prompt?: unknown }).prompt === "string" &&
              Array.isArray((q as { options?: unknown }).options)
          )
          .map((q: Record<string, unknown>) => ({
            prompt: String(q.prompt),
            options: (q.options as unknown[]).map((o) => String(o)),
            answer: typeof q.answer === "number" ? q.answer : 0,
            explanation: typeof q.explanation === "string" ? q.explanation : "",
          }))
      : [];

  const lessons = Array.isArray(body.lessons)
    ? body.lessons
        .filter((l: unknown) => l && typeof (l as { title?: unknown }).title === "string")
        .map((l: Record<string, unknown>) => ({
          title: String(l.title),
          subtitle: typeof l.subtitle === "string" ? l.subtitle : "",
          body: typeof l.body === "string" ? l.body : "",
          duration: typeof l.duration === "string" ? l.duration : "",
          quiz: parseQuiz(l.quiz),
        }))
    : [];
  const course = upsertCourseWithLessons({
    slug,
    title,
    subtitle: typeof body.subtitle === "string" ? body.subtitle : "",
    kind: body.kind === "ai" ? "ai" : "marketing",
    author: typeof body.author === "string" ? body.author : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    lessons,
  });
  return NextResponse.json({ course });
}
