"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type MoodReference = {
  id: string;
  title: string;
  url: string;
  note: string;
  image: boolean;
};

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function MoodBoardPanel({ clientId }: { clientId: string }) {
  const [references, setReferences] = useState<MoodReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/mood`);
      if (!res.ok) {
        setError(await errorText(res, "Could not load the mood board."));
        return;
      }
      const data = (await res.json()) as { references: MoodReference[] };
      setReferences(data.references || []);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/mood`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, url, note }),
      });
      if (!res.ok) {
        setError(await errorText(res, "Could not add that reference."));
        return;
      }
      const data = (await res.json()) as { reference: MoodReference };
      setReferences((prev) => [...prev, data.reference]);
      setTitle("");
      setUrl("");
      setNote("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/mood/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await errorText(res, "Could not remove that reference."));
        return;
      }
      setReferences((prev) => prev.filter((row) => row.id !== id));
      setConfirmingId("");
      if (editingId === id) setEditingId("");
    } finally {
      setBusy(false);
    }
  }

  function saveEdit(next: MoodReference) {
    setReferences((prev) => prev.map((row) => (row.id === next.id ? next : row)));
    setEditingId("");
  }

  if (loading) return <p className="lh-studio-lead">Loading…</p>;

  const empty = references.length === 0;
  const showForm = empty || adding;

  return (
    <div className="lh-studio lh-mood">
      {empty ? <p className="lh-studio-lead">No references yet.</p> : null}
      {showForm ? (
        <form className="lh-inline-form" onSubmit={(e) => void add(e)}>
          <label className="lh-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="lh-field is-wide">
            <span>URL</span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="lh-field is-wide">
            <span>Note</span>
            <input
              type="text"
              value={note}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-sm btn-secondary" disabled={busy}>
            {busy ? "Saving…" : empty ? "Add the first reference" : "Add reference"}
          </button>
          {empty ? null : (
            <button
              type="button"
              className="lh-text-btn"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          )}
        </form>
      ) : (
        <button type="button" className="lh-text-btn" onClick={() => setAdding(true)}>
          Add a reference
        </button>
      )}
      {error ? <p className="lh-error">{error}</p> : null}
      {references.length > 0 ? (
        <div className="lh-mood-grid">
          {references.map((item) => (
            <MoodTile
              key={item.id}
              clientId={clientId}
              item={item}
              editing={editingId === item.id}
              confirming={confirmingId === item.id}
              busy={busy}
              onEdit={() => {
                setEditingId(item.id);
                setConfirmingId("");
                setAdding(false);
              }}
              onCancelEdit={() => setEditingId("")}
              onSaved={saveEdit}
              onRemoveAsk={() => setConfirmingId(item.id)}
              onRemove={() => void remove(item.id)}
              onError={setError}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MoodTile({
  clientId,
  item,
  editing,
  confirming,
  busy,
  onEdit,
  onCancelEdit,
  onSaved,
  onRemoveAsk,
  onRemove,
  onError,
}: {
  clientId: string;
  item: MoodReference;
  editing: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (next: MoodReference) => void;
  onRemoveAsk: () => void;
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url);
  const [note, setNote] = useState(item.note);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setUrl(item.url);
    setNote(item.note);
    setFailed(false);
  }, [item]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/mood/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, url, note }),
      });
      if (!res.ok) {
        onError(await errorText(res, "Could not save that reference."));
        return;
      }
      const data = (await res.json()) as { reference: MoodReference };
      onSaved(data.reference);
    } finally {
      setSaving(false);
    }
  }

  const showImage = item.image && !failed && !editing;
  const host = hostOf(item.url);

  return (
    <article className={`lh-mood-tile${showImage ? "" : " is-link"}`}>
      {showImage ? (
        // User-pasted reference URLs cannot be allowlisted for next/image.
        // eslint-disable-next-line @next/next/no-img-element -- external reference
        <img src={item.url} alt="" onError={() => setFailed(true)} />
      ) : null}
      {editing ? (
        <form className="lh-mood-edit" onSubmit={(e) => void save(e)}>
          <label className="lh-field">
            <span>Title</span>
            <input type="text" value={title} required onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="lh-field">
            <span>URL</span>
            <input
              type="text"
              inputMode="url"
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="lh-field">
            <span>Note</span>
            <input
              type="text"
              value={note}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="lh-mood-actions">
            <button type="submit" className="btn btn-sm btn-secondary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="lh-text-btn" disabled={saving} onClick={onCancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="lh-mood-tile-body">
          <h3>{item.title}</h3>
          {item.note ? <p className="lh-mood-note">{item.note}</p> : null}
          {!showImage && host ? <p className="lh-mood-host">{host}</p> : null}
          <div className="lh-mood-actions">
            <a href={item.url} target="_blank" rel="noreferrer">
              Open
            </a>
            <button type="button" className="lh-text-btn" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="lh-text-btn"
              disabled={busy}
              onClick={confirming ? onRemove : onRemoveAsk}
            >
              {confirming ? "Remove?" : "Remove"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
