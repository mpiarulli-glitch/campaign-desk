import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignNextAction,
  chosenSubjectLine,
  clientReviewCopy,
  clientVisibleStatusNote,
  finalApproveGate,
  isFullName,
  subjectIsChosen,
  waitingParty,
  waitingPartyLabel,
} from "../src/lib/review-flow";

const one = (title = "Winback") => ({
  id: "a",
  title,
  subjects: [{ id: "s1", subject: "Your next visit" }],
  chosenSubjectId: null,
});

test("a first and last name is required, a single word is not", () => {
  assert.equal(isFullName("Alex"), false);
  assert.equal(isFullName("Alex Rivera"), true);
  assert.equal(isFullName("  Alex   Rivera  "), true);
});

test("a single subject is already chosen; two subjects need a pick", () => {
  assert.equal(subjectIsChosen(one()), true);
  assert.equal(
    subjectIsChosen({
      id: "a",
      title: "Winback",
      subjects: [
        { id: "s1", subject: "One" },
        { id: "s2", subject: "Two" },
      ],
      chosenSubjectId: null,
    }),
    false
  );
  assert.equal(
    chosenSubjectLine({
      id: "a",
      title: "Winback",
      subjects: [
        { id: "s1", subject: "One" },
        { id: "s2", subject: "Two" },
      ],
      chosenSubjectId: "s2",
    }),
    "Two"
  );
});

test("one email approves in one step once the name is complete", () => {
  const blocked = finalApproveGate({
    items: [one()],
    openedIds: [],
    approverName: "Alex",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(blocked.reason, /first and last name/);
  }
  const ready = finalApproveGate({
    items: [one()],
    openedIds: [],
    approverName: "Alex Rivera",
  });
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.deepEqual(ready.subjects, [{ title: "Winback", subject: "Your next visit" }]);
  }
});

test("a package cannot be approved until every item has been opened", () => {
  const items = [
    one("First"),
    { ...one("Second"), id: "b" },
  ];
  const blocked = finalApproveGate({
    items,
    openedIds: ["a"],
    approverName: "Alex Rivera",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /1 of 2 opened/);
  const ready = finalApproveGate({
    items,
    openedIds: ["a", "b"],
    approverName: "Alex Rivera",
  });
  assert.equal(ready.ok, true);
});

test("more than one subject line blocks final approval until one is picked", () => {
  const item = {
    id: "a",
    title: "Winback",
    subjects: [
      { id: "s1", subject: "One" },
      { id: "s2", subject: "Two" },
    ],
    chosenSubjectId: null as string | null,
  };
  const blocked = finalApproveGate({
    items: [item],
    openedIds: ["a"],
    approverName: "Alex Rivera",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /Pick a subject line for Winback/);
  const ready = finalApproveGate({
    items: [{ ...item, chosenSubjectId: "s1" }],
    openedIds: ["a"],
    approverName: "Alex Rivera",
  });
  assert.equal(ready.ok, true);
});

test("client review copy never uses staff wording", () => {
  for (const status of [
    "draft",
    "internal_review",
    "needs_revisions_internal",
    "revisions_made",
    "in_review",
    "needs_changes",
    "approved",
    "scheduled",
    "sent",
    "live",
  ]) {
    const copy = clientReviewCopy(status, status === "in_review");
    assert.doesNotMatch(copy.label + copy.detail, /internal|Michael/i);
  }
  assert.equal(clientReviewCopy("needs_revisions_internal").label, "We're revising");
  assert.equal(clientReviewCopy("in_review").label, "With you");
  assert.equal(clientReviewCopy("approved").label, "Approved");
  assert.equal(clientReviewCopy("in_review", true).label, "With you");
});

test("the list says who is holding the campaign without changing order rules", () => {
  assert.equal(waitingParty("in_review"), "client");
  assert.equal(waitingParty("approved", "internal"), "client");
  assert.equal(waitingParty("needs_changes"), "us");
  assert.equal(waitingParty("approved", "client"), "ready");
  assert.equal(waitingPartyLabel("us"), "Waiting on us");
  assert.equal(waitingPartyLabel("client"), "Waiting on client");
});

test("only the statuses a client can see ask for confirmation", () => {
  assert.match(clientVisibleStatusNote("approved") || "", /Approved/);
  assert.match(clientVisibleStatusNote("scheduled") || "", /Scheduled/);
  assert.match(clientVisibleStatusNote("sent") || "", /Sent/);
  assert.match(clientVisibleStatusNote("live") || "", /Sent/);
  assert.equal(clientVisibleStatusNote("draft"), null);
  assert.equal(clientVisibleStatusNote("needs_changes"), null);
  assert.equal(clientVisibleStatusNote("in_review"), null);
});

test("the campaign header names one next action", () => {
  const revising = campaignNextAction({
    status: "needs_changes",
    openComments: 2,
  });
  assert.equal(revising.waiting, "Waiting on us");
  assert.equal(revising.action, "mark_revision");
  assert.match(revising.detail, /2 open comments/);

  const client = campaignNextAction({
    status: "in_review",
    openComments: 0,
  });
  assert.equal(client.waiting, "Waiting on the client");
  assert.equal(client.action, "copy_client_link");

  const ready = campaignNextAction({
    status: "approved",
    approvedChannel: "client",
    openComments: 0,
  });
  assert.equal(ready.action, "schedule");
  assert.equal(ready.actionLabel, "Schedule send");
});
