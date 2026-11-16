// Title and description are the review package's public copy. The title is the
// heading on the admin page, the campaign list, and the client review link.
// The description is the note under that heading, and the same string is what
// a client reads on the review link, so it is stored as text and line breaks
// are kept. Callers render it as text (not HTML) with the breaks preserved.

export const CAMPAIGN_TITLE_MAX_LENGTH = 200;
export const CAMPAIGN_DESCRIPTION_MAX_LENGTH = 5000;

export type CampaignCopyError = { ok: false; error: string };

export type NormalizedTitle = { ok: true; title: string };
export type NormalizedDescription = { ok: true; description: string };

function singleLine(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(/\n+/g, " ").trim();
}

// Line endings are normalized so a paste from Windows stores the same breaks
// the review page shows. Internal blank lines and indentation stay. Only the
// edges are trimmed, which matches how a package is created.
function descriptionText(input: string): string {
  return input.replace(/\r\n?/g, "\n").trim();
}

export function normalizeCampaignTitle(
  input: unknown,
  existing?: string
): NormalizedTitle | CampaignCopyError {
  if (typeof input !== "string") {
    return { ok: false, error: "A title can't be empty." };
  }
  const title = singleLine(input);
  if (!title) {
    return { ok: false, error: "A title can't be empty." };
  }
  const stored = typeof existing === "string" ? singleLine(existing) : "";
  if (title.length > CAMPAIGN_TITLE_MAX_LENGTH && title !== stored) {
    return {
      ok: false,
      error: `Title must be ${CAMPAIGN_TITLE_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, title };
}

export function normalizeCampaignDescription(
  input: unknown,
  existing?: string
): NormalizedDescription | CampaignCopyError {
  if (typeof input !== "string") {
    return { ok: false, error: "Description must be text." };
  }
  const description = descriptionText(input);
  const stored = typeof existing === "string" ? descriptionText(existing) : "";
  if (
    description.length > CAMPAIGN_DESCRIPTION_MAX_LENGTH &&
    description !== stored
  ) {
    return {
      ok: false,
      error: `Description must be ${CAMPAIGN_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, description };
}
