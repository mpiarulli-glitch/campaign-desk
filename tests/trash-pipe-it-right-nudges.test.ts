import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TRASH_PIPE_IT_RIGHT_NUDGES_KEY,
  TRASH_PIPE_IT_RIGHT_NUDGES_LOG,
  appSettingsNudgeMarker,
  commentFromPayload,
  nudgeSkipReason,
  runTrashPipeItRightNudgesOnce,
  safeLogText,
  type NudgeComment,
  type NudgeCommentGateway,
  type NudgeMarker,
  type NudgeServiceIdentity,
} from "../src/lib/trash-pipe-it-right-nudges";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "40889279";
const CARD = "10468738514";
const IDS = ["10525259116", "10534176064"] as const;
const TOKEN = "U5sbj--ZQQyes2wYKSNGyAl2";
const SERVICE: NudgeServiceIdentity = { id: 424242, name: "King Kashflow" };

const FINISHED = `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} finished ${IDS[0]}=trashed ${IDS[1]}=trashed`;

function nudge(id: string, overrides: Partial<NudgeComment> = {}): NudgeComment {
  return {
    id,
    type: "Comment",
    creatorId: SERVICE.id,
    creatorName: "King Kashflow",
    parentId: CARD,
    bucketId: BUCKET,
    content:
      `<div><bc-attachment sgid="BAh7${TOKEN}"></bc-attachment> ` +
      `Just a friendly nudge on this one. Your production window opens in 5 days.</div>`,
    ...overrides,
  };
}

function memoryMarker(): NudgeMarker & { value: string | null } {
  const state: { value: string | null } = { value: null };
  return {
    get value() {
      return state.value;
    },
    claim() {
      if (state.value !== null) return false;
      state.value = "running";
      return true;
    },
    finish(summary: string) {
      state.value = summary;
    },
  };
}

function fakeGateway(comments: Record<string, NudgeComment | { error: string }>): {
  gateway: NudgeCommentGateway;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      serviceIdentity: () => SERVICE,
      async getComment(bucketId, commentId) {
        calls.push(`get ${bucketId} ${commentId}`);
        const found = comments[commentId];
        if (!found) return { ok: false, error: "comment 404" };
        if ("error" in found) return { ok: false, error: found.error };
        return { ok: true, comment: found };
      },
      async trash(bucketId, commentId) {
        calls.push(`trash ${bucketId} ${commentId}`);
        return { ok: true };
      },
    },
  };
}

