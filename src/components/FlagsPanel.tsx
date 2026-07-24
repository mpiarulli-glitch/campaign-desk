"use client";

import { useCallback, useEffect, useState } from "react";
import { teamLabel } from "@/lib/team";

type Level = "red" | "yellow" | "green";
type Flag = {
  id: string;
  level: Level;
  note: string;
  created_by: string;
  resolved: number;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
};

const LEVELS: { level: Level; label: string; hint: string }[] = [
  { level: "red", label: "Red flag", hint: "Urgent — at risk, needs attention now" },
  { level: "yellow", label: "Yellow flag", hint: "Watch — a concern worth tracking" },
  { level: "green", label: "Green flag", hint: "Positive — going well, worth noting" },
];

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function FlagsPanel({
  clientId,
  onChange,
}: {
  clientId: string;
  onChange?: () => void;
}) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<Level>("yellow");
  const [note, setNote] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/flags`);
    if (res.ok) setFlags((await res.json()).flags || []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function raise() {
    if (!note.trim()) return;
    await fetch(`/api/clients/${clientId}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, note }),
    });
    setNote("");
    setLevel("yellow");
    await load();
    onChange?.();
  }
  async function resolve(id: string, resolved: boolean) {
    await fetch(`/api/flags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    await load();
    onChange?.();
  }
  async function remove(id: string) {
    if (!confirm("Delete this flag?")) return;
    await fetch(`/api/flags/${id}`, { method: "DELETE" });
    await load();
    onChange?.();
  }

  const active = flags.filter((f) => !f.resolved);
  const resolved = flags.filter((f) => f.resolved);

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="acct-section">
        <div className="acct-section-head"><h2 className="acct-section-title">Report an issue</h2></div>
        <div className="card card-pad stack" style={{ gap: 14 }}>
          <div className="flag-picker">
            {LEVELS.map((l) => (
              <button
                key={l.level}
                type="button"
                className={`flag-choice flag-${l.level} ${level === l.level ? "is-on" : ""}`}
                onClick={() => setLevel(l.level)}
                title={l.hint}
              >
                <span className="flag-dot" />
                <span>
                  <strong>{l.label}</strong>
                  <small>{l.hint}</small>
                </span>
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={note}
            placeholder="What's going on with this account?"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={raise} disabled={!note.trim()}>Raise flag</button>
          </div>
        </div>
      </div>

      <div className="acct-section">
        <div className="acct-section-head">
          <h2 className="acct-section-title">Active flags {active.length ? `(${active.length})` : ""}</h2>
          {resolved.length ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide resolved" : `Resolved (${resolved.length})`}
            </button>
          ) : null}
        </div>
        {active.length === 0 ? (
          <div className="empty"><p>No active flags. This account is clear.</p></div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {active.map((f) => (
              <div key={f.id} className={`card card-pad flag-row flag-${f.level}`}>
                <span className="flag-dot lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 3px", fontSize: 14 }}>{f.note}</p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {f.created_by ? teamLabel(f.created_by) : "Someone"} · {fmt(f.created_at)}
                  </p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => resolve(f.id, true)}>Resolve</button>
                  <button className="todo-del" onClick={() => remove(f.id)} aria-label="Delete">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showResolved && resolved.length ? (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {resolved.map((f) => (
              <div key={f.id} className="card card-pad flag-row flag-resolved">
                <span className={`flag-dot flag-${f.level}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 3px", fontSize: 14, textDecoration: "line-through", opacity: 0.7 }}>{f.note}</p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Resolved by {f.resolved_by ? teamLabel(f.resolved_by) : "someone"}
                    {f.resolved_at ? ` · ${fmt(f.resolved_at)}` : ""}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => resolve(f.id, false)}>Reopen</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
