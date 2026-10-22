// Account-manager queue on the Campaigns tab.
//
// A campaign needs this person's eyes when it is in the internal review loop
// and it is theirs: the client's account manager resolves to their login (the
// same Owner column the list already shows), or the internal-review to-do was
// assigned to them. Either one is enough. Kyle the account manager is Kyle
// Morris; Kyle Onstott is a different login and does not match "Kyle".

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

export function campaignAssignedToAccountManager(
  campaign: { owner_key?: string | null; review_assignee?: string | null },
  slug: string
): boolean {
  if (!slug) return false;
  return campaign.owner_key === slug || campaign.review_assignee === slug;
}

export function campaignInAccountManagerQueue(
  campaign: {
    status: string;
    owner_key?: string | null;
    review_assignee?: string | null;
  },
  slug: string
): boolean {
  return (
    accountManagerReviewSection(campaign.status) != null &&
    campaignAssignedToAccountManager(campaign, slug)
  );
}

// Shown under the status badge when the badge alone does not say whose turn it is.
export function accountManagerQueueNote(status: string): string | null {
  if (status === "needs_revisions_internal") return "Waiting on Michael";
  return null;
}
