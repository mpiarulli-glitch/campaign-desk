// Bot Activity tables and the one-time seed from the October 24, 2026 mockup.
// Called from migrate() on every boot. CREATE TABLE IF NOT EXISTS is a no-op
// when the tables are already there. The seed runs once, inside an immediate
// transaction, and never updates a row that already exists.

import type Database from "better-sqlite3";
import { DEFAULT_BOT_ICON, type BotIcon } from "./bot-activity-icons";
import { seedTimelineInstant, seedWaitingInstant } from "./bot-activity-time";

export const BOT_ACTIVITY_SEED_KEY = "bot_activity_seed_v1";

export type BotSeed = { name: string; icon: BotIcon; agentId: string };

export const BOT_SEED: BotSeed[] = [
  { name: "Jerry", icon: "clipboard", agentId: "74308129-2f1d-43a1-973e-029bc428d239" },
  { name: "Jessica", icon: "mail", agentId: "ddc04864-a4f3-425c-aef8-e53a00fd7227" },
  { name: "Sarah", icon: "mail", agentId: "31cb409c-81c9-4a10-95c0-4148a5aeafdb" },
  { name: "Daniel", icon: "mail", agentId: "9571e7e5-cdad-4f22-b413-7ab8e15973bf" },
  { name: "Emily", icon: "mail", agentId: "" },
  { name: "Rachel", icon: "mail", agentId: "cec22a29-7e04-46be-9061-3efab0248b01" },
  { name: "Thomas", icon: "flow", agentId: "65cb5953-6094-43da-94bb-42ccc910571b" },
  { name: "Wes", icon: "flow", agentId: "" },
  { name: "Olivia", icon: "chat", agentId: "bdd228eb-77ef-4565-a656-75973cd2db89" },
  { name: "James", icon: "chart", agentId: "9ddf64b1-0e55-4159-8fd6-ed51c53ce1af" },
  { name: "Lincoln", icon: "link", agentId: "7b766fe0-5455-458b-baf7-c02ef776035a" },
  { name: "David", icon: "news", agentId: "ab3a26ac-65b3-498f-b501-7b4f052aa909" },
  { name: "Zap", icon: "bolt", agentId: "4d8fe660-5da8-4ee4-ac42-0e761c5c6498" },
];

export type WaitingSeed = {
  bot: string;
  key: string;
  title: string;
  detail: string;
  when: string;
};

