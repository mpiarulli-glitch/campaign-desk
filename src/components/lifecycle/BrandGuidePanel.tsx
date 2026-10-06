"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type BrandGuide = {
  url: string;
  updatedAt: string;
};

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

function lastSet(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BrandGuidePanel({ clientId }: { clientId: string }) {
  const [brand, setBrand] = useState<BrandGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/brand`);
      if (!res.ok) {
        setError(await errorText(res, "Could not load the brand guide."));
        return;
      }
      const data = (await res.json()) as { brand: BrandGuide | null };
      setBrand(data.brand);
      setUrl(data.brand?.url || "");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/brand`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        setError(await errorText(res, "Could not save that link."));
        return;
      }
      const data = (await res.json()) as { brand: BrandGuide };
      setBrand(data.brand);
      setUrl(data.brand.url);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/brand`, { method: "DELETE" });
      if (!res.ok) {
        setError(await errorText(res, "Could not remove that link."));
        return;
      }
      setBrand(null);
      setUrl("");
      setEditing(false);
      setConfirmingRemove(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="lh-studio-lead">Loading…</p>;

  if (!brand || editing) {
    return (
      <div className="lh-studio">
        <p className="lh-studio-lead">{brand ? "Brand guide" : "No brand guide yet."}</p>
        <form className="lh-inline-form" onSubmit={(e) => void save(e)}>
          <label className="lh-field is-wide">
            <span>Guide URL</span>
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
          <button type="submit" className="btn btn-sm btn-secondary" disabled={busy}>
            {busy ? "Saving…" : brand ? "Save link" : "Add the link"}
          </button>
          {brand ? (
            <button
              type="button"
              className="lh-text-btn"
              disabled={busy}
              onClick={() => {
                setUrl(brand.url);
                setEditing(false);
                setError("");
              }}
            >
              Cancel
            </button>
          ) : null}
        </form>
        {error ? <p className="lh-error">{error}</p> : null}
      </div>
    );
  }

  const when = lastSet(brand.updatedAt);

  return (
    <div className="lh-studio">
      <article className="lh-doc">
        <h3>Brand guide</h3>
        <p className="lh-doc-url">{brand.url}</p>
        {when ? <p className="lh-studio-lead">Last set {when}</p> : null}
        <div className="lh-doc-actions">
          <a className="btn btn-sm btn-secondary" href={brand.url} target="_blank" rel="noreferrer">
            Open the guide
          </a>
          <button type="button" className="lh-text-btn" onClick={() => setEditing(true)}>
            Edit link
          </button>
          <button
            type="button"
            className="lh-text-btn"
            disabled={busy}
            onClick={() => {
              if (!confirmingRemove) {
                setConfirmingRemove(true);
                return;
              }
              void remove();
            }}
          >
            {busy ? "Removing…" : confirmingRemove ? "Remove?" : "Remove"}
          </button>
        </div>
        {error ? <p className="lh-error">{error}</p> : null}
      </article>
    </div>
  );
}
