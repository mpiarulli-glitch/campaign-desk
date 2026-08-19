// The content-type chips on editorial calendars. AssetType is more granular
// than how people actually look at a month ("just the emails", "emails and
// SMS"), so these keys group the stored types into those buckets.

export const CALENDAR_TYPE_KEYS = [
  "video",
  "social",
  "email",
  "sms",
  "blog",
  "untyped",
] as const;
export type CalendarTypeKey = (typeof CALENDAR_TYPE_KEYS)[number];

export const CALENDAR_TYPE_LABEL: Record<CalendarTypeKey, string> = {
  video: "Video",
  social: "Social Posts",
  email: "Emails",
  sms: "SMS",
  blog: "Blogs",
  untyped: "Untyped",
};

export const CALENDAR_TYPE_ASSETS: Record<
  Exclude<CalendarTypeKey, "untyped">,
  readonly string[]
> = {
  video: ["social_video_carousel"],
  social: ["social_post"],
  email: ["email_campaign"],
  sms: ["crm_automation"],
  blog: ["blog_post"],
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
  return selected.some((key) => {
    if (key === "untyped") return !type;
    return CALENDAR_TYPE_ASSETS[key].includes(type);
  });
}
