"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Post = { id: string; title: string; kind: string; body: string; link: string; created_at: string };
type Course = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  kind: string;
  author: string;
  lesson_count: number;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TrainingSection({ isAdmin }: { isAdmin: boolean }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "marketing" | "ai">("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", kind: "marketing", body: "", link: "" });

  async function load() {
    const [pRes, cRes] = await Promise.all([
      fetch("/api/hub/training"),
      fetch("/api/hub/courses"),
    ]);
    if (pRes.ok) setPosts((await pRes.json()).posts || []);
    if (cRes.ok) setCourses((await cRes.json()).courses || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.title.trim()) return;
    await fetch("/api/hub/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setDraft({ title: "", kind: "marketing", body: "", link: "" });
    setAdding(false);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this training post?")) return;
    await fetch(`/api/hub/training/${id}`, { method: "DELETE" });
    load();
  }

  const visible = posts.filter((p) => filter === "all" || p.kind === filter);

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="view-toggle">
          <button className={`view-toggle-btn ${filter === "all" ? "is-on" : ""}`} onClick={() => setFilter("all")}>All</button>
          <button className={`view-toggle-btn ${filter === "marketing" ? "is-on" : ""}`} onClick={() => setFilter("marketing")}>Marketing</button>
          <button className={`view-toggle-btn ${filter === "ai" ? "is-on" : ""}`} onClick={() => setFilter("ai")}>AI</button>
        </div>
        {isAdmin ? (
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ New training"}</button>
        ) : null}
      </div>

      {(() => {
        const visibleCourses = courses.filter((c) => filter === "all" || c.kind === filter);
        if (!visibleCourses.length) return null;
        return (
          <div className="stack" style={{ gap: 10 }}>
            <p className="course-section-label">Courses</p>
            <div className="course-grid">
              {visibleCourses.map((c) => (
                <Link key={c.id} href={`/admin/courses/${c.slug}`} className="course-card">
                  <span className={`hub-kind hub-kind-${c.kind === "ai" ? "ai" : "marketing"}`}>
                    {c.kind === "ai" ? "AI" : "Marketing"}
                  </span>
                  <span className="course-card-title">{c.title}</span>
                  {c.subtitle ? <span className="course-card-sub">{c.subtitle}</span> : null}
                  <span className="course-card-meta">
                    {c.lesson_count} lesson{c.lesson_count === 1 ? "" : "s"}
                    {c.author ? ` · ${c.author}` : ""}
                  </span>
                  <span className="course-card-go">Start course →</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {adding ? (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            <option value="marketing">Marketing</option>
            <option value="ai">AI</option>
          </select>
          <textarea rows={4} placeholder="Today's lesson, tip, or prompt…" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <input placeholder="Optional link (Loom, article, prompt doc…)" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={add} disabled={!draft.title.trim()}>Post</button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty"><p>Nothing posted yet.</p></div>
      ) : (
        visible.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <span className={`hub-kind hub-kind-${p.kind}`}>{p.kind === "ai" ? "AI" : "Marketing"}</span>
                <p style={{ margin: "6px 0 2px", fontWeight: 600, fontSize: 15 }}>{p.title}</p>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>{fmt(p.created_at)}</p>
              </div>
              {isAdmin ? <button className="todo-del" onClick={() => remove(p.id)} aria-label="Delete">✕</button> : null}
            </div>
            {p.body ? <p style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 14 }}>{p.body}</p> : null}
            {p.link ? <p style={{ margin: "10px 0 0" }}><a href={p.link} target="_blank" rel="noreferrer">Open →</a></p> : null}
          </div>
        ))
      )}
    </div>
  );
}
