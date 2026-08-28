import {
  SERVICE,
  basecampConnected,
  commentOnCard,
  createAssignedTodo,
  findOpenTodoOnNamedList,
  getProjectPeopleForMention,
  mentionHtml,
  resolveSylviaMention,
  type BcIdentity,
  type BcPerson,
} from "./basecamp";
import { createTodo, getTodo, updateTodo, type TodoView } from "./todos";
import {
  getCampaignById,
  applyOperatorCampaignStatus,
  recordInternalReviewTodo,
} from "./campaigns";
import { resolveCampaignClient } from "./campaign-card-sync";
import { adminCampaignUrl, reviewUrl } from "./auth";
import { getDb } from "./db";
import { basecampNameForManager } from "./people";
import { slugForName, teamLabel } from "./team";
import { stripSylviaCcLines, SYLVIA_CC_TEXT, sylviaCcHtml } from "./review-cc";

export type InternalReviewPerson = {
  id: number;
  name: string;
  email: string;
  isClient: boolean;
  attachableSgid?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const INTERNAL_REVIEW_MESSAGE_MAX_CHARS = 12_000;
const MENTION_TOKEN = "__IR_MENTION__";
const GREETING_RE = /^(@[^\s,]+|Hey),/;

export function parseInternalReviewDueOn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return DATE_RE.test(value) ? value : null;
}

function firstNameOf(name: string): string {
  const cleaned = (name || "").trim();
  return cleaned.split(/\s+/)[0] || cleaned;
}

export function internalReviewMention(person: {
  id: number;
  name: string;
  email_address?: string;
  attachable_sgid?: string;
}): string {
  if (person.attachable_sgid) return mentionHtml(person as BcPerson);
  const first = firstNameOf(person.name);
  return first ? `@${escapeHtml(first)}` : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkifyEscaped(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trail = url.match(/[),.;!?]+$/);
    const href = trail ? url.slice(0, -trail[0].length) : url;
    const after = trail ? trail[0] : "";
    return `<a href="${href}">${href}</a>${after}`;
  });
}

function reviewLinkHtml(block: string): string | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.join(" ");
  const match = text.match(/^Internal review link:\s*(https?:\/\/\S+)$/i);
  if (!match) return null;
  const raw = match[1];
  const trail = raw.match(/[),.;!?]+$/);
  const href = trail ? raw.slice(0, -trail[0].length) : raw;
  return `<ul><li><a href="${escapeHtml(href)}">Internal review link</a></li></ul>`;
}

// Basecamp rich text has no paragraph margins. A blank line in the editor is a
// bare <br> between blocks; contiguous <p>A</p><p>B</p> renders squished.
const BC_BLANK_LINE = "<br>";

function blocksToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const reviewLink = reviewLinkHtml(block);
      if (reviewLink) return reviewLink;
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const allBullets =
        lines.length > 0 && lines.every((line) => /^[•\-*]\s+/.test(line));
      if (allBullets) {
        const items = lines
          .map((line) => line.replace(/^[•\-*]\s+/, ""))
          .map((line) => `<li>${linkifyEscaped(escapeHtml(line))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${linkifyEscaped(escapeHtml(block.trim())).replace(/\n/g, "<br>")}</p>`;
    })
    .join(BC_BLANK_LINE);
}

export function internalReviewTodoMessageText(input: {
  reviewerName?: string;
  reviewUrl: string;
}): string {
  const first = firstNameOf(input.reviewerName || "");
  const greeting = first ? `@${first}` : "Hey";
  return [
    `${greeting}, please review this campaign internally before it goes to the client.`,
    "",
    "Internal review link:",
    input.reviewUrl,
    "",
    SYLVIA_CC_TEXT,
  ].join("\n");
}

export function withInternalReviewGreeting(text: string, fullName: string): string {
  if (!text || !fullName.trim()) return text;
  const first = firstNameOf(fullName);
  if (!first) return text;
  if (/^Hey,/.test(text)) return text.replace(/^Hey,/, `@${first},`);
  if (/^@[^\s,]+,/.test(text)) return text.replace(/^@[^\s,]+,/, `@${first},`);
  return text;
}

export function withoutInternalReviewGreeting(text: string): string {
  return text.replace(/^(@[^\s,]+|Hey),\s*/, "");
}

