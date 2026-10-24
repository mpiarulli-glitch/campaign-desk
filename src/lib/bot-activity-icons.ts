// Role icons and chat links for Bot Activity. No database imports: the page
// bundle can use this, and the seed can use it, without pulling in sqlite.

export const BOT_ICONS = [
  "mail",
  "bolt",
  "flow",
  "clipboard",
  "link",
  "chat",
  "chart",
  "news",
] as const;

export type BotIcon = (typeof BOT_ICONS)[number];

export const DEFAULT_BOT_ICON: BotIcon = "clipboard";

const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asBotIcon(value: string | null | undefined): BotIcon {
  if (value && (BOT_ICONS as readonly string[]).includes(value)) return value as BotIcon;
  return DEFAULT_BOT_ICON;
}

/** grokbot chat link, or null when the bot has no real agent id. */
export function botChatHref(agentId: string | null | undefined): string | null {
  const id = (agentId || "").trim();
  if (!AGENT_ID.test(id)) return null;
  return `grokbot://app/v1/agent?id=${id}`;
}
