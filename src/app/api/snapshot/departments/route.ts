import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import {
  addDepartmentItem,
  deleteDepartmentItem,
  departmentItemClientId,
  departmentNotesForWeek,
  isSnapshotDepartment,
  moveDepartmentItem,
  updateDepartmentItem,
} from "@/lib/snapshot-departments";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

async function allowedClient(clientId: string): Promise<boolean> {
  if (!(await can("page.snapshot"))) return false;
  return Boolean(getVisibleSnapshotAccount(clientId));
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
    departments: departmentNotesForWeek(clientId, week),
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
  const item = addDepartmentItem({
    clientId,
    weekStart,
    department,
    body: text,
    loggedBy: await sessionActor(),
    completed: body.completed === true,
    sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : "",
    mark: body.mark === "sent" ? "sent" : "",
  });
  if (!item) {
    return NextResponse.json({ error: "Write an item before adding it." }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    item,
    departments: departmentNotesForWeek(clientId, weekStart),
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
  const moveTo = typeof body.department === "string" ? body.department : "";
  const moving = isSnapshotDepartment(moveTo);
  if (!itemId || (!hasBody && !hasCompleted && !moving)) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }
  const clientId = departmentItemClientId(itemId);
  if (!clientId || !(await allowedClient(clientId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (moving) {
    const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
    const moved = moveDepartmentItem({ itemId, department: moveTo, beforeId });
    if (!moved) {
      return NextResponse.json({ error: "Could not move that item." }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      departments: departmentNotesForWeek(moved.clientId, moved.weekStart),
    });
  }
  const item = updateDepartmentItem({
    itemId,
    ...(hasBody ? { body: body.body as string } : {}),
    ...(hasCompleted ? { completed: body.completed as boolean } : {}),
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
  const clientId = departmentItemClientId(itemId);
  if (!clientId || !(await allowedClient(clientId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteDepartmentItem(itemId);
  return NextResponse.json({ ok: true });
}