// Turns the editable plaintext into Basecamp HTML. The leading @Name (or Hey)
// becomes a real mention when we have one, even if they rewrote the greeting —
// assigning the to-do does not notify them.
export function internalReviewTodoHtmlFromText(
  text: string,
  mention?: string,
  cc?: string
): string {
  const trimmed = stripSylviaCcLines((text || "").replace(/\r\n/g, "\n"));
  const ping = (mention || "").trim();
  const match = trimmed.match(GREETING_RE);
  const rendered = ping || (match ? escapeHtml(match[1]) : "Hey");

  let body = trimmed;
  if (!body) {
    body = `${MENTION_TOKEN}, please review this campaign internally before it goes to the client.`;
  } else if (match) {
    body = body.replace(/^(@[^\s,]+|Hey)/, MENTION_TOKEN);
  } else if (ping) {
    body = `${MENTION_TOKEN}, ${body}`;
  } else {
    return [blocksToHtml(body), sylviaCcHtml(cc)].filter(Boolean).join(BC_BLANK_LINE);
  }

  return [
    blocksToHtml(body).replace(new RegExp(MENTION_TOKEN, "g"), () => rendered),
    sylviaCcHtml(cc),
  ]
    .filter(Boolean)
    .join(BC_BLANK_LINE);
}

export function teamPeopleForInternalReview(
  people: Array<Pick<BcPerson, "id" | "name" | "email_address" | "client" | "employee" | "attachable_sgid">>
): InternalReviewPerson[] {
  return people
    .filter((person) => !person.client)
    .map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email_address || "",
      isClient: Boolean(person.client),
      attachableSgid: person.attachable_sgid || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Prefer the mapped Basecamp display name for this client's AM, then a unique
// first-name hit. Never guess when two people share a first name.
export function pickDefaultInternalReviewer(
  people: InternalReviewPerson[],
  accountManager: string
): InternalReviewPerson | null {
  const team = people.filter((person) => !person.isClient);
  if (!team.length) return null;

  const raw = (accountManager || "").trim();
  if (!raw) return null;

  const mapped = basecampNameForManager(raw);
  const slug = slugForName(raw);
  const label = slug ? teamLabel(slug) : "";
  const queries = [mapped, label, raw]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  for (const query of queries) {
    const exact = team.find(
      (person) =>
        person.name.toLowerCase() === query ||
        person.email.toLowerCase() === query
    );
    if (exact) return exact;
  }

  const first = raw.toLowerCase().split(/\s+/)[0];
  const byFirst = team.filter(
    (person) => person.name.toLowerCase().split(/\s+/)[0] === first
  );
  return byFirst.length === 1 ? byFirst[0] : null;
}

export function internalReviewTodoContent(input: {
  campaignTitle: string;
  clientName: string;
  mention: string;
  reviewUrl: string;
  cc?: string;
  message?: string;
}): { title: string; description: string } {
  const who = input.clientName.trim() ? `${input.clientName.trim()}: ` : "";
  const text =
    (input.message || "").trim() ||
    internalReviewTodoMessageText({ reviewUrl: input.reviewUrl });
  return {
    title: `Review ${who}${input.campaignTitle}`.slice(0, 999),
    description: internalReviewTodoHtmlFromText(text, input.mention, input.cc),
  };
}

export function internalReviewFollowupHtml(input: {
  reviewerName: string;
  campaignTitle: string;
  reviewUrl: string;
  mention?: string;
}): string {
  const name = input.mention || escapeHtml(firstNameOf(input.reviewerName) || "there");
  const title = escapeHtml(input.campaignTitle);
  const url = escapeHtml(input.reviewUrl);
  return [
    `<p>Hi ${name},</p>`,
    `<p>Just a nudge on this internal review — <strong>${title}</strong> is still waiting on you.</p>`,
    `<p><a href="${url}">Internal review link</a></p>`,
  ].join(BC_BLANK_LINE);
}

export function deskInternalReviewTodo(campaignId: string): TodoView | null {
  const needle = `/admin/campaigns/${campaignId}`;
  const row = getDb()
    .prepare(
      `SELECT id FROM todos
        WHERE source = 'internal_review' AND notes LIKE ?
        ORDER BY created_at DESC`
    )
    .get(`%${needle}%`) as { id: string } | undefined;
  return row ? getTodo(row.id) : null;
}

export async function sendCampaignForInternalReview(input: {
  campaignId: string;
  reviewerId: number;
  dueOn?: string | null;
  identity?: BcIdentity;
  message?: string | null;
}): Promise<
  | {
      ok: true;
      reviewerName: string;
      todoId: string;
      todoUrl: string;
      status: string;
      dueOn: string | null;
    }
  | { ok: false; error: string; status: number }
> {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) return { ok: false, error: "Not found", status: 404 };

  if (!basecampConnected()) {
    return {
      ok: false,
      error: "Basecamp isn't connected. Connect it before sending for internal review.",
      status: 400,
    };
  }

  const client = resolveCampaignClient(campaign);
  if (!client?.basecamp_project_id) {
    return {
      ok: false,
      error: "This campaign needs a linked client with a Basecamp project.",
      status: 400,
    };
  }

  const identity = input.identity ?? SERVICE;
  let roster: BcPerson[] = [];
  try {
    roster = await getProjectPeopleForMention(client.basecamp_project_id, identity);
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || "Could not load the Basecamp project roster.",
      status: 502,
    };
  }

  const team = teamPeopleForInternalReview(roster);
  const reviewer = team.find((person) => person.id === input.reviewerId);
  if (!reviewer) {
    return {
      ok: false,
      error: "Pick an account manager on this Basecamp project.",
      status: 400,
    };
  }

  const reviewerPerson = roster.find((person) => person.id === reviewer.id);
  const content = internalReviewTodoContent({
    campaignTitle: campaign.title,
    clientName: campaign.client_name || client.name,
    mention: internalReviewMention(
      reviewerPerson || {
        id: reviewer.id,
        name: reviewer.name,
        attachable_sgid: reviewer.attachableSgid,
      }
    ),
    reviewUrl: reviewUrl(campaign.magic_token),
    cc: await resolveSylviaMention(roster, identity),
    message: (input.message || "").replace(/\r\n/g, "\n").trim() || undefined,
  });
  const dueOn = parseInternalReviewDueOn(input.dueOn);

  // Persist Internal Review before the Basecamp to-do is created so a link
  // unfurl of the review URL cannot race the send and write Sent for approval.
  const updated = applyOperatorCampaignStatus(input.campaignId, "internal_review");
  const status = updated?.status || "internal_review";

  const created = await createAssignedTodo({
    projectId: client.basecamp_project_id,
    title: content.title,
    description: content.description,
    assigneeIds: [reviewer.id],
    dueOn,
    identity,
    listName: "Campaign Review",
  });
  if (!created.ok) {
    return { ok: false, error: created.error, status: 502 };
  }

  recordInternalReviewTodo(input.campaignId, {
    todoId: created.todoId,
    todoUrl: created.todoUrl,
  });

  const assigneeSlug =
    slugForName(reviewer.name) ||
    slugForName(reviewer.name.split(/\s+/)[0] || "") ||
    slugForName(client.account_manager);
  if (assigneeSlug) {
    createTodo({
      title: content.title,
      notes: [
        "Internal review",
        reviewUrl(campaign.magic_token),
        adminCampaignUrl(campaign.id),
        created.todoUrl,
      ].join("\n"),
      clientId: campaign.client_id || client.id,
      assignee: assigneeSlug,
      dueDate: dueOn,
      source: "internal_review",
      listName: "Campaign Review",
    });
  }

  return {
    ok: true,
    reviewerName: reviewer.name,
    todoId: created.todoId,
    todoUrl: created.todoUrl,
    status,
    dueOn,
  };
}

