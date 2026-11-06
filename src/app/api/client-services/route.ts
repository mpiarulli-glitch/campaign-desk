import { NextResponse } from "next/server";
import { allows } from "@/lib/access";
import { accessSubject, can, isAdminWithAccess, sessionActor } from "@/lib/auth";
import { canSendFridaySnapshot } from "@/lib/people";
import { basecampConnected, listProjects } from "@/lib/basecamp";
import {
  enrollSnapshotClient,
  isSnapshotEnrolled,
  unenrollSnapshotClient,
} from "@/lib/snapshot-enrollment";
import { addSnapshotClient, lookupSnapshotProject } from "@/lib/snapshot-add-client";
import { getRevClient, listRevClients, updateRevClient } from "@/lib/revenue";
import { listLeads, listWins } from "@/lib/snapshot";
import {
  clientServiceRows,
  clientServiceSummary,
  currentWeekStart,
  outreachForClient,
  sendingEnabled,
  sendWeeklyAsk,
} from "@/lib/client-services";

// The Client Services Hub dashboard: one row per active client with this week's
// ask and how far it got.
export async function GET(request: Request) {
  if (!(await can("page.client_services"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (url.searchParams.has("project")) {
    if (!(await isAdminWithAccess("page.client_services"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const looked = await lookupSnapshotProject(url.searchParams.get("project") || "");
    if (!looked.ok) {
      return NextResponse.json({ ok: false, error: looked.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      projectId: looked.projectId,
      projectName: looked.projectName,
    });
  }
  if (url.searchParams.get("picker") === "1") {
    if (!(await isAdminWithAccess("page.client_services"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const clients = listRevClients().map((client) => ({
      id: client.id,
      name: client.name,
      accountManager: client.account_manager || "",
      contactEmail: client.contact_email || "",
      basecampProjectId: client.basecamp_project_id || "",
      enrolled: isSnapshotEnrolled(client.id),
    }));
    let projects: Array<{ id: string; name: string }> = [];
    let projectsError = "";
    if (basecampConnected()) {
      try {
        const listed = await listProjects();
        projects = listed
          .map((project) => ({ id: String(project.id), name: project.name || "" }))
          .filter((project) => project.id && project.name)
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        projectsError = "Basecamp projects could not be loaded.";
      }
    } else {
      projectsError = "Basecamp is not connected.";
    }
    return NextResponse.json({ clients, projects, projectsError });
  }
  const clientId = url.searchParams.get("clientId");
  // A single client: the outreach history behind the row's expanded view, plus
  // the leads and wins the hub's client panel works with. One response rather
  // than three calls, and deliberately not the whole account payload, which
  // carries deliverables, metrics and contract state the panel never reads.
  if (clientId) {
    return NextResponse.json({
      history: outreachForClient(clientId),
      leads: listLeads(clientId),
      wins: listWins(clientId),
    });
  }
  const rows = clientServiceRows();
  return NextResponse.json({
    weekStart: currentWeekStart(),
    rows,
    summary: clientServiceSummary(rows),
    sendingEnabled: sendingEnabled(),
  });
}

// Pause, resume, enroll, and add stay admin-only. Sending the Friday snapshot
// is narrower: the same allowlist that shows the Send now button. A click
// delivers email and a Basecamp post whether or not CLIENT_SERVICES_SENDING
// is set. The scheduled sweep never sends.
export async function POST(request: Request) {
  if (!(await isAdminWithAccess("page.client_services"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const clientId = typeof body.clientId === "string" ? body.clientId : "";

  if (action === "add") {
    const result = await addSnapshotClient({
      name: typeof body.name === "string" ? body.name : "",
      contactName: typeof body.contactName === "string" ? body.contactName : "",
      email: typeof body.email === "string" ? body.email : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      basecampProjectId: typeof body.basecampProjectId === "string" ? body.basecampProjectId : "",
      enrolledBy: await sessionActor(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
    }
    const rows = clientServiceRows();
    return NextResponse.json({
      ok: true,
      linked: result.linked,
      clientId: result.clientId,
      projectName: result.projectName,
      rows,
      summary: clientServiceSummary(rows),
    });
  }

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (action === "enroll") {
    const projectId = typeof body.basecampProjectId === "string" ? body.basecampProjectId.trim() : "";
    if (!projectId) {
      return NextResponse.json(
        { error: "Choose a Basecamp project before adding this client." },
        { status: 400 }
      );
    }
    const accountManager = typeof body.accountManager === "string" ? body.accountManager : undefined;
    const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail : undefined;
    const updated = updateRevClient(clientId, {
      basecampProjectId: projectId,
      ...(accountManager !== undefined ? { accountManager } : {}),
      ...(contactEmail !== undefined ? { contactEmail } : {}),
    });
    if (!updated?.basecamp_project_id) {
      return NextResponse.json(
        { error: "Choose a Basecamp project before adding this client." },
        { status: 400 }
      );
    }
    enrollSnapshotClient(clientId, await sessionActor());
    const rows = clientServiceRows();
    return NextResponse.json({ ok: true, rows, summary: clientServiceSummary(rows) });
  }

  if (action === "unenroll") {
    unenrollSnapshotClient(clientId);
    const rows = clientServiceRows();
    return NextResponse.json({ ok: true, rows, summary: clientServiceSummary(rows) });
  }

  if (action === "pause" || action === "resume") {
    updateRevClient(clientId, { outreachPaused: action === "pause" });
    const rows = clientServiceRows();
    return NextResponse.json({ ok: true, rows, summary: clientServiceSummary(rows) });
  }

  if (action === "send") {
    const who = await accessSubject();
    if (
      !canSendFridaySnapshot(who, who ? allows(who, "page.client_services") : false)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (client.outreach_paused) {
      return NextResponse.json(
        { error: "Outreach is paused for this client." },
        { status: 400 }
      );
    }
    const result = await sendWeeklyAsk({
      client,
      weekStart: currentWeekStart(),
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
      dryRun: body.dryRun === true,
    });
    const rows = clientServiceRows();
    return NextResponse.json({
      ok: result.email.ok || result.basecamp.ok,
      result,
      rows,
      summary: clientServiceSummary(rows),
      sendingEnabled: sendingEnabled(),
    });
  }

  return NextResponse.json(
    { error: "action must be send, pause, resume, enroll, add, or unenroll" },
    { status: 400 }
  );
}
