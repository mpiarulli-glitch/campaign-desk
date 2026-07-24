"use client";

import { useEffect, useState } from "react";

type Sop = { id: string; title: string; category: string; body: string; link: string };

export function SopsSection({ isAdmin }: { isAdmin: boolean }) {
  const [sops, setSops] = useState<Sop[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", category: "", body: "", link: "" });

  async function load() {
    const res = await fetch("/api/hub/sops");
    if (res.ok) setSops((await res.json()).sops || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.title.trim()) return;
    await fetch("/api/hub/sops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setDraft({ title: "", category: "", body: "", link: "" });
    setAdding(false);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this SOP?")) return;
    await fetch(`/api/hub/sops/${id}`, { method: "DELETE" });
    load();
  }

  const categories = Array.from(new Set(sops.map((s) => s.category || "General")));

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>How we do things. Read before you ask.</p>
        {isAdmin ? (
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ New SOP"}</button>
        ) : null}
      </div>

      {adding ? (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="Category (e.g. Onboarding, Email, Production)" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <textarea rows={5} placeholder="Write the SOP…" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <input placeholder="Optional link (Google Doc, Loom…)" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={add} disabled={!draft.title.trim()}>Save SOP</button>
          </div>
        </div>
      ) : null}

      {sops.length === 0 ? (
        <div className="empty"><p>No SOPs yet.</p></div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="stack" style={{ gap: 8 }}>
            <h3 className="hub-cat">{cat}</h3>
            {sops.filter((s) => (s.category || "General") === cat).map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <button className="sop-title" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                    {open[s.id] ? "▾" : "▸"} {s.title}
                  </button>
                  {isAdmin ? <button className="todo-del" onClick={() => remove(s.id)} aria-label="Delete">✕</button> : null}
                </div>
                {open[s.id] ? (
                  <div className="sop-body">
                    {s.body ? <p style={{ whiteSpace: "pre-wrap", margin: "10px 0 0" }}>{s.body}</p> : null}
                    {s.link ? <p style={{ margin: "10px 0 0" }}><a href={s.link} target="_blank" rel="noreferrer">Open full doc →</a></p> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