export async function internalReviewState(campaignId: string): Promise<
  | {
      ready: boolean;
      missing: string[];
      clientName: string;
      accountManager: string;
      people: InternalReviewPerson[];
      peopleReason: string;
      defaultReviewerId: number | null;
      todoUrl: string | null;
      todoId: string | null;
      deskTodoId: string | null;
      forecastUrl: string | null;
      assigneeSlug: string | null;
      assigneeName: string | null;
      dueDate: string | null;
      message: string;
    }
  | null
> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return null;

  const client = resolveCampaignClient(campaign);
  const missing: string[] = [];
  if (!client) missing.push("linked client account");
  if (client && !client.basecamp_project_id) missing.push("Basecamp project");
  if (!basecampConnected()) missing.push("Basecamp connection");

  let people: InternalReviewPerson[] = [];
  let peopleReason = "";
  if (client?.basecamp_project_id && basecampConnected()) {
    try {
      const roster = await getProjectPeopleForMention(client.basecamp_project_id);
      people = teamPeopleForInternalReview(roster);
      if (!people.length) {
        peopleReason =
          "Nobody from our team is on that Basecamp project, so there is no one to assign.";
      }
    } catch {
      peopleReason = "Could not load the Basecamp project roster.";
    }
  }

  const desk = deskInternalReviewTodo(campaignId);
  if (desk && client?.id && !desk.client_id) {
    updateTodo(desk.id, { clientId: client.id });
  }
  const stored = getCampaignById(campaignId) || campaign;
  let todoId = (stored.internal_review_todo_id || "").trim() || null;
  let todoUrl = (stored.internal_review_todo_url || "").trim() || null;

  if (!todoUrl && client?.basecamp_project_id && basecampConnected()) {
    const title =
      desk?.title ||
      internalReviewTodoContent({
        campaignTitle: campaign.title,
        clientName: campaign.client_name || client.name,
        mention: "",
        reviewUrl: reviewUrl(campaign.magic_token),
      }).title;
    const found = await findOpenTodoOnNamedList(
      client.basecamp_project_id,
      "Campaign Review",
      title
    );
    if (found) {
      recordInternalReviewTodo(campaignId, { todoId: found.id, todoUrl: found.url });
      todoId = found.id;
      todoUrl = found.url;
    }
  }

  const assigneeSlug = desk?.assignee || null;
  const sentReviewer = pickDefaultInternalReviewer(
    people,
    assigneeSlug || client?.account_manager || ""
  );
  const defaultReviewer =
    sentReviewer || pickDefaultInternalReviewer(people, client?.account_manager || "");

  return {
    ready: missing.length === 0 && people.length > 0,
    missing,
    clientName: client?.name || campaign.client_name || "",
    accountManager: client?.account_manager || "",
    people,
    peopleReason,
    defaultReviewerId: defaultReviewer?.id ?? null,
    todoUrl,
    todoId,
    deskTodoId: desk?.id || null,
    forecastUrl: assigneeSlug ? `/admin/forecast/${assigneeSlug}` : null,
    assigneeSlug,
    assigneeName: assigneeSlug ? teamLabel(assigneeSlug) : sentReviewer?.name || null,
    dueDate: desk?.due_date || null,
    message: internalReviewTodoMessageText({
      reviewerName: defaultReviewer?.name || "",
      reviewUrl: reviewUrl(campaign.magic_token),
    }),
  };
}

