/**
 * Mailboxes Carlos's SEO Ops sync already matches.
 *
 * A blank roster account can be filled with its address. Once that is the
 * address on the account, other desk edits cannot replace it or clear it.
 * Carlos is cmorones@; Abel is the other mailbox that same sync lists.
 */
export const KNOWN_FORECAST_SYNC_EMAILS: Readonly<Record<string, string>> = {
  carlos: "cmorones@marketingempiregroup.com",
  abel: "amiranda@marketingempiregroup.com",
};

export class SeoOpsEmailLocked extends Error {
  constructor(slug: string) {
    super(`seo_ops_email_locked:${slug}`);
    this.name = "SeoOpsEmailLocked";
  }
}
