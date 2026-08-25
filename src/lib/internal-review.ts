import {
  SERVICE,
  basecampConnected,
  createAssignedTodo,
  getProjectPeopleForMention,
  mentionHtml,
  type BcIdentity,
  type BcPerson,
} from "./basecamp";
import { createTodo } from "./todos";
import { getCampaignById, applyOperatorCampaignStatus } from "./campaigns";
import { resolveCampaignClient } from "./campaign-card-sync";
import { adminCampaignUrl, reviewUrl } from "./auth";
import { basecampNameForManager } from "./people";
import { slugForName, teamLabel } from "./team";

export type InternalReviewPerson = {
  id: number;
  name: string;
  email: string;
  isClient: boolean;
  attachableSgid?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
}): { title: string; description: string } {
  const who = input.clientName.trim() ? `${input.clientName.trim()}: ` : "";
  const greeting = input.mention || "Hey";
  return {
    title: `Review ${who}${input.campaignTitle}`.slice(0, 999),
    description: [
      `<p>${greeting}, please review this campaign internally before it goes to the client.</p>`,
      `<ul>`,
      `<li><a href="${escapeHtml(input.reviewUrl)}">Internal review link</a></li>`,
      `</ul>`,
    ].join(""),
  };
}

export async function sendCampaignForInternalReview(input: {
  campaignId: string;
  reviewerId: number;
  dueOn?: string | null;
  identity?: BcIdentity;
}): Promise<
  | {
      ok: true;
      reviewerName: string;
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
  });
  const dueOn = parseInternalReviewDueOn(input.dueOn);

  const created = await createAssignedTodo({
    projectId: client.basecamp_project_id,
    title: content.title,
    description: content.description,
    assigneeIds: [reviewer.id],
    dueOn,
    identity,
  });
  if (!created.ok) {
    return { ok: false, error: created.error, status: 502 };
  }

  const assigneeSlug =
    slugForName(reviewer.name) ||
    slugForName(reviewer.name.split(/\s+/)[0] || "") ||
    slugForName(client.account_manager);
  if (assigneeSlug) {
    createTodo({
      title: content.title,
      notes: `Internal review\n${reviewUrl(campaign.magic_token)}\n${adminCampaignUrl(campaign.id)}`,
      clientId: campaign.client_id,
      assignee: assigneeSlug,
      dueDate: dueOn,
      source: "internal_review",
      listName: "Campaign Review",
    });
  }

  const updated = applyOperatorCampaignStatus(input.campaignId, "internal_review");
  const status = updated?.status || "internal_review";

  return {
    ok: true,
    reviewerName: reviewer.name,
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

  const defaultReviewer = pickDefaultInternalReviewer(
    people,
    client?.account_manager || ""
  );

  return {
    ready: missing.length === 0 && people.length > 0,
    missing,
    clientName: client?.name || campaign.client_name || "",
    accountManager: client?.account_manager || "",
    people,
    peopleReason,
    defaultReviewerId: defaultReviewer?.id ?? null,
  };
}

