import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import { applyExactGhlLinks } from "@/lib/ghl-links";
import { listLocationEmailSchedules } from "@/lib/ghl-email-analytics";
import { matchEmailsToGhlSchedules } from "@/lib/campaign-ghl-schedule";
import {
  getCampaignById,
  listEmailsWithSubjects,
} from "@/lib/campaigns";
import { isSchedulableEmailKind, isoToAppDateTime } from "@/lib/campaign-schedule";
import { getRevClient } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const campaign = getCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json({
      ready: false,
      error: "GoHighLevel is not connected on this environment.",
      matches: [],
    });
  }

  let client = campaign.client_id ? getRevClient(campaign.client_id) : null;
  let locationId = (client?.ghl_location_id || "").trim();
  if (!locationId) {
    try {
      await applyExactGhlLinks();
    } catch {
      // Fall through to the missing-location error.
    }
    client = campaign.client_id ? getRevClient(campaign.client_id) : null;
    locationId = (client?.ghl_location_id || "").trim();
  }
  if (!locationId) {
    return NextResponse.json({
      ready: false,
      error: client
        ? `${client.name} has no GoHighLevel location on their client record.`
        : "This campaign is not linked to a client, so there is no subaccount to check.",
      matches: [],
    });
  }

  const emails = listEmailsWithSubjects(id).filter((email) =>
    isSchedulableEmailKind(email.kind)
  );
  let schedules;
  try {
    schedules = await listLocationEmailSchedules(locationId);
  } catch (err) {
    return NextResponse.json(
      {
        ready: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not read scheduled campaigns from GoHighLevel.",
        matches: [],
      },
      { status: 502 }
    );
  }

  const matched = matchEmailsToGhlSchedules(
    emails.map((email) => ({
      id: email.id,
      title: email.title,
      subjects: email.subjects.map((s) => s.subject).filter(Boolean),
    })),
    schedules
  );

  return NextResponse.json({
    ready: true,
    locationId,
    clientName: client?.name || "",
    matches: matched.map((row) => {
      const parts = row.schedule?.scheduledAt
        ? isoToAppDateTime(row.schedule.scheduledAt)
        : null;
      return {
        emailId: row.emailId,
        ghlName: row.schedule?.name || null,
        ghlStatus: row.schedule?.status || null,
        sendDate: parts?.date || "",
        sendTime: parts?.time || "",
        score: row.score,
      };
    }),
  });
}
