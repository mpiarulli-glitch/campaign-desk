import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getCampaignById, listEmailsWithSubjects } from "@/lib/campaigns";
import { getRevClient } from "@/lib/revenue";
import { renderAssetDoc } from "@/lib/asset-kinds";
import {
  KlaviyoError,
  klaviyoKeyHint,
  pushKlaviyoTemplate,
  resolveKlaviyoApiKey,
  setClientKlaviyoApiKey,
  type KlaviyoTemplatePush,
  verifyKlaviyoApiKey,
} from "@/lib/klaviyo";

type Params = { params: Promise<{ id: string }> };

const PUSHABLE = new Set(["email", "interactive"]);

function resolveCampaign(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Campaign not found", status: 404 as const };
  const client = campaign.client_id ? getRevClient(campaign.client_id) : null;
  if (!client) {
    return {
      error:
        "This campaign is not linked to a client, so there is no Klaviyo account to push to.",
      status: 409 as const,
    };
  }
  return { campaign, client };
}

function candidates(campaignId: string) {
  return listEmailsWithSubjects(campaignId)
    .filter((e) => PUSHABLE.has(e.kind))
    .map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      subject:
        e.subjects.find((s) => s.id === e.chosen_subject_id)?.subject ||
        e.subjects[0]?.subject ||
        "",
      hasSubject: e.subjects.length > 0,
    }));
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const r = resolveCampaign(id);
  if ("error" in r) {
    return NextResponse.json(
      { ready: false, error: r.error },
      { status: r.status }
    );
  }

  const apiKey = resolveKlaviyoApiKey(r.client.id, r.client.klaviyo_account);
  return NextResponse.json({
    ready: true,
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? klaviyoKeyHint(apiKey) : "",
    clientName: r.client.name,
    emails: candidates(id),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const r = resolveCampaign(id);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  const body = await request.json().catch(() => ({}));
  const incomingKey =
    typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (incomingKey) {
    try {
      await verifyKlaviyoApiKey(incomingKey);
      setClientKlaviyoApiKey(r.client.id, incomingKey);
    } catch (err) {
      const message =
        err instanceof KlaviyoError
          ? err.message
          : "Could not save that Klaviyo API key.";
      const status = err instanceof KlaviyoError && err.status ? err.status : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const apiKey = resolveKlaviyoApiKey(r.client.id, r.client.klaviyo_account);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Add this client's Klaviyo private API key (pk_…) before pushing templates.",
      },
      { status: 409 }
    );
  }

  const wanted: string[] = Array.isArray(body.emailIds)
    ? body.emailIds.map(String)
    : [];
  if (wanted.length === 0) {
    return NextResponse.json({
      savedKey: Boolean(incomingKey),
      hasKey: true,
      keyHint: klaviyoKeyHint(apiKey),
      emails: candidates(id),
    });
  }

  const all = listEmailsWithSubjects(id);
  const chosen = all.filter((e) => wanted.includes(e.id) && PUSHABLE.has(e.kind));
  if (chosen.length === 0) {
    return NextResponse.json(
      { error: "None of those are email assets." },
      { status: 400 }
    );
  }

  const results: KlaviyoTemplatePush[] = [];
  for (const email of chosen) {
    const { html } = renderAssetDoc(email);
    const name = `${r.campaign.title} - ${email.title}`.slice(0, 255);
    try {
      const out = await pushKlaviyoTemplate({ apiKey, name, html });
      results.push({
        emailId: email.id,
        title: email.title,
        ok: true,
        templateId: out.id,
        previewUrl: out.previewUrl,
      });
    } catch (err) {
      results.push({
        emailId: email.id,
        title: email.title,
        ok: false,
        error: err instanceof Error ? err.message : "Push failed",
      });
    }
  }

  return NextResponse.json({
    pushed: results.filter((x) => x.ok).length,
    failed: results.filter((x) => !x.ok).length,
    results,
  });
}
