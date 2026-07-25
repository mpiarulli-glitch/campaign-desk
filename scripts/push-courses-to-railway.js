#!/usr/bin/env node
/**
 * Push local training courses into the live Campaign Desk app on Railway.
 *
 * Reads data/campaign-desk.db and rebuilds each course (course + lessons) on
 * the live app via the authenticated admin API (POST /api/hub/courses, which
 * upserts by slug). Requires that endpoint to be deployed live first.
 *
 * Usage:
 *   node scripts/push-courses-to-railway.js            # dry run (default)
 *   node scripts/push-courses-to-railway.js --commit    # actually push
 *   SLUG=hormozi-100m-offers node scripts/push-courses-to-railway.js --commit
 *
 * Env:
 *   CAMPAIGN_DESK_URL       (default https://campaign-desk-production.up.railway.app)
 *   CAMPAIGN_DESK_PASSWORD  (admin password)
 */

const path = require("path");
const Database = require("better-sqlite3");

const URL =
  process.env.CAMPAIGN_DESK_URL || "https://campaign-desk-production.up.railway.app";
const PASSWORD = process.env.CAMPAIGN_DESK_PASSWORD || "Marketingeg1!";
const ONLY_SLUG = process.env.SLUG || "";
const COMMIT = process.argv.includes("--commit");

let COOKIE = "";

async function api(method, pathname, body) {
  const res = await fetch(URL + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) COOKIE = setCookie.split(";")[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${text}`);
  return json;
}

async function main() {
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath, { readonly: true });
  db.pragma("journal_mode = WAL");

  let courses = db.prepare(`SELECT * FROM courses ORDER BY sort_order ASC`).all();
  if (ONLY_SLUG) courses = courses.filter((c) => c.slug === ONLY_SLUG);

  if (!courses.length) {
    console.log("No local courses to push." + (ONLY_SLUG ? ` (slug=${ONLY_SLUG})` : ""));
    return;
  }

  console.log(`Target: ${URL}`);
  console.log(`${COMMIT ? "PUSHING" : "DRY RUN"} ${courses.length} course(s)\n`);

  if (COMMIT) await api("POST", "/api/auth", { password: PASSWORD });

  for (const c of courses) {
    const lessonRows = db
      .prepare(
        `SELECT id, title, subtitle, body, duration FROM course_lessons
         WHERE course_id = ? ORDER BY sort_order ASC`
      )
      .all(c.id);
    const quizStmt = db.prepare(
      `SELECT prompt, options, correct_index, explanation FROM course_quiz_questions
       WHERE lesson_id = ? ORDER BY sort_order ASC`
    );
    let quizTotal = 0;
    const lessons = lessonRows.map((l) => {
      const quiz = quizStmt.all(l.id).map((q) => {
        let options = [];
        try {
          options = JSON.parse(q.options);
        } catch {
          options = [];
        }
        return {
          prompt: q.prompt,
          options,
          answer: q.correct_index,
          explanation: q.explanation,
        };
      });
      quizTotal += quiz.length;
      return {
        title: l.title,
        subtitle: l.subtitle,
        body: l.body,
        duration: l.duration,
        quiz,
      };
    });
    console.log(`- ${c.title} (${c.slug}) — ${lessons.length} lessons, ${quizTotal} quiz questions`);
    if (!COMMIT) continue;
    const payload = {
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      kind: c.kind,
      author: c.author,
      summary: c.summary,
      sortOrder: c.sort_order,
      lessons,
    };
    const { course } = await api("POST", "/api/hub/courses", payload);
    console.log(`  pushed → ${course.lessons.length} lessons live`);
  }

  db.close();
  console.log(COMMIT ? "\nDone." : "\nDry run only. Re-run with --commit to push.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
