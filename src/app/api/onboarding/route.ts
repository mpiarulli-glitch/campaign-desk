import { NextResponse } from "next/server";
import { isAdminAuthenticated, getSession } from "@/lib/auth";
import { teamLabel } from "@/lib/team";
import {
  ALL_STAGES,
  createProspectFromOpportunity,
  getProspectByOpportunity,
  listOnboardingProspects,
} from "@/lib/onboarding";
import {
  isGhlOpportunitiesConfigured,
  listPipelineOpportunities,
} from "@/lib/ghl-opportunities";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cards = listOnboardingProspects();
  const onBoard = cards.map(({ prospect, steps }) => ({
    prospect: {
      id: prospect.id,
      name: prospect.name,
      contact_name: prospect.contact_name,
      contact_email: prospect.contact_email,
      monetary_value: prospect.monetary_value,
      basecamp_project_id: prospect.basecamp_project_id,
      welcome_email_sent_at: prospect.welcome_email_sent_at,
      basecamp_client_added_at: prospect.basecamp_client_added_at,
      team_notified_at: prospect.team_notified_at,
      strategy_meeting_requested_at: prospect.strategy_meeting_requested_at,
      strategy_meeting_at: prospect.strategy_meeting_at,
    },
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      actionKey: s.action_key,
      completed: !!s.completed,
    })),
    stage: prospect.stage,
  }));

  const onBoardOpportunityIds = new Set(cards.map((c) => c.prospect.ghl_opportunity_id));

  let offBoard: Array<{
    id: string;
    name: string;
    contactName: string;
    monetaryValue: number;
  }> = [];
  let ghlError = "";
  if (isGhlOpportunitiesConfigured()) {
    try {
      const opportunities = await listPipelineOpportunities();
      offBoard = opportunities
        .filter((o) => !onBoardOpportunityIds.has(o.id))
        .map((o) => ({
          id: o.id,
          name: o.name,
          contactName: o.contactName,
          monetaryValue: o.monetaryValue,
        }));
    } catch (e) {
      ghlError = (e as Error).message;
    }
  }

  return NextResponse.json({
    stages: ALL_STAGES,
    onBoard,
    offBoard,
    ghlConfigured: isGhlOpportunitiesConfigured(),
    ghlError,
  });
}

// Pulls a GHL opportunity onto the board. Already-signed by construction (the
// pipeline only holds post-signature deals), so this lands at "Agreement
// Signed" immediately rather than "Triage".
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
  if (!opportunityId) {
    return NextResponse.json({ error: "Pick an opportunity." }, { status: 400 });
  }
  if (getProspectByOpportunity(opportunityId)) {
    return NextResponse.json(
      { error: "This opportunity is already on the board." },
      { status: 409 }
    );
  }
  const opportunities = await listPipelineOpportunities().catch(() => []);
  const opportunity = opportunities.find((o) => o.id === opportunityId);
  if (!opportunity) {
    return NextResponse.json(
      { error: "That opportunity could not be found in GHL." },
      { status: 404 }
    );
  }
  const session = await getSession();
  const createdBy = session?.person ? teamLabel(session.person) : "Team";
  const prospect = createProspectFromOpportunity(opportunity, createdBy);
  return NextResponse.json({ prospect }, { status: 201 });
}
