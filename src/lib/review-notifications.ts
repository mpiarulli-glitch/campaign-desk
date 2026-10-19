// Who should see a pending internal-review reminder.
//
// Client-review reminders stay on for everyone. Internal-review reminders are
// off for the owner unless they turn them back on. Anyone else stays on until
// they turn them off. A stored 0 or 1 always wins over that default.

import { OWNER_SLUG } from "./people";

export function internalReviewNotificationsEnabled(input: {
  slug: string | null;
  role?: string | null;
  stored?: number | null;
}): boolean {
  if (input.stored === 0 || input.stored === 1) return input.stored === 1;
  if (!input.slug) return false;
  if (input.slug === OWNER_SLUG || input.role === "owner") return false;
  return true;
}

export function filterInternalReviewFollowups<
  T extends { kind: string; followup_kind?: string | null },
>(items: T[], includeInternal: boolean): T[] {
  if (includeInternal) return items;
  return items.filter(
    (item) => item.kind !== "followup" || item.followup_kind !== "internal"
  );
}
