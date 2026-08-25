import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  assignLoadForPerson,
  assignWarningCopy,
  parseAssignDueOn,
  parseNeededHours,
} from "@/lib/assign-todo";
import { isValidPerson } from "@/lib/people";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const assignee = (url.searchParams.get("assignee") || "").trim();
  const dueOn = parseAssignDueOn(url.searchParams.get("due") || "");
  const hours = parseNeededHours(url.searchParams.get("hours"));

  if (!isValidPerson(assignee)) {
    return NextResponse.json({ error: "Pick someone on the forecast roster." }, { status: 400 });
  }
  if (!dueOn) {
    return NextResponse.json({ error: "Pick a due date." }, { status: 400 });
  }

  const load = assignLoadForPerson({
    person: assignee,
    dueOn,
    neededHours: hours,
  });
  return NextResponse.json({
    ...load,
    warning: assignWarningCopy(load),
  });
}