export async function followUpInternalReview(
  campaignId: string,
  identity: BcIdentity = SERVICE
): Promise<
  | { ok: true; recipient: string; todoUrl: string }
  | { ok: false; error: string; status: number }
> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { ok: false, error: "Not found", status: 404 };
  if (!basecampConnected()) {
    return { ok: false, error: "Basecamp isn't connected.", status: 400 };
  }
  const client = resolveCampaignClient(campaign);
  if (!client?.basecamp_project_id) {
    return {
      ok: false,
      error: "This campaign's client has no Basecamp project.",
      status: 400,
    };
  }

  const state = await internalReviewState(campaignId);
  const todoId = state?.todoId || campaign.internal_review_todo_id;
  if (!todoId) {
    return {
      ok: false,
      error: "There's no Basecamp to-do to follow up on yet.",
      status: 400,
    };
  }

  let roster: BcPerson[] = [];
  try {
    roster = await getProjectPeopleForMention(client.basecamp_project_id, identity);
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || "Could not load the Basecamp project roster.",
      status: 502,
    };
  }
  const team = teamPeopleForInternalReview(roster);
  const reviewer =
    pickDefaultInternalReviewer(team, state?.assigneeSlug || client.account_manager) ||
    team.find((person) => String(person.id) && state?.defaultReviewerId === person.id) ||
    null;
  if (!reviewer) {
    return {
      ok: false,
      error: "Could not match the reviewer on that Basecamp project.",
      status: 400,
    };
  }
  const reviewerPerson = roster.find((person) => person.id === reviewer.id);
  const html = internalReviewFollowupHtml({
    reviewerName: reviewer.name,
    campaignTitle: campaign.title,
    reviewUrl: reviewUrl(campaign.magic_token),
    mention: internalReviewMention(
      reviewerPerson || {
        id: reviewer.id,
        name: reviewer.name,
        attachable_sgid: reviewer.attachableSgid,
      }
    ),
  });
  const result = await commentOnCard(client.basecamp_project_id, todoId, html, identity);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || "Could not post the follow-up in Basecamp.",
      status: 502,
    };
  }
  return {
    ok: true,
    recipient: reviewer.name,
    todoUrl: result.url || state?.todoUrl || "",
  };
}

