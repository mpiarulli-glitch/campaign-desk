import { NextResponse } from "next/server";
import {
  canOrSync,
  getSession,
  isCampaignsReadAuthenticated,
  sessionCampaignKind,
} from "@/lib/auth";
import {
  campaignsVisibleToViewer,
  isCampaignAccountManagerSlug,
  type AccountManagerListScope,
} from "@/lib/campaign-review-queue";
import {
  createCampaign,
  listCampaigns,
  listArchivedCampaigns,
  listCampaignsForKindScope,
  countOpenComments,
  countEmails,
  listEmailKinds,
  listEmailScheduledInstants,
  listClientAccountManagers,
} from "@/lib/campaigns";
import { pickDisplayedSendAt } from "@/lib/send-display";
import { slugForName, teamLabel } from "@/lib/team";
import { coerceKind, coerceFormat } from "@/lib/asset-kinds";
import { kindAllowedForCampaignScope } from "@/lib/people";
import {
  coercePresentation,
  coerceTriggerKind,
  coerceTriggerFormFormat,
} from "@/lib/automation-map";

function ownerFields(manager: string): { owner: string; owner_key: string } {
  const raw = manager.trim();
  if (!raw) return { owner: "Unassigned", owner_key: "unassigned" };
  const slug = slugForName(raw);
  if (!slug) return { owner: raw, owner_key: raw.toLowerCase() };
  return { owner: teamLabel(slug), owner_key: slug };
}

export async function GET(request: Request) {
  // Read follows page.campaigns. The list is filtered to the session's campaign
  // kind scope when the owner set one (or TEAM_FOCUS defaults to blogs).
  if (!(await isCampaignsReadAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const archived = params.get("archived") === "1";
  // Account managers only. Admins ignore this and still receive every campaign.
  const listScope: AccountManagerListScope =
    params.get("approved") === "mine" ? "approved" : "main";

  const kindScope = await sessionCampaignKind();
  const source = kindScope
    ? listCampaignsForKindScope(kindScope, { archived })
    : archived
      ? listArchivedCampaigns()
      : listCampaigns();

  const emailSends = listEmailScheduledInstants();
  const managers = listClientAccountManagers();
  const now = new Date().toISOString();
  const session = await getSession();
  const viewerSlug =
    session && !(session.role === "admin" && session.person === null)
      ? session.person
      : null;
  // Account managers receive their main list, or Approved by me when asked.
  // A campaign they internally approved leaves the main list until a later
  // internal review is assigned to them. Michael and other admins get every row.
  const visible = campaignsVisibleToViewer(source, session, listScope);
  const campaigns = visible.map((c) => {
    const send = pickDisplayedSendAt(
      [...(emailSends.get(c.id) || []), c.scheduled_send_at],
      now
    );
    const owner = ownerFields(c.client_id ? managers.get(c.client_id) || "" : "");
    return {
      ...c,
      open_comments: countOpenComments(c.id),
      email_count: countEmails(c.id),
      email_kinds: listEmailKinds(c.id),
      review_path: `/review/${c.magic_token}`,
      // Display only. Not stored; the list already had scheduled_send_at.
      next_send_at: send.at,
      next_send_upcoming: send.upcoming,
      owner: owner.owner,
      owner_key: owner.owner_key,
      review_assignee: (c.internal_review_assignee || "").trim(),
    };
  });

  return NextResponse.json({
    campaigns,
    scope: kindScope || "all",
    viewer: {
      slug: viewerSlug,
      accountManager: isCampaignAccountManagerSlug(viewerSlug),
    },
  });
}

export async function POST(request: Request) {
  if (!(await canOrSync(request, "tool.campaign_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const htmlContent =
    typeof body.htmlContent === "string" ? body.htmlContent : "";
  const clientName =
    typeof body.clientName === "string" ? body.clientName : "";
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  const description =
    typeof body.description === "string" ? body.description : "";
  const audience = typeof body.audience === "string" ? body.audience : "";
  const emailTitle =
    typeof body.emailTitle === "string" ? body.emailTitle : "Item 1";
  const presentation = coercePresentation(body.presentation);
  const triggerLabel =
    typeof body.triggerLabel === "string" ? body.triggerLabel : "";
  const triggerKind = coerceTriggerKind(body.triggerKind);
  const triggerFormFormat = coerceTriggerFormFormat(body.triggerFormFormat);
  const triggerFormHtml =
    typeof body.triggerFormHtml === "string" ? body.triggerFormHtml : "";
  const triggerFormMediaUrl =
    typeof body.triggerFormMediaUrl === "string"
      ? body.triggerFormMediaUrl
      : "";
  const kind = coerceKind(body.kind);
  const kindScope = await sessionCampaignKind();
  if (!kindAllowedForCampaignScope(kind, kindScope)) {
    return NextResponse.json(
      {
        error:
          kindScope === "blog"
            ? "Your campaigns are limited to blog posts."
            : kindScope === "no_blog"
              ? "Blog posts are handled by the SEO team."
              : "That campaign type isn't available for your account.",
      },
      { status: 400 }
    );
  }
  if (kindScope === "blog" && presentation === "automation") {
    return NextResponse.json(
      { error: "Blog campaigns go out as a review package, not an automation." },
      { status: 400 }
    );
  }
  const bodyFormat = coerceFormat(kind, body.bodyFormat);
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  // Image/Figma mock-ups carry their artwork in mediaUrl, so HTML is optional.
  // Everything else needs body content, except an automation which can start
  // with a blank first email and be filled in on the editor.
  const needsMedia = bodyFormat === "image" || bodyFormat === "figma";
  if (needsMedia && !mediaUrl.trim()) {
    return NextResponse.json(
      { error: "An image or Figma link is required" },
      { status: 400 }
    );
  }
  if (!needsMedia && !htmlContent.trim() && presentation !== "automation") {
    return NextResponse.json(
      { error: "Content is required" },
      { status: 400 }
    );
  }

  const campaign = createCampaign({
    title,
    clientName,
    clientId,
    description,
    audience,
    htmlContent: htmlContent.trim() ? htmlContent : "<p></p>",
    emailTitle: presentation === "automation" ? "Email 1" : emailTitle,
    kind,
    bodyFormat,
    mediaUrl,
    presentation,
    triggerLabel,
    triggerKind,
    triggerFormFormat,
    triggerFormHtml,
    triggerFormMediaUrl,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
