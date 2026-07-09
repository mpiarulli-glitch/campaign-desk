// Basecamp Campfire notifications.
//
// Posts short messages to a Basecamp Campfire via a chatbot webhook URL.
// The URL is created once in Basecamp (Campfire -> add a chatbot) and stored
// in the BASECAMP_CAMPFIRE_URL environment variable. Posting to it needs no
// auth token and the URL never expires.
//
// All calls are fire-and-forget: if the env var is missing or Basecamp is
// unreachable, we log and move on. A notification must never break a user
// request.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function postToCampfire(content: string): Promise<void> {
  const url = process.env.BASECAMP_CAMPFIRE_URL;
  if (!url) {
    // Not configured yet. Silently skip so local/dev runs are unaffected.
    return;
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
    }
  } catch (err) {
    console.error("[notify] Campfire post threw:", err);
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
