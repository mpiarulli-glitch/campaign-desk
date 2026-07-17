import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConnected, listProjects } from "@/lib/basecamp";
import { listRevClients, updateRevClient } from "@/lib/revenue";

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Match production-enrolled clients that don't yet have a Basecamp project to a
// project in the account by name (exact normalized match, else a unique
// substring match). Only fills blanks; never overwrites a set project.
export async function POST() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }

  const projects = (await listProjects()).map((p) => ({ ...p, n: norm(p.name) }));
  const matched: Array<{ client: string; project: string }> = [];
  const unmatched: string[] = [];

  for (const c of listRevClients(true)) {
    if (!c.production_enrolled || c.basecamp_project_id) continue;
    const cn = norm(c.name);
    let m = projects.find((p) => p.n === cn);
    if (!m) {
      const cands = projects.filter((p) => p.n.includes(cn) || cn.includes(p.n));
      if (cands.length === 1) m = cands[0];
    }
    if (m) {
      updateRevClient(c.id, { basecampProjectId: String(m.id) });
      matched.push({ client: c.name, project: m.name });
    } else {
      unmatched.push(c.name);
    }
  }

  return NextResponse.json({ matched, unmatched, projects: projects.length });
}
