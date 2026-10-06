"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type ClientOffer = {
  id: string;
  name: string;
  summary: string;
  isFocus: boolean;
};

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

export function OffersPanel({ clientId }: { clientId: string }) {
  const [offers, setOffers] = useState<ClientOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/offers`);
      if (!res.ok) {
        setError(await errorText(res, "Could not load offers."));
        return;
      }
      const data = (await res.json()) as { offers: ClientOffer[] };
      setOffers(data.offers || []);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply(next: ClientOffer) {
    setOffers((prev) => {
      const without = prev.some((row) => row.id === next.id)
        ? prev.map((row) => (row.id === next.id ? next : row))
        : [...prev, next];
      if (!next.isFocus) return without;
      return without.map((row) =>
        row.id === next.id ? next : { ...row, isFocus: false }
      );
    });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary }),
      });
      if (!res.ok) {
        setError(await errorText(res, "Could not add that offer."));
        return;
      }
      const data = (await res.json()) as { offer: ClientOffer };
      apply(data.offer);
      setName("");
      setSummary("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  async function markFocus(id: string, isFocus: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFocus }),
      });
      if (!res.ok) {
        setError(await errorText(res, "Could not update that offer."));
        return;
      }
      const data = (await res.json()) as { offer: ClientOffer };
      apply(data.offer);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/offers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await errorText(res, "Could not remove that offer."));
        return;
      }
      setOffers((prev) => prev.filter((row) => row.id !== id));
      setConfirmingId("");
      if (editingId === id) setEditingId("");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="lh-studio-lead">Loading…</p>;

  const empty = offers.length === 0;
  const showForm = empty || adding;

  return (
    <div className="lh-studio lh-offers">
      {empty ? <p className="lh-studio-lead">No offers yet.</p> : null}
      {offers.length > 0 ? (
        <ul className="lh-offer-list">
          {offers.map((offer) =>
            editingId === offer.id ? (
              <li key={offer.id} className={`lh-offer${offer.isFocus ? " is-focus" : ""}`}>
                <OfferEditor
                  clientId={clientId}
                  offer={offer}
                  onCancel={() => setEditingId("")}
                  onSaved={(next) => {
                    apply(next);
                    setEditingId("");
                  }}
                  onError={setError}
                />
              </li>
            ) : (
              <li key={offer.id} className={`lh-offer${offer.isFocus ? " is-focus" : ""}`}>
                <div className="lh-offer-copy">
                  {offer.isFocus ? <span className="lh-offer-focus">This month</span> : null}
                  <h3>{offer.name}</h3>
                  <p>{offer.summary}</p>
                </div>
                <div className="lh-offer-actions">
                  <button
                    type="button"
                    className="lh-text-btn"
                    disabled={busy}
                    onClick={() => void markFocus(offer.id, !offer.isFocus)}
                  >
                    {offer.isFocus ? "Clear focus" : "Make this month's focus"}
                  </button>
                  <button
                    type="button"
                    className="lh-text-btn"
                    onClick={() => {
                      setEditingId(offer.id);
                      setConfirmingId("");
                      setAdding(false);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="lh-text-btn"
                    disabled={busy}
                    onClick={() => {
                      if (confirmingId !== offer.id) {
                        setConfirmingId(offer.id);
                        return;
                      }
                      void remove(offer.id);
                    }}
                  >
                    {confirmingId === offer.id ? "Remove?" : "Remove"}
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      ) : null}
      {showForm ? (
        <form className="lh-inline-form" onSubmit={(e) => void add(e)}>
          <label className="lh-field">
            <span>Name</span>
            <input type="text" value={name} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="lh-field is-wide">
            <span>Sentence</span>
            <input
              type="text"
              value={summary}
              required
              placeholder="One sentence"
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-sm btn-secondary" disabled={busy}>
            {busy ? "Saving…" : empty ? "Add the first offer" : "Add offer"}
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
          Add an offer
        </button>
      )}
      {error ? <p className="lh-error">{error}</p> : null}
    </div>
  );
}

function OfferEditor({
  clientId,
  offer,
  onCancel,
  onSaved,
  onError,
}: {
  clientId: string;
  offer: ClientOffer;
  onCancel: () => void;
  onSaved: (next: ClientOffer) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(offer.name);
  const [summary, setSummary] = useState(offer.summary);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/offers/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary }),
      });
      if (!res.ok) {
        onError(await errorText(res, "Could not save that offer."));
        return;
      }
      const data = (await res.json()) as { offer: ClientOffer };
      onSaved(data.offer);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="lh-inline-form lh-offer-edit" onSubmit={(e) => void save(e)}>
      <label className="lh-field">
        <span>Name</span>
        <input type="text" value={name} required onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="lh-field is-wide">
        <span>Sentence</span>
        <input type="text" value={summary} required onChange={(e) => setSummary(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm btn-secondary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" className="lh-text-btn" disabled={saving} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
