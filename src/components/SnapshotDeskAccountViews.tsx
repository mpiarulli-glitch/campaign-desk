"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Win = { id: string; body: string; happened_on: string };

export function SnapshotDeskWins({ clientId }: { clientId: string }) {
  const [wins, setWins] = useState<Win[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [happenedOn, setHappenedOn] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/snapshot/accounts/${clientId}`);
      if (!res.ok) {
        setError("Could not load wins.");
        return;
      }
      const data = await res.json();
      setWins(data.wins || []);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addWin(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const res = await fetch("/api/snapshot/win", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, body, happenedOn }),
    });
    if (!res.ok) {
      setError("Could not add win.");
      return;
    }
    setBody("");
    setHappenedOn("");
    void load();
  }

  async function removeWin(id: string) {
    await fetch(`/api/snapshot/win/${id}`, { method: "DELETE" });
    void load();
  }

  if (loading) return <p className="snap-n-pane-muted">Loading wins…</p>;

  return (
    <div className="snap-n-pane">
      <div className="snap-n-pane-head">
        <strong>Wins</strong>
        <span>Shown to the client, newest first</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {wins.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          {wins.map((w) => (
            <div key={w.id} className="snap-win-edit">
              <span aria-hidden="true">🏆</span>
              <div style={{ flex: 1 }}>
                <div>{w.body}</div>
                {w.happened_on ? (
                  <span className="muted" style={{ fontSize: 12 }}>{w.happened_on}</span>
                ) : null}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeWin(w.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="snap-n-pane-muted">No wins yet.</p>
      )}
      <form className="row" style={{ gap: 8 }} onSubmit={addWin}>
        <input
          style={{ flex: 1 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a win the client should see"
        />
        <input type="date" value={happenedOn} onChange={(e) => setHappenedOn(e.target.value)} />
        <button className="btn btn-sm" type="submit">Add win</button>
      </form>
    </div>
  );
}

export function SnapshotDeskClientView({ clientId }: { clientId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/snapshot/accounts/${clientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError("Could not load the client link.");
          return;
        }
        setToken(typeof data.token === "string" ? data.token : null);
      })
      .catch(() => {
        if (!cancelled) setError("Network error. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/snapshot/${token}`
      : "";

  async function copyShare() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return <p className="snap-n-pane-muted">Loading client view…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!shareUrl) return <p className="snap-n-pane-muted">No client link yet.</p>;

  return (
    <div className="snap-n-pane">
      <div className="card card-pad snap-share">
        <div>
          <strong>Client link</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Read-only. Send this to the client — it always shows the latest.
          </p>
        </div>
        <div className="copy-box" style={{ flex: 1, minWidth: 220 }}>
          <code>{shareUrl}</code>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyShare()}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div className="snap-preview">
        <div className="snap-preview-bar">
          <span>Exactly what the client sees at this link</span>
          <a className="btn btn-ghost btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
            Open in new tab ↗
          </a>
        </div>
        <iframe
          key={shareUrl}
          className="snap-preview-frame"
          src={shareUrl}
          title="Client snapshot preview"
        />
      </div>
    </div>
  );
}
