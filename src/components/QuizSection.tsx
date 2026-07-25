"use client";

import { useEffect, useMemo, useState } from "react";

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

type Saved = { answers: Record<string, number>; done: boolean };

function load(key: string): Saved | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: Saved) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function QuizSection({
  questions,
  storageKey,
  onResult,
}: {
  questions: QuizQuestion[];
  storageKey: string;
  onResult?: (r: { answered: number; correct: number; total: number; done: boolean }) => void;
}) {
  // answers maps question id -> chosen option index (once chosen, it's locked)
  const [answers, setAnswers] = useState<Record<string, number>>({});

  // Rehydrate from localStorage when the lesson (storageKey) changes.
  useEffect(() => {
    const saved = load(storageKey);
    setAnswers(saved?.answers || {});
  }, [storageKey]);

  const total = questions.length;
  const answeredIds = useMemo(
    () => questions.filter((q) => answers[q.id] !== undefined).map((q) => q.id),
    [questions, answers]
  );
  const answered = answeredIds.length;
  const correct = useMemo(
    () => questions.filter((q) => answers[q.id] === q.correct_index).length,
    [questions, answers]
  );
  const done = answered === total && total > 0;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  // Report progress up to the page (for the course-level bar + TOC checkmarks).
  useEffect(() => {
    onResult?.({ answered, correct, total, done });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, correct, total, done, storageKey]);

  function choose(qId: string, optionIndex: number) {
    if (answers[qId] !== undefined) return; // locked once answered
    const next = { ...answers, [qId]: optionIndex };
    setAnswers(next);
    save(storageKey, { answers: next, done: Object.keys(next).length === total });
  }
  function reset() {
    setAnswers({});
    save(storageKey, { answers: {}, done: false });
  }

  if (!total) return null;

  return (
    <section className="quiz" aria-label="Lesson quiz">
      <div className="quiz-head">
        <div className="quiz-head-row">
          <span className="quiz-kicker">Quick quiz</span>
          <span className="quiz-count">
            {done ? `Score ${correct}/${total}` : `${answered} of ${total} answered`}
          </span>
        </div>
        <div className="quiz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className={`quiz-progress-fill ${done ? "is-done" : ""}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ol className="quiz-list">
        {questions.map((q, qi) => {
          const chosen = answers[q.id];
          const isAnswered = chosen !== undefined;
          return (
            <li key={q.id} className="quiz-q">
              <p className="quiz-prompt">
                <span className="quiz-q-num">{qi + 1}</span>
                {q.prompt}
              </p>
              <div className="quiz-options">
                {q.options.map((opt, oi) => {
                  const isChosen = chosen === oi;
                  const isCorrect = oi === q.correct_index;
                  let state = "";
                  if (isAnswered) {
                    if (isCorrect) state = "is-correct";
                    else if (isChosen) state = "is-wrong";
                    else state = "is-dim";
                  }
                  return (
                    <button
                      key={oi}
                      className={`quiz-option ${state}`}
                      disabled={isAnswered}
                      onClick={() => choose(q.id, oi)}
                    >
                      <span className="quiz-option-mark" aria-hidden="true">
                        {isAnswered && isCorrect ? "✓" : isAnswered && isChosen ? "✕" : String.fromCharCode(65 + oi)}
                      </span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
              {isAnswered && q.explanation ? (
                <p className={`quiz-explain ${chosen === q.correct_index ? "ok" : "no"}`}>{q.explanation}</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {done ? (
        <div className="quiz-foot">
          <span className="quiz-result">
            {correct === total
              ? "Perfect. You've got this section down."
              : correct >= Math.ceil(total * 0.7)
              ? "Nice work. Worth a quick review of the misses."
              : "Give the lesson another read, then retake it."}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Retake</button>
        </div>
      ) : null}
    </section>
  );
}
