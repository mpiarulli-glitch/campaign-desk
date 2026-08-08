import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { updateVideographer } from "@/lib/videographers";

type Params = { params: Promise<{ id: string }> };

// Edit a videographer: rename, deactivate, or set the weekdays they never
// shoot. The standing days off are the reason this route exists: without them a
// recurring commitment had to be re-entered as individual blackout dates on
// every client assigned to that person, forever.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // An empty array is meaningful: it clears the days off. Only a non-array is
  // "leave it alone".
  let unavailableWeekdays: number[] | undefined;
  if (Array.isArray(body.unavailableWeekdays)) {
    const days = body.unavailableWeekdays.filter(
      (d: unknown): d is number =>
        typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
    );
    if (days.length !== body.unavailableWeekdays.length) {
      return NextResponse.json(
        { error: "Weekdays must be whole numbers from 0 (Sunday) to 6." },
        { status: 400 }
      );
    }
    unavailableWeekdays = days;
  }

  const videographer = updateVideographer(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
    unavailableWeekdays,
  });
  if (!videographer) {
    return NextResponse.json({ error: "Videographer not found." }, { status: 404 });
  }
  return NextResponse.json({ videographer });
}
