import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type Course,
  type CourseLesson,
  type CourseQuizQuestion,
} from "./db";

export type { Course, CourseLesson };

// Quiz question with options already parsed from the stored JSON.
export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
};
export type LessonWithQuiz = CourseLesson & { quiz: QuizQuestion[] };
export type CourseWithLessons = Course & { lessons: LessonWithQuiz[] };

// Input shape for authoring/seeding a quiz question.
export type QuizQuestionInput = {
  prompt: string;
  options: string[];
  answer: number; // index of the correct option
  explanation?: string;
};

export function listCourses(): Array<Course & { lesson_count: number }> {
  const db = getDb();
  const courses = db
    .prepare(`SELECT * FROM courses ORDER BY sort_order ASC, created_at ASC`)
    .all() as Course[];
  const counts = db
    .prepare(`SELECT course_id, COUNT(*) AS n FROM course_lessons GROUP BY course_id`)
    .all() as Array<{ course_id: string; n: number }>;
  const byId = new Map(counts.map((c) => [c.course_id, c.n]));
  return courses.map((c) => ({ ...c, lesson_count: byId.get(c.id) || 0 }));
}

function parseQuiz(rows: CourseQuizQuestion[]): QuizQuestion[] {
  return rows.map((q) => {
    let options: string[] = [];
    try {
      const parsed = JSON.parse(q.options);
      if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
    } catch {
      options = [];
    }
    return {
      id: q.id,
      prompt: q.prompt,
      options,
      correct_index: q.correct_index,
      explanation: q.explanation,
    };
  });
}

export function getCourse(slug: string): CourseWithLessons | null {
  const db = getDb();
  const course = db.prepare(`SELECT * FROM courses WHERE slug = ?`).get(slug) as
    | Course
    | undefined;
  if (!course) return null;
  const lessons = db
    .prepare(
      `SELECT * FROM course_lessons WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC`
    )
    .all(course.id) as CourseLesson[];
  const quizStmt = db.prepare(
    `SELECT * FROM course_quiz_questions WHERE lesson_id = ? ORDER BY sort_order ASC, created_at ASC`
  );
  const withQuiz: LessonWithQuiz[] = lessons.map((l) => ({
    ...l,
    quiz: parseQuiz(quizStmt.all(l.id) as CourseQuizQuestion[]),
  }));
  return { ...course, lessons: withQuiz };
}

export function createCourse(input: {
  slug: string;
  title: string;
  subtitle?: string;
  kind?: string;
  author?: string;
  summary?: string;
  sortOrder?: number;
}): Course {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const kind = input.kind === "ai" ? "ai" : "marketing";
  db.prepare(
    `INSERT INTO courses (id, slug, title, subtitle, kind, author, summary, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.slug.trim(),
    input.title.trim(),
    (input.subtitle || "").trim(),
    kind,
    (input.author || "").trim(),
    (input.summary || "").trim(),
    input.sortOrder ?? 0,
    ts,
    ts
  );
  return db.prepare(`SELECT * FROM courses WHERE id = ?`).get(id) as Course;
}

export function addLesson(input: {
  courseId: string;
  title: string;
  subtitle?: string;
  body?: string;
  duration?: string;
  sortOrder: number;
  quiz?: QuizQuestionInput[];
}): CourseLesson {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO course_lessons (id, course_id, title, subtitle, body, duration, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.courseId,
    input.title.trim(),
    (input.subtitle || "").trim(),
    (input.body || "").trim(),
    (input.duration || "").trim(),
    input.sortOrder,
    ts,
    ts
  );
  if (input.quiz && input.quiz.length) {
    const insQ = db.prepare(
      `INSERT INTO course_quiz_questions (id, lesson_id, prompt, options, correct_index, explanation, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    input.quiz.forEach((q, i) => {
      const opts = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
      const answer = Number.isInteger(q.answer) ? q.answer : 0;
      insQ.run(
        nanoid(12),
        id,
        String(q.prompt || "").trim(),
        JSON.stringify(opts),
        Math.max(0, Math.min(opts.length - 1, answer)),
        String(q.explanation || "").trim(),
        i,
        ts,
        ts
      );
    });
  }
  return db.prepare(`SELECT * FROM course_lessons WHERE id = ?`).get(id) as CourseLesson;
}

// Wipes a course and its lessons by slug so a seed can be re-run cleanly.
export function deleteCourseBySlug(slug: string): boolean {
  return getDb().prepare(`DELETE FROM courses WHERE slug = ?`).run(slug).changes > 0;
}

// Rebuilds a whole course (course row + its lessons + per-lesson quizzes) from
// a single payload, keyed by slug. Used to seed/refresh a course over the admin
// API so content can be pushed to the live app without shell access to its DB.
export function upsertCourseWithLessons(input: {
  slug: string;
  title: string;
  subtitle?: string;
  kind?: string;
  author?: string;
  summary?: string;
  sortOrder?: number;
  lessons: Array<{
    title: string;
    subtitle?: string;
    body?: string;
    duration?: string;
    quiz?: QuizQuestionInput[];
  }>;
}): CourseWithLessons {
  const db = getDb();
  const tx = db.transaction(() => {
    deleteCourseBySlug(input.slug);
    const course = createCourse(input);
    input.lessons.forEach((l, i) =>
      addLesson({
        courseId: course.id,
        title: l.title,
        subtitle: l.subtitle,
        body: l.body,
        duration: l.duration,
        sortOrder: i,
        quiz: l.quiz,
      })
    );
  });
  tx();
  return getCourse(input.slug)!;
}
