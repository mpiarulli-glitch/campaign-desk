/**
 * Mailboxes SEO Ops already matches. They used to be the only source for
 * GET /v1/people. They are applied when the roster account's email is still
 * blank, and never overwrite an address already stored on that account.
 */
export const KNOWN_FORECAST_SYNC_EMAILS: Readonly<Record<string, string>> = {
  carlos: "cmorones@marketingempiregroup.com",
  abel: "amiranda@marketingempiregroup.com",
};
