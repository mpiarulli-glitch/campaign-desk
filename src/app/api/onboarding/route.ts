import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  ALL_STAGES,
  addClientToOnboarding,
  isValidStage,
  listClientsOffBoard,
  listOnboardingClients,
} from "@/lib/onboarding";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const onBoard = listOnboardingClients().map(({ client, steps }) => ({
    client: {
      id: client.id,
      name: client.name,
      tier: client.tier,
      account_manager: client.account_manager,
      business_model: client.business_model,
      contact_name: client.contact_name,
    },
    steps: steps.map((s) => ({ id: s.id, title: s.title, completed: !!s.completed })),
    stage: client.onboarding_stage,
  }));
  const offBoard = listClientsOffBoard().map((c) => ({ id: c.id, name: c.name }));
  return NextResponse.json({ stages: ALL_STAGES, onBoard, offBoard });
}

// Puts a client on the board, at "triage" unless a stage is given.
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  const stage = typeof body.stage === "string" && isValidStage(body.stage) ? body.stage : "triage";
  addClientToOnboarding(clientId, stage);
  return NextResponse.json({ ok: true }, { status: 201 });
}
