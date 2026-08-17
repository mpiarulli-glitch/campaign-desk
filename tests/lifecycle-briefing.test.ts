import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthBriefing,
  type BriefingCard,
} from "../src/lib/lifecycle-briefing";

function card(partial: Partial<BriefingCard> & Pick<BriefingCard, "clientName" | "columnKey">): BriefingCard {
  return {
    clientId: partial.clientId || partial.clientName.toLowerCase().replace(/\s+/g, "-"),
    quota: 4,
    delivered: 0,
    campaigns: [],
    ...partial,
  };
}

test("my queue is worst-first, not alphabetical", () => {
  const briefing = buildMonthBriefing([
    card({ clientName: "Able Co", columnKey: "next_up" }),
    card({ clientName: "Zebra Co", columnKey: "needs_revisions", delivered: 2 }),
    card({ clientName: "Mid Co", columnKey: "scheduling", delivered: 3 }),
    card({ clientName: "QA Co", columnKey: "qa", delivered: 1 }),
  ]);
  assert.deepEqual(
    briefing.myQueue.map((i) => i.clientName),
    ["Zebra Co", "Mid Co", "QA Co", "Able Co"]
  );
  assert.equal(briefing.myQueue[0].why, "Client sent notes");
});

test("waiting on the client is separate from the do-now queue", () => {
  const briefing = buildMonthBriefing([
    card({ clientName: "Hold Co", columnKey: "sent_for_approval", delivered: 2 }),
    card({ clientName: "Nudge Co", columnKey: "follow_up_sent", delivered: 1 }),
    card({ clientName: "Work Co", columnKey: "qa", delivered: 1 }),
  ]);
  assert.deepEqual(
    briefing.waitingOnClient.map((i) => i.clientName),
    ["Hold Co", "Nudge Co"]
  );
  assert.deepEqual(
    briefing.myQueue.map((i) => i.clientName),
    ["Work Co"]
  );
});

test("behind quota skips clients who already met it", () => {
  const briefing = buildMonthBriefing([
    card({ clientName: "Short", columnKey: "next_up", quota: 8, delivered: 2 }),
    card({ clientName: "Done", columnKey: "deliverables_met", quota: 4, delivered: 4 }),
    card({ clientName: "Also done", columnKey: "completed", quota: 4, delivered: 4 }),
    card({ clientName: "No quota", columnKey: "triage", quota: 0, delivered: 0 }),
  ]);
  assert.deepEqual(
    briefing.behindQuota.map((i) => i.clientName),
    ["Short"]
  );
  assert.equal(briefing.behindQuota[0].remaining, 6);
  assert.equal(briefing.met, 2);
  assert.equal(briefing.notStarted, 0);
});

test("triage with a quota counts as not started", () => {
  const briefing = buildMonthBriefing([
    card({ clientName: "Parked", columnKey: "triage", quota: 4, delivered: 0 }),
    card({ clientName: "Idle", columnKey: "triage", quota: 0, delivered: 0 }),
    card({ clientName: "Moving", columnKey: "qa", quota: 4, delivered: 1 }),
  ]);
  assert.equal(briefing.notStarted, 1);
  assert.equal(briefing.inPipeline, 1);
});