describe("trash pipe it right nudge comments", { concurrency: false }, () => {
  test("the boot task is deferred in both instrumentation entries", () => {
    const root = fs.readFileSync(path.join(repoRoot, "instrumentation.ts"), "utf8");
    const src = fs.readFileSync(path.join(repoRoot, "src/instrumentation.ts"), "utf8");
    assert.match(root, /enqueueDeferredStartupJob\(\s*"trash-pipe-it-right-nudges"/);
    assert.match(src, /enqueueDeferredStartupJob\(\s*"trash-pipe-it-right-nudges"/);
    assert.match(root, /import\(\s*"\.\/src\/lib\/trash-pipe-it-right-nudges"\s*\)/);
    assert.match(src, /import\(\s*"\.\/lib\/trash-pipe-it-right-nudges"\s*\)/);
    assert.equal(root.includes('from "./src/lib/trash-pipe-it-right-nudges"'), false);
    assert.equal(src.includes('from "./lib/trash-pipe-it-right-nudges"'), false);
    assert.ok(root.indexOf("ready to listen") > root.indexOf("trash-pipe-it-right-nudges"));
    assert.ok(src.indexOf("ready to listen") > src.indexOf("trash-pipe-it-right-nudges"));
    const task = fs.readFileSync(
      path.join(repoRoot, "src/lib/trash-pipe-it-right-nudges.ts"),
      "utf8"
    );
    assert.match(task, /trashRecording/);
    assert.match(task, /getCommentJson/);
  });

  test("parses a Basecamp comment without keeping the creator email", () => {
    const parsed = commentFromPayload({
      id: 10525259116,
      type: "Comment",
      content: `<div>Just a friendly nudge ${TOKEN}</div>`,
      parent: { id: 10468738514, type: "Kanban::Card" },
      bucket: { id: 40889279, name: "Pipe It Right" },
      creator: {
        id: 424242,
        name: "King Kashflow",
        email_address: "bot@marketingempiregroup.com",
      },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.comment, nudge(IDS[0], { content: `<div>Just a friendly nudge ${TOKEN}</div>` }));
    assert.equal(JSON.stringify(parsed.comment).includes("bot@"), false);
    assert.equal(nudgeSkipReason(parsed.comment, IDS[0], SERVICE), null);
  });

  test("verifies both comments before trashing and runs only once", async () => {
    const { gateway, calls } = fakeGateway({
      [IDS[0]]: nudge(IDS[0]),
      [IDS[1]]: nudge(IDS[1], {
        content: `<div>Just a friendly nudge. Opens in 3 days. ${TOKEN}</div>`,
      }),
    });
    const marker = memoryMarker();
    const logs: string[] = [];
    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));

    assert.deepEqual(calls, [
      `get ${BUCKET} ${IDS[0]}`,
      `trash ${BUCKET} ${IDS[0]}`,
      `get ${BUCKET} ${IDS[1]}`,
      `trash ${BUCKET} ${IDS[1]}`,
    ]);
    assert.deepEqual(logs, [
      `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${IDS[0]} trashed`,
      `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${IDS[1]} trashed`,
      FINISHED,
    ]);
    assert.equal(marker.value, `${IDS[0]}=trashed ${IDS[1]}=trashed`);

    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));
    assert.equal(calls.length, 4);
    assert.deepEqual(logs.at(-1), FINISHED);
  });

  test("skips a comment that is not this service nudge and still checks the other", async () => {
    const cases: Array<{ comment: NudgeComment | { error: string }; reason: string }> = [
      {
        comment: nudge(IDS[0], { creatorId: 77, creatorName: "Michael" }),
        reason: "author 77 (Michael) is not the service account 424242",
      },
      {
        comment: nudge(IDS[0], { creatorName: "Michael" }),
        reason: "author name is not King Kashflow",
      },
      {
        comment: nudge(IDS[0], { parentId: "999" }),
        reason: `parent is 999, expected card ${CARD}`,
      },
      {
        comment: nudge(IDS[0], { bucketId: "1" }),
        reason: "bucket is 1, expected 40889279",
      },
      {
        comment: nudge(IDS[0], { type: "Kanban::Card" }),
        reason: "recording type is Kanban::Card, expected Comment",
      },
      {
        comment: nudge(IDS[0], { content: `<div>Just a friendly nudge.</div>` }),
        reason: "content does not match this nudge",
      },
      {
        comment: nudge(IDS[0], { content: `<div>${TOKEN}</div>` }),
        reason: "content does not match this nudge",
      },
      {
        comment: { error: "comment 404" },
        reason: "comment 404",
      },
    ];

    for (const item of cases) {
      const { gateway, calls } = fakeGateway({
        [IDS[0]]: item.comment,
        [IDS[1]]: nudge(IDS[1]),
      });
      const logs: string[] = [];
      await runTrashPipeItRightNudgesOnce(gateway, memoryMarker(), (line) => logs.push(line));
      assert.deepEqual(calls, [`get ${BUCKET} ${IDS[0]}`, `get ${BUCKET} ${IDS[1]}`, `trash ${BUCKET} ${IDS[1]}`]);
      assert.equal(logs[0], `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${IDS[0]} skipped: ${item.reason}`);
      assert.equal(logs[1], `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${IDS[1]} trashed`);
      assert.equal(
        logs[2],
        `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} finished ${IDS[0]}=skipped ${IDS[1]}=trashed`
      );
    }
  });

  test("a failed trash is logged and the marker still blocks a second run", async () => {
    const calls: string[] = [];
    const gateway: NudgeCommentGateway = {
      serviceIdentity: () => SERVICE,
      async getComment(bucketId, commentId) {
        calls.push(`get ${bucketId} ${commentId}`);
        return { ok: true, comment: nudge(commentId) };
      },
      async trash(bucketId, commentId) {
        calls.push(`trash ${bucketId} ${commentId}`);
        if (commentId === IDS[0]) return { ok: false, error: "trash 403 Bearer should-not-leak" };
        return { ok: true };
      },
    };
    const marker = memoryMarker();
    const logs: string[] = [];
    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));
    assert.match(logs[0], /10525259116 failed: trash 403 Bearer \[redacted\]/);
    assert.equal(logs[0].includes("should-not-leak"), false);
    assert.equal(logs[2], `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} finished ${IDS[0]}=failed ${IDS[1]}=trashed`);
    assert.equal(marker.value, `${IDS[0]}=failed ${IDS[1]}=trashed`);

    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));
    assert.deepEqual(calls, [
      `get ${BUCKET} ${IDS[0]}`,
      `trash ${BUCKET} ${IDS[0]}`,
      `get ${BUCKET} ${IDS[1]}`,
      `trash ${BUCKET} ${IDS[1]}`,
    ]);
  });

  test("missing service identity skips both comments after they are loaded", async () => {
    const { gateway, calls } = fakeGateway({
      [IDS[0]]: nudge(IDS[0]),
      [IDS[1]]: nudge(IDS[1]),
    });
    gateway.serviceIdentity = () => null;
    const logs: string[] = [];
    await runTrashPipeItRightNudgesOnce(gateway, memoryMarker(), (line) => logs.push(line));
    assert.deepEqual(calls, [`get ${BUCKET} ${IDS[0]}`, `get ${BUCKET} ${IDS[1]}`]);
    assert.match(logs[0], /service person id is not recorded/);
    assert.match(logs[1], /service person id is not recorded/);
    assert.match(logs[2], /skipped 10534176064=skipped/);
  });

  test("the app_settings marker is claimed once", async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-nudge-"));
    const originalCwd = process.cwd();
    process.chdir(tmp);
    const { closeDbForTests, getDb } = await import("../src/lib/db");
    t.after(() => {
      closeDbForTests();
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const marker = appSettingsNudgeMarker();
    const { gateway, calls } = fakeGateway({
      [IDS[0]]: nudge(IDS[0]),
      [IDS[1]]: nudge(IDS[1]),
    });
    const logs: string[] = [];
    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));
    assert.equal(logs.at(-1), FINISHED);

    const row = getDb()
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(TRASH_PIPE_IT_RIGHT_NUDGES_KEY) as { value: string };
    assert.equal(row.value, `${IDS[0]}=trashed ${IDS[1]}=trashed`);

    await runTrashPipeItRightNudgesOnce(gateway, marker, (line) => logs.push(line));
    assert.equal(calls.length, 4);
    assert.equal(logs.length, 3);
  });

  test("log text drops bearer tokens and query secrets", () => {
    const line = safeLogText(
      "nope Bearer abc.def access_token=secret&refresh_token=other client_secret=nope"
    );
    assert.equal(line.includes("abc.def"), false);
    assert.equal(line.includes("access_token=secret"), false);
    assert.equal(line.includes("refresh_token=other"), false);
    assert.equal(line.includes("client_secret=nope"), false);
    assert.match(line, /Bearer \[redacted\]/);
    assert.match(line, /access_token=\[redacted\]/);
    assert.match(line, /refresh_token=\[redacted\]/);
    assert.match(line, /client_secret=\[redacted\]/);
  });
});
