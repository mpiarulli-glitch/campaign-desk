"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { snapshotAuthorLabel } from "@/lib/people";
import { winLoggedByMatches } from "@/lib/snapshot-fill";

type Win = { id: string; body: string; happened_on: string; week_start?: string };

export type SavedWin = {
  id: string;
  body: string;
  happened_on: string;
  week_start: string;
  logged_by: string;
};

export type DeskWeekWin = {
  id: string;
  client_id: string;
  body: string;
  happened_on: string;
  logged_by: string;
};

export function EditableSnapshotWin({
  win,
  showDate,
  onSaved,
  onRemove,
}: {
  win: { id: string; body: string; happened_on: string };
  showDate?: boolean;
  onSaved: (win: SavedWin) => void;
  onRemove?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(win.body);
  const [happenedOn, setHappenedOn] = useState(win.happened_on || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/snapshot/win/${win.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          ...(showDate ? { happenedOn } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save that win.");
        return;
      }
      const saved = data.win as SavedWin;
      onSaved(saved);
      setEditing(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="snap-desk-win-line">
        <span>{win.body}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setBody(win.body);
            setHappenedOn(win.happened_on || "");
            setError("");
            setEditing(true);
          }}
        >
          Edit
        </button>
        {onRemove ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <form className="snap-desk-win-line" onSubmit={(event) => void save(event)}>
      <input
        value={body}
        aria-label="Edit win"
        onChange={(event) => setBody(event.target.value)}
      />
      {showDate ? (
        <input
          type="date"
          aria-label="Happened on"
          value={happenedOn}
          onChange={(event) => setHappenedOn(event.target.value)}
        />
      ) : null}
      <button className="btn btn-sm" type="submit" disabled={saving || !body.trim()}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setEditing(false);
          setError("");
        }}
      >
        Cancel
      </button>
      {error ? <span className="error">{error}</span> : null}
    </form>
  );
}

export function SnapshotDeskWeeklyWin({
  clientId,
  clientName,
  weekStart,
  viewerSlug,
  wins,
  onAdded,
  onEdited,
}: {
  clientId: string;
  clientName: string;
  weekStart: string;
  viewerSlug: string;
  wins: DeskWeekWin[];
  onAdded: (win: DeskWeekWin) => void;
  onEdited: (win: SavedWin) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const done = wins.some((w) => winLoggedByMatches(w.logged_by, viewerSlug));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/snapshot/win", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, body, weekStart }),
      });
      if (!res.ok) {
        setError("Could not save your win.");
        return;
      }
      const data = await res.json();
      const win = data.win || data;
      setBody("");
      onAdded({
        id: win.id,
        client_id: clientId,
        body: win.body,
        happened_on: win.happened_on || "",
        logged_by: win.logged_by || viewerSlug,
      });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`snap-desk-win ${done ? "is-in" : "is-needed"}`}>
      <div className="snap-desk-win-head">
        <strong>Wins</strong>
        {done ? null : <span>Yours is still open</span>}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {wins.length > 0 ? (
        <ul className="snap-desk-win-list">
          {wins.map((w) => (
            <li key={w.id}>
              <span className="snap-desk-win-who">
                {snapshotAuthorLabel(w.logged_by) || "Teammate"}
              </span>
              <EditableSnapshotWin win={w} onSaved={onEdited} />
            </li>
          ))}
        </ul>
      ) : null}
      <form className="snap-desk-win-form" onSubmit={(e) => void submit(e)}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={done ? "Add another win for this account" : "What moved this account this week?"}
          aria-label={`Weekly win for ${clientName}`}
        />
        <button className="btn btn-sm" type="submit" disabled={saving || !body.trim()}>
          {saving ? "Saving…" : done ? "Add another" : "Log win"}
        </button>
      </form>
    </div>
  );
}

export function SnapshotDeskWins({ clientId, weekStart }: { clientId: string; weekStart?: string }) {
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
      body: JSON.stringify({ clientId, body, happenedOn, weekStart }),
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
              <EditableSnapshotWin
                win={w}
                showDate
                onSaved={(saved) =>
                  setWins((cur) =>
                    cur.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
                  )
                }
                onRemove={() => void removeWin(w.id)}
              />
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
