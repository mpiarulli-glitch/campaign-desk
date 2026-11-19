/**
 * Client review rules that the page and the tests both need.
 *
 * Nothing here sends mail or writes the database. It only decides what a
 * reviewer is allowed to do, and the words they should see.
 */

export function isFullName(name: string): boolean {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export type ReviewSubject = { id: string; subject: string };

export type ReviewItemGate = {
  id: string;
  title: string;
  subjects?: ReviewSubject[] | null;
  chosenSubjectId?: string | null;
};

export type ApproveGate =
  | { ok: true; subjects: Array<{ title: string; subject: string }> }
  | { ok: false; reason: string };

/** One subject (or none) is already decided. Two or more need an explicit pick. */
export function subjectIsChosen(item: ReviewItemGate): boolean {
  const subjects = item.subjects || [];
  if (subjects.length <= 1) return true;
  return subjects.some((s) => s.id === item.chosenSubjectId);
}

export function chosenSubjectLine(item: ReviewItemGate): string | null {
  const subjects = item.subjects || [];
  if (subjects.length === 0) return null;
  if (subjects.length === 1) return subjects[0].subject || null;
  const chosen = subjects.find((s) => s.id === item.chosenSubjectId);
  return chosen?.subject || null;
}

/**
 * Final package approval.
 * One item: name + subject pick (only when there is a choice).
 * Several items: the reviewer also has to open each one first.
 */
export function finalApproveGate(input: {
  items: ReviewItemGate[];
  openedIds: readonly string[];
  approverName: string;
}): ApproveGate {
  const items = input.items;
  if (items.length === 0) {
    return { ok: false, reason: "There is nothing to approve yet." };
  }
  if (!isFullName(input.approverName)) {
    return { ok: false, reason: "Add your first and last name to approve." };
  }
  if (items.length > 1) {
    const opened = new Set(input.openedIds);
    const missed = items.filter((item) => !opened.has(item.id));
    if (missed.length > 0) {
      const seen = items.length - missed.length;
      return {
        ok: false,
        reason: `Open each item before approving (${seen} of ${items.length} opened).`,
      };
    }
  }
  const unpicked = items.filter((item) => !subjectIsChosen(item));
  if (unpicked.length > 0) {
    const name = unpicked[0].title || "this item";
    return {
      ok: false,
      reason:
        unpicked.length === 1
          ? `Pick a subject line for ${name} before approving.`
          : "Pick a subject line on each item that has more than one.",
    };
  }
  const subjects = items
    .map((item) => {
      const subject = chosenSubjectLine(item);
      return subject ? { title: item.title, subject } : null;
    })
    .filter((row): row is { title: string; subject: string } => Boolean(row));
  return { ok: true, subjects };
}

export type ClientReviewCopy = {
  label: string;
  detail: string;
  tone: "you" | "team" | "done";
};

/**
 * Words for the review link. Staff labels stay on the admin screens.
 * This copy never names an internal handoff or a person on the team.
 */
export function clientReviewCopy(
  status: string,
  internallyApproved = false
): ClientReviewCopy {
  if (internallyApproved && status !== "approved") {
    return {
      label: "With you",
      detail:
        "The team has signed off. This still needs your approval before it is finished.",
      tone: "you",
    };
  }
  switch (status) {
    case "draft":
    case "internal_review":
    case "needs_revisions_internal":
      return {
        label: "We're revising",
        detail: "The team is working on this. You can still leave a note.",
        tone: "team",
      };
    case "revisions_made":
    case "needs_changes":
      return {
        label: "With you",
        detail: "Updates are in. Approve it, or send another note.",
        tone: "you",
      };
    case "in_review":
      return {
        label: "With you",
        detail: "Read it, leave a note, or approve it.",
        tone: "you",
      };
    case "approved":
      return {
        label: "Approved",
        detail: "The team has this. Feedback is closed, and you can still read everything.",
        tone: "done",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        detail: "This is approved and on the calendar.",
        tone: "done",
      };
    case "sent":
    case "live":
      return {
        label: "Sent",
        detail: "This has gone out.",
        tone: "done",
      };
    default:
      return {
        label: "With you",
        detail: "Read it, leave a note, or approve it.",
        tone: "you",
      };
  }
}

export type WaitingParty = "us" | "client" | "ready";

/** Who the working list should say is holding the campaign. */
export function waitingParty(
  status: string,
  approvedChannel?: string | null
): WaitingParty {
  if (status === "approved" && approvedChannel === "internal") return "client";
  if (status === "in_review") return "client";
  if (status === "approved" || status === "scheduled") return "ready";
  return "us";
}

export function waitingPartyLabel(party: WaitingParty): string {
  if (party === "client") return "Waiting on client";
  if (party === "ready") return "Ready to send";
  return "Waiting on us";
}

/**
 * Statuses that change what the client sees on their link.
 * Other status changes stay one click.
 */
export function clientVisibleStatusNote(next: string): string | null {
  switch (next) {
    case "approved":
      return "The client will see this as Approved, and feedback on their link will close.";
    case "scheduled":
      return "The client will see this as Scheduled.";
    case "sent":
      return "The client will see this as Sent.";
    case "live":
      return "The client will see this as Sent.";
    default:
      return null;
  }
}

export type NextActionKind = "mark_revision" | "copy_client_link" | "schedule" | "none";

export function campaignNextAction(input: {
  status: string;
  approvedChannel?: string | null;
  openComments: number;
}): {
  waiting: string;
  detail: string;
  action: NextActionKind;
  actionLabel: string;
} {
  const party = waitingParty(input.status, input.approvedChannel);
  const comments =
    input.openComments > 0
      ? `${input.openComments} open comment${input.openComments === 1 ? "" : "s"}`
      : "No open comments";
  if (party === "client") {
    return {
      waiting: "Waiting on the client",
      detail: comments,
      action: "copy_client_link",
      actionLabel: "Copy client link",
    };
  }
  if (party === "ready") {
    if (input.status === "scheduled") {
      return {
        waiting: "Ready to send",
        detail: comments,
        action: "schedule",
        actionLabel: "Change send time",
      };
    }
    return {
      waiting: "Ready to send",
      detail: "The client has approved. Feedback is closed.",
      action: "schedule",
      actionLabel: "Schedule send",
    };
  }
  const revising =
    input.status === "needs_changes" ||
    input.status === "needs_revisions_internal" ||
    input.status === "draft" ||
    input.openComments > 0;
  if (revising) {
    return {
      waiting: "Waiting on us",
      detail: comments,
      action: "mark_revision",
      actionLabel: "Mark revision done",
    };
  }
  return {
    waiting: "Waiting on us",
    detail: comments,
    action: "copy_client_link",
    actionLabel: "Copy client link",
  };
}