export const WAITING_SEED: WaitingSeed[] = [
  {
    bot: "Jerry",
    key: "sign-in-to-empire-analytics",
    title: "Sign in to Empire Analytics",
    detail:
      "Fill in the login form so I can check that every GHL client on the Lifecycle tab is connected. Hendo's, 12 Volt and Trailhead are left out.",
    when: "Fri 5:09 PM",
  },
  {
    bot: "Daniel",
    key: "vita-q4-offer-answers-and-mockup",
    title: "Vita Q4: offer answers and mockup",
    detail:
      "Seven offer questions (last day to buy, XERF 25%, 30% membership, 3-month gift, Vita Credit, send times, archive old items 2, 5, 6, 8) plus Cassidy's mockup PNG.",
    when: "Fri 5:19 PM",
  },
  {
    bot: "Jessica",
    key: "looda-four-decisions-and-a-test-check",
    title: "Looda: four decisions and a test check",
    detail:
      "Rebuild the Lead Magnet banners, add the logo to the funnel header, add +1 to the business phone, archive old logo files. Also check the First Look 01 test, and OK the Kyle test and Basecamp comment.",
    when: "Fri 5:54 PM",
  },
  {
    bot: "Sarah",
    key: "krak-piscataway-pre-launch-13-client-answers",
    title: "Krak Piscataway pre-launch: 13 client answers",
    detail:
      "Email opt-in consent, GHL sub-account and sender, BOGO terms, drink and keychain counts, Facebook event and rules URLs, spelling of Krak'in.",
    when: "Fri 5:19 PM",
  },
  {
    bot: "Thomas",
    key: "krak-piscataway-retention-account-and-terms",
    title: "Krak Piscataway retention: account and terms",
    detail:
      "Which GHL account to use (no Piscataway sub-account), footer fields, SMS consent, how visit data reaches GHL, BOGO and perks, review link, sender domain.",
    when: "Fri 5:30 PM",
  },
  {
    bot: "Jerry",
    key: "which-client-are-the-leak-emails-for",
    title: "Which client are the leak emails for?",
    detail:
      "Nothing named leak turned up in Campaign Desk, active or archived. Tell me the client or campaign and I'll check whether it's image based.",
    when: "Fri 5:33 PM",
  },
  {
    bot: "Jerry",
    key: "cassidy-comment-on-the-kentina-sunset-email",
    title: "Cassidy comment on the Kentina sunset email",
    detail:
      "Offered earlier: a Basecamp comment saying the two offer codes were added in v7 but valid-through dates and links are still placeholders. Waiting for your yes to draft it.",
    when: "Earlier",
  },
  {
    bot: "Zap",
    key: "hrig-review-requests-reconnect-hubspot",
    title: "HRIG review requests: reconnect HubSpot",
    detail:
      "The review request zap needs HubSpot reconnected in Zapier and the GHL emails approved. Last reported status.",
    when: "Earlier",
  },
  {
    bot: "Olivia",
    key: "meg-thank-you-pages-add-the-dns-record",
    title: "MEG thank-you pages: add the DNS record",
    detail:
      "Waiting on the thankyou CNAME pointing to sites.ludicrous.cloud before she can verify the domain. Last reported status.",
    when: "Earlier",
  },
];

export type TimelineSeed = { day: string; when: string; bot: string; text: string };

export const TIMELINE_SEED: TimelineSeed[] = [
  { day: "Sat Oct 24", when: "11:32 AM", bot: "Jerry", text: "You asked for this dashboard. First version built from today's activity." },
  { day: "Fri Oct 23", when: "5:54 PM", bot: "Jessica", text: "Looda logo swap finished in GHL: 7 templates, 3 workflows, the First Look popup and the business profile. Send times untouched. Test of First Look 01 sent to you." },
  { day: "Fri Oct 23", when: "5:33 PM", bot: "Jerry", text: "Searched Campaign Desk for leak emails and found none, including archived campaigns." },
  { day: "Fri Oct 23", when: "5:30 PM", bot: "Thomas", text: "Krak Piscataway retention: 11 email drafts are in Campaign Desk. Drip starts Dec 5 or later so it never overlaps Sarah's emails. No workflows or texts built yet." },
  { day: "Fri Oct 23", when: "5:25 PM", bot: "Daniel", text: "Vita Q4 v6 saved as draft versions 34 to 37 for Black Friday, Cyber Monday and two gifting emails. Nothing scheduled." },
  { day: "Fri Oct 23", when: "5:24 PM", bot: "Sarah", text: "Krak Piscataway pre-launch: all 4 emails are in a Campaign Desk draft, with no send times set." },
  { day: "Fri Oct 23", when: "5:24 PM", bot: "Jerry", text: "Renamed the first Krak Piscataway email to E1 Welcome to the Giveaway." },
  { day: "Fri Oct 23", when: "5:19 PM", bot: "Thomas", text: "Plan set: the welcome drip removes people from Sarah's sequence and adds a 24-hour gap between any two Krak sends." },
  { day: "Fri Oct 23", when: "5:19 PM", bot: "Sarah", text: "Proposed Krak Piscataway sends: Oct 30, Nov 10, Nov 19 and Dec 3 at 11 AM ET." },
  { day: "Fri Oct 23", when: "5:19 PM", bot: "Daniel", text: "Vita Q4: asked 7 offer questions and the mockup file, then built the 4 emails with placeholders." },
  { day: "Fri Oct 23", when: "5:10 PM", bot: "Jerry", text: "Pulled the Lifecycle client list from Campaign Desk (about 29 clients) for the Empire Analytics check." },
  { day: "Fri Oct 23", when: "5:09 PM", bot: "Jerry", text: "Sent you the Empire Analytics login form and passed the Looda logos to Jessica." },
];

