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

/**
 * Grok Bot app ids for Open chat. Names that are not here have no deep link.
 * Emily and Wes are omitted on purpose: no id is known for them.
 */
export const GROK_BOT_AGENT_IDS: Record<string, string> = {
  Jerry: "74308129-2f1d-43a1-973e-029bc428d239",
  Jessica: "ddc04864-a4f3-425c-aef8-e53a00fd7227",
  Sarah: "31cb409c-81c9-4a10-95c0-4148a5aeafdb",
  Daniel: "9571e7e5-cdad-4f22-b413-7ab8e15973bf",
  Thomas: "65cb5953-6094-43da-94bb-42ccc910571b",
  Zap: "4d8fe660-5da8-4ee4-ac42-0e761c5c6498",
  Olivia: "bdd228eb-77ef-4565-a656-75973cd2db89",
  Cody: "5e4e3635-7589-4b3e-9782-6a00d07b53e0",
  Lincoln: "7b766fe0-5455-458b-baf7-c02ef776035a",
  Rachel: "cec22a29-7e04-46be-9061-3efab0248b01",
  James: "9ddf64b1-0e55-4159-8fd6-ed51c53ce1af",
  David: "ab3a26ac-65b3-498f-b501-7b4f052aa909",
};

export function grokBotHref(name: string): string | null {
  return botChatHref(GROK_BOT_AGENT_IDS[name]);
}
