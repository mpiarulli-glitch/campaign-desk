import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("a course loads every lesson quiz in one pass", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-course-read-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const { getCourse } = await import("../src/lib/courses");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  db.prepare(
    `INSERT INTO courses (id, slug, title, subtitle, kind, author, summary, sort_order, created_at, updated_at)
     VALUES ('c1', 'offers', 'Offers', '', 'marketing', 'Alex', 'Summary', 0, '2026-01-01', '2026-01-01')`
  ).run();
  const lesson = db.prepare(
    `INSERT INTO course_lessons (id, course_id, title, subtitle, body, duration, sort_order, created_at, updated_at)
     VALUES (?, 'c1', ?, '', ?, '8 min', ?, '2026-01-01', '2026-01-01')`
  );
  const quiz = db.prepare(
    `INSERT INTO course_quiz_questions (id, lesson_id, prompt, options, correct_index, explanation, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, '2026-01-01')`
  );
  lesson.run("l-second", "Second", "body-2", 1);
  lesson.run("l-first", "First", "body-1", 0);
  lesson.run("l-empty", "No quiz", "body-0", 2);
  // Out of insert order, and an older row with a higher sort, so the read has to sort.
  quiz.run("q-b", "l-first", "Later prompt", '["a","b"]', 1, 1, "2026-01-02");
  quiz.run("q-a", "l-first", "Earlier prompt", '["c","d"]', 0, 0, "2026-01-03");
  quiz.run("q-c", "l-second", "Only prompt", '["e"]', 0, 0, "2026-01-01");

  const course = getCourse("offers");
  assert.ok(course);
  assert.deepEqual(
    course.lessons.map((lesson) => lesson.title),
    ["First", "Second", "No quiz"]
  );
  assert.deepEqual(
    course.lessons[0].quiz.map((question) => question.prompt),
    ["Earlier prompt", "Later prompt"]
  );
  assert.deepEqual(course.lessons[0].quiz[0].options, ["c", "d"]);
  assert.equal(course.lessons[1].quiz.length, 1);
  assert.deepEqual(course.lessons[2].quiz, []);
  assert.equal(getCourse("missing"), null);

  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT * FROM forecast_tasks WHERE person = ? AND timer_started_at != '' ORDER BY timer_started_at ASC`
    )
    .all("michael") as Array<{ detail: string }>;
  assert.ok(
    plan.some((row) => row.detail.includes("idx_forecast_running")),
    JSON.stringify(plan)
  );
});
