// Basecamp Campfire notifications.
//
// Posts short messages to Basecamp Campfires through either the app's OAuth
// connection (which supports real @mentions) or a chatbot webhook fallback.
//
// Notification failures are logged but never break a user request.

import {
  basecampConnected,
  getProjectPeopleForMention,
  mentionHtml,
  postProjectCampfireLine,
} from "./basecamp";
import { basecampNameForManager } from "./people";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function postToCampfire(
  content: string,
  destination?: string
): Promise<boolean> {
  const url = destination || process.env.BASECAMP_CAMPFIRE_URL;
  if (!url) {
    // Not configured yet. Silently skip so local/dev runs are unaffected.
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[notify] Campfire post failed: ${res.status} ${detail.slice(0, 200)}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notify] Campfire post threw:", err);
    return false;
  }
}

// Client left feedback on a campaign via the review link.
export function notifyClientFeedback(args: {
  campaignTitle: string;
  clientName: string | null;
  authorName: string;
  body: string;
  emailTitle: string | null;
}): void {
  const client = args.clientName ? ` (${escapeHtml(args.clientName)})` : "";
  const onEmail = args.emailTitle
    ? ` on <em>${escapeHtml(args.emailTitle)}</em>`
    : "";
  const snippet =
    args.body.length > 280 ? args.body.slice(0, 280) + "…" : args.body;

  const content =
    `<strong>New client feedback</strong> on ` +
    `<strong>${escapeHtml(args.campaignTitle)}</strong>${client}${onEmail}<br>` +
    `<strong>${escapeHtml(args.authorName)}:</strong> ` +
    `${escapeHtml(snippet)}`;

  // Fire and forget.
  void postToCampfire(content);
}

// A client picked a production date on their schedule link.
export interface ProductionRequestedNotification {
  clientName: string;
  videographerName?: string;
  accountManagerName?: string;
  sendDate: string;
  sendTime: string;
  duration: string;
  detailsUrl: string;
  note?: string;
}

export function productionRequestedCampfireContent(
  args: ProductionRequestedNotification,
  videographerMention?: string,
  accountManagerMention?: string
): string {
  const note = args.note ? `<br>Note: ${escapeHtml(args.note)}` : "";
  const time = args.sendTime ? ` at ${escapeHtml(args.sendTime)}` : "";
  const length = args.duration === "full" ? "Full day" : "4 hours";
  const named = (mention: string | undefined, fallback: string | undefined) =>
    mention || (fallback ? `@${escapeHtml(fallback)}` : "Unassigned");
  const videographer = named(videographerMention, args.videographerName);
  const manager = named(accountManagerMention, args.accountManagerName);
  // Both people are named on the line. Mentioning only the videographer meant a
  // client with nobody assigned yet, which is when somebody most needs to act,
  // pinged nobody at all.
  const pings = [videographerMention, accountManagerMention].filter(Boolean);
  const ping = pings.length ? `${pings.join(" ")} a production just came in.<br>` : "";
  return (
    `<strong>Production requested</strong><br>` +
    ping +
    `<strong>Client:</strong> ${escapeHtml(args.clientName)}<br>` +
    `<strong>Videographer:</strong> ${videographer}<br>` +
    `<strong>Account manager:</strong> ${manager}<br>` +
    `<strong>Date:</strong> ${escapeHtml(args.sendDate)}${time}<br>` +
    `<strong>Length:</strong> ${length}${note}<br>` +
    `<a href="${escapeHtml(args.detailsUrl)}">View production details</a>`
  );
}

export async function notifyProductionRequested(
  args: ProductionRequestedNotification
): Promise<boolean> {
  const projectId = process.env.BASECAMP_VIDEO_EDITING_PROJECT_ID || "";
  if (projectId && basecampConnected()) {
    // The enriched roster, because /projects/{id}/people.json returns no
    // attachable_sgid and a mention without one degrades to plain text.
    const people = await getProjectPeopleForMention(projectId);
    // Exact only. A first name is not enough to identify a colleague here: the
    // roster holds both Morris Kyle and Kyle Onstott, and matching "Kyle" on a
    // prefix pinged the wrong one. Where a first name is all we hold, it has to
    // resolve to exactly one person or to nobody.
    const exact = (fullName: string) => {
      const q = fullName.trim().toLowerCase();
      if (!q) return undefined;
      return people.find((candidate) => candidate.name.toLowerCase() === q);
    };
    const soleMatch = (want: string | undefined) => {
      const q = (want || "").trim().toLowerCase();
      if (!q) return undefined;
      const hit = exact(q);
      if (hit) return hit;
      const starts = people.filter((candidate) =>
        candidate.name.toLowerCase().startsWith(q + " ")
      );
      return starts.length === 1 ? starts[0] : undefined;
    };
    const videographer = soleMatch(args.videographerName);
    // Account managers come from an explicit map, since their Basecamp names do
    // not follow from the first name stored on the client.
    const manager = exact(basecampNameForManager(args.accountManagerName || ""));
    const content = productionRequestedCampfireContent(
      args,
      videographer ? mentionHtml(videographer) : undefined,
      manager ? mentionHtml(manager) : undefined
    );
    const result = await postProjectCampfireLine(projectId, content);
    if (result.ok) return true;
    console.error(`[notify] Basecamp production Campfire failed: ${result.error}`);
  }

  const content = productionRequestedCampfireContent(args);

  // Production requests go to the Video Editing Team Campfire when its
  // dedicated chatbot URL is configured. This remains a fallback for accounts
  // that have not connected Campaign Desk through Basecamp OAuth.
  return postToCampfire(
    content,
    process.env.BASECAMP_VIDEO_EDITING_CAMPFIRE_URL ||
      process.env.BASECAMP_CAMPFIRE_URL
  );
}

// A campaign was deleted from the admin dashboard.
export function notifyCampaignRemoved(args: {
  campaignTitle: string;
  clientName: string | null;
}): void {
  const client = args.clientName ? ` for ${escapeHtml(args.clientName)}` : "";
  const content =
    `<strong>Campaign removed:</strong> ` +
    `${escapeHtml(args.campaignTitle)}${client} was deleted from Campaign Desk.`;

  // Fire and forget.
  void postToCampfire(content);
}
