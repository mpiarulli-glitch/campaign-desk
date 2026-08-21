import { NextResponse } from "next/server";
import { isAdminOrSyncAuthenticated } from "@/lib/auth";
import {
  addFlowStep,
  deleteFlowStep,
  getCampaignById,
  getFlowStep,
  listFlowSteps,
  updateFlowStep,
} from "@/lib/campaigns";
import {
  coerceFlowBranch,
  coerceFlowStepType,
  coerceConditionKind,
} from "@/lib/automation-map";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ steps: listFlowSteps(id) });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const stepType = coerceFlowStepType(body.stepType);
  if (!stepType) {
    return NextResponse.json(
      { error: "stepType must be wait, email, or condition" },
      { status: 400 }
    );
  }
  const result = addFlowStep({
    campaignId: id,
    stepType,
    parentId: typeof body.parentId === "string" ? body.parentId : null,
    branch: coerceFlowBranch(body.branch),
    delayMs:
      typeof body.delayMs === "number" && Number.isFinite(body.delayMs)
        ? body.delayMs
        : undefined,
    conditionKind: coerceConditionKind(body.conditionKind),
    conditionLabel:
      typeof body.conditionLabel === "string" ? body.conditionLabel : undefined,
    emailTitle: typeof body.emailTitle === "string" ? body.emailTitle : undefined,
    afterStepId: typeof body.afterStepId === "string" ? body.afterStepId : null,
    prepend: body.prepend === true,
  });
  if (!result) {
    return NextResponse.json({ error: "Could not add that step" }, { status: 400 });
  }
  return NextResponse.json(
    { step: result.step, email: result.email, steps: listFlowSteps(id) },
    { status: 201 }
  );
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const stepId = typeof body.stepId === "string" ? body.stepId : "";
  if (!stepId) {
    return NextResponse.json({ error: "stepId is required" }, { status: 400 });
  }
  const existing = getFlowStep(stepId);
  if (!existing || existing.campaign_id !== id) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  const step = updateFlowStep(stepId, {
    delayMs:
      typeof body.delayMs === "number" && Number.isFinite(body.delayMs)
        ? body.delayMs
        : undefined,
    conditionKind:
      body.conditionKind !== undefined
        ? coerceConditionKind(body.conditionKind)
        : undefined,
    conditionLabel:
      typeof body.conditionLabel === "string" ? body.conditionLabel : undefined,
  });
  return NextResponse.json({ step, steps: listFlowSteps(id) });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const stepId = typeof body.stepId === "string" ? body.stepId : "";
  if (!stepId) {
    return NextResponse.json({ error: "stepId is required" }, { status: 400 });
  }
  const existing = getFlowStep(stepId);
  if (!existing || existing.campaign_id !== id) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  deleteFlowStep(stepId);
  return NextResponse.json({ ok: true, steps: listFlowSteps(id) });
}
