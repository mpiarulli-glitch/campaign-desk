import { NextResponse } from "next/server";
import {
  canWriteSnapshotDepartment,
  filterDepartmentNotesForViewer,
} from "@/lib/snapshot-department-access";
import { accessSubject, can, sessionActor } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import { isSnapshotItemStatus } from "@/lib/snapshot-department-list";
import {
  addDepartmentItem,
  deleteDepartmentItem,
  departmentHasSourceKey,
  departmentItemLocation,
  departmentNotesForWeek,
  isSnapshotDepartment,
  moveDepartmentItem,
  updateDepartmentItem,
  type SnapshotDepartmentNote,
} from "@/lib/snapshot-departments";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

async function allowedClient(clientId: string): Promise<boolean> {
  if (!(await can("page.snapshot"))) return false;
  return Boolean(getVisibleSnapshotAccount(clientId));
}

async function editorNotes(clientId: string, week: string): Promise<SnapshotDepartmentNote[]> {
  const notes = departmentNotesForWeek(clientId, week);
  const who = await accessSubject();
  if (!who) return notes;
  return filterDepartmentNotesForViewer(notes, who);
}

/** 403 when a filtered person writes a department that is not theirs. Admins and Friday-send account managers pass. */
async function rejectForeignDepartment(department: string): Promise<NextResponse | null> {
  const who = await accessSubject();
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWriteSnapshotDepartment(who, department)) {
    return NextResponse.json(
      { error: "That department is not yours to edit." },
      { status: 403 }
    );
  }
  return null;
}

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
    departments: await editorNotes(clientId, week),
  });
}

export async function POST(request: Request) {
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
  if (!(await allowedClient(clientId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await rejectForeignDepartment(department);
  if (denied) return denied;
  const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : "";
  if (sourceKey && departmentHasSourceKey(clientId, weekStart, sourceKey)) {
    return NextResponse.json({
      ok: true,
      already: true,
      departments: await editorNotes(clientId, weekStart),
    });
  }
  const status = typeof body.status === "string" && isSnapshotItemStatus(body.status) ? body.status : undefined;
  const item = addDepartmentItem({
    clientId,
    weekStart,
    department,
    body: text,
    loggedBy: await sessionActor(),
    completed: body.completed === true,
    status,
    sourceKey,
    mark: body.mark === "sent" ? "sent" : "",
  });
  if (!item) {
    return NextResponse.json({ error: "Write an item before adding it." }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    item,
    departments: await editorNotes(clientId, weekStart),
  });
}

export async function PATCH(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const hasBody = typeof body.body === "string";
  const hasCompleted = typeof body.completed === "boolean";
  const status = typeof body.status === "string" && isSnapshotItemStatus(body.status) ? body.status : undefined;
  const moveTo = typeof body.department === "string" ? body.department : "";
  const moving = isSnapshotDepartment(moveTo);
  if (!itemId || (!hasBody && !hasCompleted && !status && !moving)) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }
  const located = departmentItemLocation(itemId);
  if (!located || !(await allowedClient(located.clientId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await rejectForeignDepartment(located.department);
  if (denied) return denied;
  if (moving) {
    const moveDenied = await rejectForeignDepartment(moveTo);
    if (moveDenied) return moveDenied;
    const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
    const moved = moveDepartmentItem({ itemId, department: moveTo, beforeId });
    if (!moved) {
      return NextResponse.json({ error: "Could not move that item." }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      departments: await editorNotes(moved.clientId, moved.weekStart),
    });
  }
  const item = updateDepartmentItem({
    itemId,
    ...(hasBody ? { body: body.body as string } : {}),
    ...(hasCompleted ? { completed: body.completed as boolean } : {}),
    ...(status ? { status } : {}),
    loggedBy: await sessionActor(),
  });
  if (!item) {
    return NextResponse.json({ error: "Write something to keep this item." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const itemId = new URL(request.url).searchParams.get("itemId") || "";
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }
  const located = departmentItemLocation(itemId);
  if (!located || !(await allowedClient(located.clientId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await rejectForeignDepartment(located.department);
  if (denied) return denied;
  deleteDepartmentItem(itemId);
  return NextResponse.json({ ok: true });
}
