import assert from "node:assert/strict";
import test from "node:test";
import { judgeThread } from "../src/lib/basecamp-messages";
import type { BcMessageThread } from "../src/lib/basecamp";

const DAY = 86_400_000;
// Anchored once. Calling Date.now() per invocation made at(1) drift by a
// millisecond between building a thread and asserting on it, so the comparison
// failed roughly whenever the clock ticked mid-test.
const NOW = Date.now();
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

function thread(
  authorIsClient: boolean,
  createdAgo: number,
  replies: Array<[boolean, number]> = []
): BcMessageThread {
  return {
    id: 1,
    title: "Thread",
    url: "https://3.basecamp.com/x/y",
    createdAt: at(createdAgo),
    authorName: authorIsClient ? "Client Person" : "MEG Person",
    authorIsClient,
    replies: replies.map(([isClient, ago]) => ({
      createdAt: at(ago),
      authorName: isClient ? "Client Person" : "MEG Person",
      authorIsClient: isClient,
    })),
  };
}

test("a client post with no replies is waiting on us", () => {
  const v = judgeThread(thread(true, 5));
  assert.equal(v.clientInvolved, true);
  assert.equal(v.awaitingReply, true);
  assert.equal(v.lastTeamAt, "");
});

test("a client post we answered is settled", () => {
  const v = judgeThread(thread(true, 5, [[false, 4]]));
  assert.equal(v.awaitingReply, false);
});

test("a client replying after our answer re-opens the thread", () => {
  // They came back. They are waiting on us again, and this is the case a
  // simple "has any reply" check would miss.
  const v = judgeThread(thread(true, 10, [[false, 8], [true, 2]]));
  assert.equal(v.awaitingReply, true);
});

test("our own thread with no client on it is not reported", () => {
  const v = judgeThread(thread(false, 5, [[false, 3]]));
  assert.equal(v.clientInvolved, false);
  assert.equal(v.awaitingReply, false);
});

test("a client commenting on our thread still counts as waiting", () => {
  // We posted, the client asked something, nobody answered.
  const v = judgeThread(thread(false, 9, [[true, 3]]));
  assert.equal(v.clientInvolved, true);
  assert.equal(v.awaitingReply, true);
});

test("the verdict uses the newest post on each side, not the ordering given", () => {
  // Replies deliberately out of order: the judgement must not depend on it.
  const v = judgeThread(thread(true, 20, [[true, 1], [false, 15], [true, 9]]));
  assert.equal(v.awaitingReply, true);
  assert.equal(v.lastClientAt, at(1));
  assert.equal(v.lastTeamAt, at(15));
});

test("a thread answered after several client posts is settled", () => {
  const v = judgeThread(thread(true, 20, [[true, 12], [false, 2]]));
  assert.equal(v.awaitingReply, false);
  assert.equal(v.lastTeamAt, at(2));
});

test("a long thread is judged on its newest comment, not its first page", () => {
  // The regression: comments come back oldest-first, and the sweep used to read
  // only two pages (30 comments). On a busier thread that meant never seeing our
  // reply, so an answered thread was reported as waiting on us.
  const replies: Array<[boolean, number]> = [];
  for (let i = 40; i > 1; i--) replies.push([true, i]); // 39 client comments
  replies.push([false, 1]); // our answer, newest and on the fourth page
  const v = judgeThread(thread(true, 41, replies));
  assert.equal(v.awaitingReply, false, "the newest post is ours, so nothing is waiting");
  assert.equal(v.lastTeamAt, at(1));
});

test("posts with no timestamp are ignored rather than crashing the sweep", () => {
  const t = thread(true, 5);
  t.replies = [{ createdAt: "", authorName: "MEG Person", authorIsClient: false }];
  const v = judgeThread(t);
  // The blank team reply must not count as an answer.
  assert.equal(v.awaitingReply, true);
  assert.equal(v.lastTeamAt, "");
});
