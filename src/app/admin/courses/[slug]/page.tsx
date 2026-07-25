"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { QuizSection, type QuizQuestion } from "@/components/QuizSection";

type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  duration: string;
  sort_order: number;
  quiz: QuizQuestion[];
};
type Course = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  kind: string;
  author: string;
  summary: string;
  lessons: Lesson[];
};

type Progress = { answered: number; correct: number; total: number; done: boolean };

function quizKey(slug: string, lessonId: string) {
  return `quiz:${slug}:${lessonId}`;
}

export default function CoursePage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [ready, setReady] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) {
          router.push("/login");
          return;
        }
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  useEffect(() => {
    if (!ready || !slug) return;
    fetch(`/api/hub/courses/${slug}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d?.course) setCourse(d.course);
      })
      .catch(() => {});
  }, [ready, slug]);

  // Seed quiz progress from localStorage once the course (and its lessons) load,
  // so the sidebar checkmarks and the course bar reflect prior sessions.
  useEffect(() => {
    if (!course || !slug || typeof window === "undefined") return;
    const seeded: Record<string, Progress> = {};
    for (const l of course.lessons) {
      const total = l.quiz?.length || 0;
      if (!total) continue;
      try {
        const raw = window.localStorage.getItem(quizKey(slug, l.id));
        const saved = raw ? (JSON.parse(raw) as { answers?: Record<string, number> }) : null;
        const answersMap = saved?.answers || {};
        const answered = Object.keys(answersMap).length;
        const correct = l.quiz.filter((q) => answersMap[q.id] === q.correct_index).length;
        seeded[l.id] = { answered, correct, total, done: answered === total };
      } catch {
        /* ignore */
      }
    }
    setProgress(seeded);
  }, [course, slug]);

  const lessons = useMemo(() => course?.lessons || [], [course]);
  const current = lessons[active] || null;
  const kindLabel = course?.kind === "ai" ? "AI" : "Marketing";

  const quizzed = lessons.filter((l) => (l.quiz?.length || 0) > 0);
  const quizzesDone = quizzed.filter((l) => progress[l.id]?.done).length;
  const coursePct = quizzed.length ? Math.round((quizzesDone / quizzed.length) * 100) : 0;

  const handleResult = useCallback(
    (lessonId: string) => (r: Progress) => {
      setProgress((prev) => ({ ...prev, [lessonId]: r }));
    },
    []
  );

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head" style={{ alignItems: "flex-start" }}>
          <div>
            <Link className="hq-back" href="/admin/hub">‹ MEG Team Hub</Link>
            {course ? (
              <>
                <p className="ops-eyebrow">{kindLabel} training{course.author ? ` · ${course.author}` : ""}</p>
                <h1 className="ops-title" style={{ marginTop: 2 }}>{course.title}</h1>
                {course.subtitle ? <p className="course-sub">{course.subtitle}</p> : null}
              </>
            ) : (
              <h1 className="ops-title" style={{ marginTop: 2 }}>Course</h1>
            )}
          </div>
        </div>

        {!ready ? (
          <p className="muted">Loading…</p>
        ) : notFound ? (
          <div className="empty"><p>That course doesn&apos;t exist yet.</p></div>
        ) : !course ? (
          <p className="muted">Loading course…</p>
        ) : (
          <div className="course-layout">
            <aside className="course-toc">
              {course.summary ? <p className="course-summary">{course.summary}</p> : null}

              {quizzed.length ? (
                <div className="course-progress">
                  <div className="course-progress-row">
                    <span>Quiz progress</span>
                    <span>{quizzesDone}/{quizzed.length}</span>
                  </div>
                  <div className="course-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coursePct}>
                    <span style={{ width: `${coursePct}%` }} />
                  </div>
                </div>
              ) : null}

              <ol className="course-toc-list">
                {lessons.map((l, i) => {
                  const p = progress[l.id];
                  const passed = p?.done;
                  return (
                    <li key={l.id}>
                      <button
                        className={`course-toc-item ${i === active ? "is-on" : ""}`}
                        onClick={() => {
                          setActive(i);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <span className={`course-toc-num ${passed ? "is-passed" : ""}`}>
                          {passed ? "✓" : i + 1}
                        </span>
                        <span className="course-toc-body">
                          <span className="course-toc-title">{l.title}</span>
                          {l.duration ? <span className="course-toc-meta">{l.duration}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>

            <article className="course-reader">
              {current ? (
                <>
                  <div className="course-lesson-head">
                    <span className="course-lesson-kicker">
                      Lesson {active + 1} of {lessons.length}
                      {current.duration ? ` · ${current.duration}` : ""}
                    </span>
                    <h2 className="course-lesson-title">{current.title}</h2>
                    {current.subtitle ? <p className="course-lesson-sub">{current.subtitle}</p> : null}
                  </div>
                  <Markdown body={current.body} />

                  {current.quiz?.length && slug ? (
                    <QuizSection
                      key={current.id}
                      questions={current.quiz}
                      storageKey={quizKey(slug, current.id)}
                      onResult={handleResult(current.id)}
                    />
                  ) : null}

                  <div className="course-nav">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={active === 0}
                      onClick={() => {
                        setActive((a) => Math.max(0, a - 1));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      ‹ Previous
                    </button>
                    <span className="muted" style={{ fontSize: 13 }}>{active + 1} / {lessons.length}</span>
                    <button
                      className="btn btn-sm"
                      disabled={active >= lessons.length - 1}
                      onClick={() => {
                        setActive((a) => Math.min(lessons.length - 1, a + 1));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Next ›
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty"><p>No lessons in this course yet.</p></div>
              )}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
