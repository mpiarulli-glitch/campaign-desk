// What an account manager sees on the Campaigns tab.
//
// Cassidy, Kyle Morris, and Luis are the account managers. Michael and every
// other login still see the full list. An account manager sees a campaign
// only when the internal review was sent to them, or when they left revisions
// on it. Later statuses stay visible so they can follow that work.
//
// The three queue sections are that same set, narrowed to the internal loop:
// Needs your review, Revisions made, and Revisions left. Owning the client
// is not enough.

export const CAMPAIGN_ACCOUNT_MANAGER_SLUGS = [
  "cassidy",
  "kyle_morris",
  "luis_romero",
] as const;

export function isCampaignAccountManagerSlug(
  slug: string | null | undefined
): boolean {
  return (
    Boolean(slug) &&
    (CAMPAIGN_ACCOUNT_MANAGER_SLUGS as readonly string[]).includes(slug!)
  );
}

// Names the review page and older comments actually store. Bare "Kyle" is
// left unmatched: Kyle Morris and Kyle Onstott are different people.
const REVIEWER_NAME_TO_AM: Record<string, string> = {
  cassidy: "cassidy",
  "cassidy merideth": "cassidy",
  "kyle morris": "kyle_morris",
  "morris kyle": "kyle_morris",
  morris: "kyle_morris",
  kyle_morris: "kyle_morris",
  luis: "luis_romero",
  "luis romero": "luis_romero",
  luis_romero: "luis_romero",
};

export function accountManagerSlugFromReviewerName(
  value: string | null | undefined
): string | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw || raw === "reviewer") return null;
  const spaced = raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const underscored = spaced.replace(/ /g, "_");
  return (
    REVIEWER_NAME_TO_AM[spaced] ||
    REVIEWER_NAME_TO_AM[underscored] ||
    REVIEWER_NAME_TO_AM[raw] ||
    null
  );
}

// Who to store when revision feedback is saved. A signed-in account manager
// wins. A signed-in person who is not an account manager (Michael) is not
// credited from the name they typed. With no session, the typed name is the
// only record the review page has.
export function revisionAuthorForFeedback(input: {
  sessionSlug?: string | null;
  authorName?: string | null;
}): string | null {
  const raw = (input.sessionSlug || "").trim();
  if (raw.endsWith(":impersonated")) return null;
  if (isCampaignAccountManagerSlug(raw)) return raw;
  if (raw) return null;
  return accountManagerSlugFromReviewerName(input.authorName);
}

export function revisionAuthorSlugs(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value || "").split(",")) {
    const slug = part.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function withRevisionAuthor(
  current: string | null | undefined,
  slug: string | null | undefined
): string {
  const existing = revisionAuthorSlugs(current);
  const next = (slug || "").trim();
  if (!isCampaignAccountManagerSlug(next) || existing.includes(next)) {
    return existing.join(",");
  }
  return [...existing, next].join(",");
}

export type AccountManagerReviewSection =
  | "needs_review"
  | "revisions_made"
  | "revisions_left";

export const ACCOUNT_MANAGER_REVIEW_SECTIONS: {
  id: AccountManagerReviewSection;
  title: string;
  note: string;
  status: string;
}[] = [
  {
    id: "needs_review",
    title: "Needs your review",
    note: "Open a campaign to leave revisions or approve it.",
    status: "internal_review",
  },
  {
    id: "revisions_made",
    title: "Revisions made",
    note: "Michael made the changes. Approve it, or leave another round of revisions.",
    status: "revisions_made",
  },
  {
    id: "revisions_left",
    title: "Revisions left",
    note: "You sent these back. Waiting on Michael.",
    status: "needs_revisions_internal",
  },
];

export function accountManagerReviewSection(
  status: string
): AccountManagerReviewSection | null {
  return (
    ACCOUNT_MANAGER_REVIEW_SECTIONS.find((section) => section.status === status)
      ?.id ?? null
  );
}

export type CampaignVisibility = {
  internal_review_assignee?: string | null;
  review_assignee?: string | null;
  internal_revision_authors?: string | null;
};

export function campaignAssignedToAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug) return false;
  const assignee = (
    campaign.internal_review_assignee ||
    campaign.review_assignee ||
    ""
  ).trim();
  return assignee === slug;
}

export function campaignVisibleToAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug) return false;
  if (campaignAssignedToAccountManager(campaign, slug)) return true;
  return revisionAuthorSlugs(campaign.internal_revision_authors).includes(slug);
}

export type CampaignListViewer = {
  role: string;
  person: string | null;
} | null;

// The slug whose Campaigns list is limited, or null when this login sees
// every campaign. Michael's owner session has no person. Other admins are
// not account managers.
export function accountManagerViewerSlug(
  session: CampaignListViewer
): string | null {
  const person = session?.person?.trim() || "";
  if (!person || !isCampaignAccountManagerSlug(person)) return null;
  return person;
}

export function campaignsVisibleToViewer<T extends CampaignVisibility>(
  rows: T[],
  session: CampaignListViewer
): T[] {
  const slug = accountManagerViewerSlug(session);
  if (!slug) return rows;
  return rows.filter((row) => campaignVisibleToAccountManager(row, slug));
}

export function campaignInAccountManagerQueue(
  campaign: CampaignVisibility & { status: string },
  slug: string
): boolean {
  return (
    accountManagerReviewSection(campaign.status) != null &&
    campaignVisibleToAccountManager(campaign, slug)
  );
}

// Shown under the status badge when the badge alone does not say whose turn it is.
export function accountManagerQueueNote(status: string): string | null {
  if (status === "needs_revisions_internal") return "Waiting on Michael";
  return null;
}
