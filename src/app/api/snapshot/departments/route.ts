import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import {
  departmentNotesForWeek,
  isSnapshotDepartment,
  saveDepartmentNote,
} from "@/lib/snapshot-departments";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const week = url.searchParams.get("week") || "";
  if (!clientId || !WEEK_RE.test(week)) {
    return NextResponse.json(
      { error: "clientId and week (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    clientId,
    week,
    departments: departmentNotesForWeek(clientId, week),
  });
}

export async function PUT(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const department = typeof body.department === "string" ? body.department : "";
  const text = typeof body.body === "string" ? body.body : "";
  if (!clientId || !WEEK_RE.test(weekStart) || !isSnapshotDepartment(department)) {
    return NextResponse.json(
      { error: "clientId, weekStart (YYYY-MM-DD), and department are required" },
      { status: 400 }
    );
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const note = saveDepartmentNote({
    clientId,
    weekStart,
    department,
    body: text,
    loggedBy: await sessionActor(),
  });
  return NextResponse.json({ ok: true, note });
}
