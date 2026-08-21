import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { asPerson, basecampConnected, hasConnection, listMyAssignments } from "@/lib/basecamp";
import { isValidPerson } from "@/lib/forecast";
import { listRevClients } from "@/lib/revenue";

// Everything Basecamp says is assigned to this person, across every project.
//
// Backs the "assigned to me" list in the forecast queue, which is the answer to
// having to pick a client before you could see any of your own work — most
// people do not think "which client is that under", they think "what's on me".
//
// Like the other pickers, every empty case answers 200 with a `reason` rather
// than an error: the sidebar always has the per-client tab and free text to fall
// back on, and only needs to explain why there is nothing here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ assignments: [], reason: "not-connected" });
  }
  // /my/assignments.json answers for whoever's token asks. On the shared service
  // token it would hand back the mascot account's work, which is worse than
  // saying nothing, so this refuses rather than falling back.
  if (!hasConnection(person)) {
    return NextResponse.json({ assignments: [], reason: "person-not-connected" });
  }

  try {
    const rows = await listMyAssignments(asPerson(person));

    // Project id -> billing client, so a booked row lands under the client name
    // the rest of the forecast uses rather than the Basecamp project title.
    const byProject = new Map<string, { id: string; name: string }>();
    for (const c of listRevClients(true)) {
      const pid = (c.basecamp_project_id || "").trim();
      if (pid) byProject.set(pid, { id: c.id, name: c.name });
    }

    const assignments = rows.map((r) => {
      const client = byProject.get(r.projectId);
      return {
        ...r,
        clientId: client?.id || "",
        // Internal projects (Empire Leadership HQ and friends) are not
        // rev_clients, so they keep the Basecamp project name.
        clientName: client?.name || r.projectName,
      };
    });

    return NextResponse.json({
      assignments,
      reason: assignments.length ? null : "none-assigned",
    });
  } catch {
    return NextResponse.json({ assignments: [], reason: "failed" });
  }
}
