import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  addAccountAbTest,
  addAccountCalendarItem,
  addAccountIcp,
  addAccountOffer,
  addAccountOptIn,
  buildAccountPlaybook,
  deleteAccountAbTest,
  deleteAccountCalendarItem,
  deleteAccountIcp,
  deleteAccountOffer,
  deleteAccountOptIn,
  saveAccountBrandGuidelines,
  updateAccountAbTest,
  updateAccountCalendarItemStatus,
  updateAccountOfferStatus,
  updateAccountOptIn,
} from "@/lib/lifecycle-account-playbook";
import { getRevClient } from "@/lib/revenue";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const url = new URL(request.url);
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return NextResponse.json(buildAccountPlaybook(clientId, memberIds));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const brand = saveAccountBrandGuidelines(clientId, body);
  if (!brand) {
    return NextResponse.json({ error: "Could not save brand guidelines." }, { status: 400 });
  }
  return NextResponse.json({ brand });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const section = typeof body.section === "string" ? body.section : "";

  if (section === "icp") {
    const item = addAccountIcp(clientId, body);
    if (!item) return NextResponse.json({ error: "Add an ICP name." }, { status: 400 });
    return NextResponse.json({ item });
  }

  if (section === "offer") {
    const item = addAccountOffer(clientId, body);
    if (!item) return NextResponse.json({ error: "Add an offer name." }, { status: 400 });
    return NextResponse.json({ item });
  }

  if (section === "opt_in") {
    const item = addAccountOptIn(clientId, body);
    if (!item) return NextResponse.json({ error: "Add an opt-in method name." }, { status: 400 });
    return NextResponse.json({ item });
  }

  if (section === "calendar") {
    const item = addAccountCalendarItem(clientId, {
      calendarKind: body.calendarKind === "testing" ? "testing" : "campaign",
      title: body.title,
      plannedDate: body.plannedDate,
      audienceOrTarget: body.audienceOrTarget,
      offerOrVariable: body.offerOrVariable,
      status: body.status,
      notes: body.notes,
    });
    if (!item) return NextResponse.json({ error: "Add a calendar item title." }, { status: 400 });
    return NextResponse.json({ item });
  }

  if (section === "ab_test") {
    const item = addAccountAbTest(clientId, body);
    if (!item) return NextResponse.json({ error: "Add a test title." }, { status: 400 });
    return NextResponse.json({ item });
  }

  return NextResponse.json({ error: "Unknown playbook section." }, { status: 400 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const section = typeof body.section === "string" ? body.section : "";
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing item id." }, { status: 400 });
  }

  if (section === "offer") {
    if (!updateAccountOfferStatus(id, body.status)) {
      return NextResponse.json({ error: "Could not update offer." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (section === "opt_in") {
    if (!updateAccountOptIn(id, { status: body.status, conversionRate: body.conversionRate })) {
      return NextResponse.json({ error: "Could not update opt-in method." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (section === "calendar") {
    if (!updateAccountCalendarItemStatus(id, body.status)) {
      return NextResponse.json({ error: "Could not update calendar item." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (section === "ab_test") {
    const item = updateAccountAbTest(id, {
      resultA: body.resultA,
      resultB: body.resultB,
      winner: body.winner,
      takeaway: body.takeaway,
      status: body.status,
    });
    if (!item) return NextResponse.json({ error: "Could not update A/B test." }, { status: 400 });
    return NextResponse.json({ item });
  }

  return NextResponse.json({ error: "Unknown playbook section." }, { status: 400 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "";
  const id = url.searchParams.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "Missing item id." }, { status: 400 });
  }

  const ok =
    section === "icp"
      ? deleteAccountIcp(id)
      : section === "offer"
        ? deleteAccountOffer(id)
        : section === "opt_in"
          ? deleteAccountOptIn(id)
          : section === "calendar"
            ? deleteAccountCalendarItem(id)
            : section === "ab_test"
              ? deleteAccountAbTest(id)
              : false;

  if (!ok) {
    return NextResponse.json({ error: "Could not delete item." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
