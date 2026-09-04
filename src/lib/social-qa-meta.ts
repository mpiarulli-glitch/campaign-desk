import type { SocialBatchStatus } from "./db";

export const SOCIAL_QA_STATUSES: SocialBatchStatus[] = [
  "draft",
  "in_qa",
  "needs_revisions",
  "approved",
];

export const SOCIAL_QA_STATUS_LABELS: Record<SocialBatchStatus, string> = {
  draft: "Draft",
  in_qa: "In QA",
  needs_revisions: "Needs revisions",
  approved: "Approved",
};

export const SOCIAL_CHANNELS = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "TikTok",
  "YouTube",
  "Pinterest",
  "Other",
] as const;

export const SOCIAL_ISSUE_TAGS = [
  { value: "typo", label: "Typo / grammar" },
  { value: "wrong_date", label: "Wrong date" },
  { value: "wrong_offer", label: "Wrong offer / price" },
  { value: "brand", label: "Off brand" },
  { value: "wrong_asset", label: "Wrong creative" },
  { value: "caption", label: "Caption vs creative" },
  { value: "other", label: "Other" },
] as const;

export type SocialIssueTag = (typeof SOCIAL_ISSUE_TAGS)[number]["value"];

export const SOCIAL_QA_CHECKLIST = [
  { key: "spelling", label: "Checked for spelling errors" },
  { key: "links", label: "Checked that all links are accurate and work" },
  {
    key: "meg_standard",
    label: "Checked that everything was quality and up to the MEG Standard",
  },
] as const;

export type SocialQaChecklistKey = (typeof SOCIAL_QA_CHECKLIST)[number]["key"];
export type SocialQaChecklistState = Record<SocialQaChecklistKey, boolean>;

export function emptySocialQaChecklist(): SocialQaChecklistState {
  return { spelling: false, links: false, meg_standard: false };
}

export function socialQaChecklistComplete(
  checks: Partial<Record<string, boolean>> | null | undefined
): boolean {
  return SOCIAL_QA_CHECKLIST.every((item) => checks?.[item.key] === true);
}

export function isSocialBatchStatus(v: unknown): v is SocialBatchStatus {
  return typeof v === "string" && SOCIAL_QA_STATUSES.includes(v as SocialBatchStatus);
}

export function isSocialIssueTag(v: unknown): v is SocialIssueTag {
  return typeof v === "string" && SOCIAL_ISSUE_TAGS.some((t) => t.value === v);
}

export function issueTagLabel(tag: string): string {
  return SOCIAL_ISSUE_TAGS.find((t) => t.value === tag)?.label || tag;
}
