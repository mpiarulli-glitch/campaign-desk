// The content-type chips on editorial calendars. AssetType is more granular
// than how people actually look at a month ("just the emails", "emails and
// SMS"), so these keys group the stored types into those buckets.

export const CALENDAR_TYPE_KEYS = ["video", "email", "sms"] as const;
export type CalendarTypeKey = (typeof CALENDAR_TYPE_KEYS)[number];

export const CALENDAR_TYPE_LABEL: Record<CalendarTypeKey, string> = {
  video: "Video",
  email: "Email",
  sms: "SMS",
};

export const CALENDAR_TYPE_ASSETS: Record<CalendarTypeKey, readonly string[]> = {
  video: ["social_video_carousel"],
  email: ["email_campaign"],
  sms: ["crm_automation"],
};

export function isCalendarTypeKey(value: string): value is CalendarTypeKey {
  return (CALENDAR_TYPE_KEYS as readonly string[]).includes(value);
}

/**
 * Empty selection means "show everything", including social posts, blogs, and
 * untyped rows. Selecting one or more keys keeps only those buckets, so a
 * blog does not sneak into "Email + SMS".
 */
export function sendMatchesTypeFilter(
  assetType: string | null | undefined,
  selected: readonly CalendarTypeKey[]
): boolean {
  if (selected.length === 0) return true;
  const type = assetType || "";
  return selected.some((key) => CALENDAR_TYPE_ASSETS[key].includes(type));
}
