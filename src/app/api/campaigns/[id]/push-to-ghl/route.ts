import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import { applyExactGhlLinks } from "@/lib/ghl-links";
import { pushEmailTemplate, type TemplatePush } from "@/lib/ghl-tools";
import { getCampaignById, listEmailsWithSubjects } from "@/lib/campaigns";
import { getRevClient } from "@/lib/revenue";
import { renderAssetDoc } from "@/lib/asset-kinds";

type Params = { params: Promise<{ id: string }> };

/**
 * Push a campaign's emails into the client's GoHighLevel subaccount as
 * templates.
 *
 * GET reports what would be pushed and what is blocking, so the button can be
 * disabled with a reason instead of failing on click. POST does it.
 *
 * Only `email` and `interactive` assets go: an SMS, a blog post or a Figma
 * mock-up is not an email template, and pushing one would put junk in the
 * client's template list.
 */
const PUSHABLE = new Set(["email", "interactive"]);

async function resolve(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Campaign not found", status: 404 as const };

  let client = campaign.client_id ? getRevClient(campaign.client_id) : null;
  let locationId = (client?.ghl_location_id || "").trim();

  // Exact name matches are the pairs Find matches would have pre-ticked.
  // Fill them now so opening this modal (or pushing) links Ecoworkz and
  // everyone else with a unique subaccount, instead of asking a person to
  // visit Lifecycle → Tools first.
  if (!locationId && isGhlConfigured()) {
    try {
      await applyExactGhlLinks();
    } catch {
      // Leave the missing-id error below; a GHL outage is not a reason to
      // pretend the client is linked.
    }
    client = campaign.client_id ? getRevClient(campaign.client_id) : null;
    locationId = (client?.ghl_location_id || "").trim();
  }

  if (!locationId) {
    return {
      error: client
        ? `${client.name} has no GoHighLevel location ID on their client record, so there is nowhere to push to.`
        : "This campaign is not linked to a client, so there is no subaccount to push to.",
      status: 409 as const,
    };
  }
  return { campaign, client, locationId };
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const r = await resolve(id);
  if ("error" in r) {
    return NextResponse.json(
      { ready: false, error: r.error },
      { status: r.status }
    );
  }

  const emails = listEmailsWithSubjects(id).filter((e) => PUSHABLE.has(e.kind));
  return NextResponse.json({
    ready: isGhlConfigured(),
    locationId: r.locationId,
    clientName: r.client?.name || "",
    emails: emails.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      // The chosen subject if one was picked, else the first option. Shown so
      // nobody discovers after the fact that a template went up titled with a
      // placeholder subject.
      subject:
        e.subjects.find((s) => s.id === e.chosen_subject_id)?.subject ||
        e.subjects[0]?.subject ||
        "",
      hasSubject: e.subjects.length > 0,
    })),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const r = await resolve(id);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  const body = await request.json().catch(() => ({}));
  const wanted: string[] = Array.isArray(body.emailIds) ? body.emailIds.map(String) : [];
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Pick at least one email" }, { status: 400 });
  }

  const all = listEmailsWithSubjects(id);
  const chosen = all.filter((e) => wanted.includes(e.id) && PUSHABLE.has(e.kind));
  if (chosen.length === 0) {
    return NextResponse.json(
      { error: "None of those are email assets." },
      { status: 400 }
    );
  }

  const results: TemplatePush[] = [];
  for (const email of chosen) {
    // Rendered the same way the preview and the client-facing page render it,
    // so what lands in GoHighLevel is what was approved rather than the raw
    // stored body.
    const { html } = renderAssetDoc(email);
    const subject =
      email.subjects.find((s) => s.id === email.chosen_subject_id)?.subject ||
      email.subjects[0]?.subject ||
      email.title;

    // Namespaced so a template is traceable back to a campaign once there are
    // a few hundred in the account.
    const name = `${r.campaign.title} - ${email.title}`.slice(0, 120);

    try {
      const out = await pushEmailTemplate({
        locationId: r.locationId,
        name,
        subject,
        html,
      });
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