export type WorkSeed = {
  bot: string;
  key: string;
  title: string;
  detail: string;
  state: "progress" | "blocked" | "done";
  when: string;
};

export const WORK_SEED: WorkSeed[] = [
  { bot: "Daniel", key: "vita-q4-finalize", title: "Vita Q4 finalize", detail: "v6 saved. Matches the exact green after the mockup arrives, then applies your answers.", state: "progress", when: "Fri 5:25 PM" },
  { bot: "Thomas", key: "krak-piscataway-ghl-workflows-and-texts", title: "Krak Piscataway GHL workflows and texts", detail: "Blocked until there is a Piscataway GHL account. Email drafts are done.", state: "blocked", when: "Fri 5:30 PM" },
  { bot: "Jerry", key: "empire-analytics-ghl-check", title: "Empire Analytics GHL check", detail: "Client list is ready. Blocked on your login.", state: "blocked", when: "Fri 5:10 PM" },
  { bot: "Sarah", key: "krak-november-black-friday-swap", title: "Krak November Black Friday swap", detail: "Six emails done; waiting on the decision about the older Campaign Desk batch. Last reported.", state: "progress", when: "Earlier" },
  { bot: "David", key: "weekly-thursday-meg-ai-newsletter", title: "Weekly Thursday MEG AI newsletter", detail: "Building drafts only. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Olivia", key: "floorco-chatbot-and-booking-automations", title: "FloorCo chatbot and booking automations", detail: "Draft stage. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Wes", key: "our-watch-donation-and-join-abandon-flow", title: "Our Watch donation and join abandon flow", detail: "Draft stage. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Rachel", key: "our-watch-church-center-links", title: "Our Watch Church Center links, emails 2 to 7", detail: "In Campaign Desk. Last reported.", state: "progress", when: "Earlier" },
  { bot: "James", key: "audit-of-new-accounts-booking-funnels", title: "Audit of new accounts' booking funnels", detail: "Read only. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Lincoln", key: "kentina-linkedin-outreach-in-skylead", title: "Kentina LinkedIn outreach in Skylead", detail: "Draft stage. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Emily", key: "looda-lead-magnet-popups", title: "Looda lead magnet popups and delivery automation", detail: "Drafts in GHL. Last reported.", state: "progress", when: "Earlier" },
  { bot: "Jessica", key: "looda-logo-swap", title: "Looda logo swap", detail: "Done in GHL. Banner artwork and funnel header need your decision.", state: "done", when: "Fri 5:54 PM" },
  { bot: "Thomas", key: "krak-piscataway-retention-emails", title: "Krak Piscataway retention emails", detail: "11 drafts in Campaign Desk, QA passed with no blockers.", state: "done", when: "Fri 5:30 PM" },
  { bot: "Daniel", key: "vita-q4-v6-emails", title: "Vita Q4 v6 emails", detail: "4 revisions saved as drafts, design and copy QA passed.", state: "done", when: "Fri 5:25 PM" },
  { bot: "Sarah", key: "krak-piscataway-pre-launch-emails", title: "Krak Piscataway pre-launch emails", detail: "4 emails in a Campaign Desk draft, QA passed.", state: "done", when: "Fri 5:24 PM" },
  { bot: "Jerry", key: "campaign-desk-client-list-and-e1-rename", title: "Campaign Desk client list and E1 rename", detail: "Lifecycle client list pulled; first Krak email renamed.", state: "done", when: "Fri 5:24 PM" },
  { bot: "Wes", key: "superior-patios-scheduled", title: "Superior Patios scheduled", detail: "Set for Tue Oct 27 at 10 AM PT in GHL.", state: "done", when: "Earlier" },
  { bot: "Emily", key: "chaparral-emails-scheduled", title: "Chaparral emails scheduled", detail: "Oct 20 and Oct 22 at 10 AM PT.", state: "done", when: "Earlier" },
  { bot: "James", key: "cisco-october-email-scheduled", title: "Cisco October email scheduled", detail: "Tue Oct 20 at 4 PM PT.", state: "done", when: "Earlier" },
];

function tableExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function stampSeed(database: Database.Database, at: string): void {
  database
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(BOT_ACTIVITY_SEED_KEY, at, at);
}

function insertSeed(database: Database.Database, at: string): void {
  const bot = database.prepare(
    `INSERT INTO bot_activity_bots (name, icon, agent_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO NOTHING`
  );
  for (const row of BOT_SEED) {
    bot.run(row.name, row.icon || DEFAULT_BOT_ICON, row.agentId, at);
  }

  const item = database.prepare(
    `INSERT INTO bot_activity_items (
       id, kind, bot, item_key, title, detail, state, status,
       occurred_at, when_label, sort_index, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
     ON CONFLICT(kind, bot, item_key) DO NOTHING`
  );
  WAITING_SEED.forEach((row, index) => {
    const occurred = seedWaitingInstant(row.when, index, WAITING_SEED.length);
    item.run(
      `seed-w-${index + 1}`,
      "waiting",
      row.bot,
      row.key,
      row.title,
      row.detail,
      "",
      occurred,
      row.when,
      index,
      at,
      occurred
    );
  });
  WORK_SEED.forEach((row, index) => {
    const occurred = seedWaitingInstant(row.when, index, WORK_SEED.length);
    item.run(
      `seed-k-${index + 1}`,
      "work",
      row.bot,
      row.key,
      row.title,
      row.detail,
      row.state,
      occurred,
      row.when,
      index,
      at,
      occurred
    );
  });

  const timeline = database.prepare(
    `INSERT INTO bot_activity_timeline (
       id, bot, body, occurred_at, day_label, when_label, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  TIMELINE_SEED.forEach((row, index) => {
    const occurred = seedTimelineInstant(row.day, row.when, index, TIMELINE_SEED.length);
    timeline.run(`seed-t-${index + 1}`, row.bot, row.text, occurred, row.day, row.when, at);
  });

  stampSeed(database, at);
}

export function ensureBotActivitySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bot_activity_bots (
      name TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT 'clipboard',
      agent_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_activity_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('waiting', 'work')),
      bot TEXT NOT NULL,
      item_key TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      occurred_at TEXT NOT NULL,
      when_label TEXT NOT NULL DEFAULT '',
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (kind, bot, item_key)
    );

    CREATE INDEX IF NOT EXISTS idx_bot_activity_items_kind
      ON bot_activity_items(kind, status, sort_index);

    CREATE TABLE IF NOT EXISTS bot_activity_timeline (
      id TEXT PRIMARY KEY,
      bot TEXT NOT NULL,
      body TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      day_label TEXT NOT NULL DEFAULT '',
      when_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bot_activity_timeline_at
      ON bot_activity_timeline(occurred_at);

    CREATE TABLE IF NOT EXISTS bot_activity_replies (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES bot_activity_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bot_activity_replies_item
      ON bot_activity_replies(item_id, created_at);
  `);

  if (!tableExists(database, "app_settings")) return;

  const run = database.transaction(() => {
    const flag = database
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(BOT_ACTIVITY_SEED_KEY) as { value: string } | undefined;
    if (flag?.value) return;

    const existing = database
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_bots`)
      .get() as { n: number };
    const at = new Date().toISOString();
    // Rows are already here (a previous seed, or something a bot posted
    // before the flag was written). Do not insert the mockup over them.
    if (existing.n > 0) {
      stampSeed(database, at);
      return;
    }
    insertSeed(database, at);
  });
  run.immediate();
}
