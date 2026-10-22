// What an account manager sees on the Campaigns tab.
//
// Cassidy, Kyle Morris, and Luis are the account managers. Michael and every
// other login still see the full list. An account manager sees a campaign
// when the internal review was sent to them, or when they left revisions on
// it. Later statuses stay visible so they can follow that work.
//
// Older campaigns often have neither of those recorded. Revision notes were
// saved as "Reviewer" or as Michael, and the assignee backfill only copied a
// desk to-do that linked the admin campaign URL. When both are blank, the
// client's Owner (the account manager stored on the client) is the fallback,
// including on the main list, so a Revisions made campaign is not dropped.
// Owning the client does not override a review that was assigned to someone
// else, or revisions someone else left.
//
// Once that account manager marks it Approved Internally, it leaves their
// main list and shows under Approved by me. It comes back to the main list
// when a later internal review is assigned to them, or when it is back in
// the internal loop and the only link left is that they own the client.
//
// The three queue sections are the main list, narrowed to the internal loop:
// Needs your review, Revisions made, and Revisions left.

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
  status?: string;
  internal_review_assignee?: string | null;
  review_assignee?: string | null;
  internal_revision_authors?: string | null;
  // Account-manager slugs who marked this Approved Internally, comma-separated.
  // Survives client approval and later statuses. approved_by does not.
  internal_approved_by?: string | null;
  // Raw account manager on the client (a slug, "Cassidy" / "Kyle" / "Luis",
  // or a full name). The Owner column on the campaigns list. owner_key is
  // accepted for the same value when the raw field was not passed.
  client_account_manager?: string | null;
  owner_key?: string | null;
};

// The client account-manager field stores "Kyle", "Cassidy", or "Luis".
// Bare "Kyle" in a comment stays unmatched, because Kyle Onstott is a
// different person. In this field it is the account manager Kyle Morris.
export function accountManagerSlugFromOwner(
  value: string | null | undefined
): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const local = (raw.includes("@") ? raw.split("@")[0] : raw).trim();
  const fromName = accountManagerSlugFromReviewerName(local);
  if (fromName) return fromName;
  const key = local.toLowerCase().replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  if (key === "kyle") return "kyle_morris";
  if (key === "cassidy") return "cassidy";
  if (key === "luis") return "luis_romero";
  if (isCampaignAccountManagerSlug(key)) return key;
  const underscored = key.replace(/ /g, "_");
  if (isCampaignAccountManagerSlug(underscored)) return underscored;
  return null;
}

function recordedAssignee(campaign: CampaignVisibility): string {
  return (campaign.internal_review_assignee || campaign.review_assignee || "").trim();
}

// A stored display name ("Cassidy Merideth") counts as that account manager.
// Anything else is left as written so an unknown assignee is not dropped.
export function resolvedReviewAssignee(campaign: CampaignVisibility): string {
  const raw = recordedAssignee(campaign);
  if (!raw) return "";
  if (isCampaignAccountManagerSlug(raw)) return raw;
  return accountManagerSlugFromReviewerName(raw) || accountManagerSlugFromOwner(raw) || raw;
}

export function campaignAttributionMissing(campaign: CampaignVisibility): boolean {
  return (
    !recordedAssignee(campaign) &&
    revisionAuthorSlugs(campaign.internal_revision_authors).length === 0
  );
}

function ownerRaw(campaign: CampaignVisibility): string {
  if (campaign.client_account_manager != null) {
    return campaign.client_account_manager.trim();
  }
  return (campaign.owner_key || "").trim();
}

// Used only when the review assignee and the revision authors were never
// recorded. A campaign assigned to someone else stays with that person.
export function campaignOwnedByAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug || !campaignAttributionMissing(campaign)) return false;
  return accountManagerSlugFromOwner(ownerRaw(campaign)) === slug;
}

export type AccountManagerListScope = "main" | "approved";

export function internalApproverSlugs(value: string | null | undefined): string[] {
  return revisionAuthorSlugs(value);
}

// The internal loop is assigned to this account manager again, so the campaign
// belongs on their main list until they approve it once more.
export function campaignBackWithAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug || !campaign.status) return false;
  if (!accountManagerReviewSection(campaign.status)) return false;
  return (
    campaignAssignedToAccountManager(campaign, slug) ||
    campaignOwnedByAccountManager(campaign, slug)
  );
}

export function campaignApprovedByAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug) return false;
  if (!internalApproverSlugs(campaign.internal_approved_by).includes(slug)) return false;
  return !campaignBackWithAccountManager(campaign, slug);
}

// Main list: work sent to them, revisions they left, or — when neither of
// those was recorded — campaigns whose client they own. An internal approval
// still parks the campaign until it is back in the internal loop for them.
export function campaignOnAccountManagerMainList(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug) return false;
  if (campaignBackWithAccountManager(campaign, slug)) return true;
  if (internalApproverSlugs(campaign.internal_approved_by).includes(slug)) return false;
  if (campaignAssignedToAccountManager(campaign, slug)) return true;
  if (revisionAuthorSlugs(campaign.internal_revision_authors).includes(slug)) return true;
  return campaignOwnedByAccountManager(campaign, slug);
}

export function campaignAssignedToAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  if (!slug) return false;
  return resolvedReviewAssignee(campaign) === slug;
}

export function attachClientAccountManager<T extends { client_id?: string | null }>(
  rows: T[],
  accountManagerByClient: ReadonlyMap<string, string>
): Array<T & { client_account_manager: string }> {
  return rows.map((row) => ({
    ...row,
    client_account_manager: row.client_id
      ? accountManagerByClient.get(row.client_id) || ""
      : "",
  }));
}

// Either tab. Search uses this so an account manager can still find a campaign
// they approved, without seeing anyone else's.
export function campaignVisibleToAccountManager(
  campaign: CampaignVisibility,
  slug: string
): boolean {
  return (
    campaignOnAccountManagerMainList(campaign, slug) ||
    campaignApprovedByAccountManager(campaign, slug)
  );
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
  session: CampaignListViewer,
  scope: AccountManagerListScope = "main"
): T[] {
  const slug = accountManagerViewerSlug(session);
  if (!slug) return rows;
  const keep =
    scope === "approved"
      ? campaignApprovedByAccountManager
      : campaignOnAccountManagerMainList;
  return rows.filter((row) => keep(row, slug));
}

export function campaignInAccountManagerQueue(
  campaign: CampaignVisibility & { status: string },
  slug: string
): boolean {
  return (
    accountManagerReviewSection(campaign.status) != null &&
    campaignOnAccountManagerMainList(campaign, slug)
  );
}

// Shown under the status badge when the badge alone does not say whose turn it is.
export function accountManagerQueueNote(status: string): string | null {
  if (status === "needs_revisions_internal") return "Waiting on Michael";
  return null;
}
