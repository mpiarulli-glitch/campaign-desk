"use client";

import { useCallback, useEffect, useState } from "react";

// Push a campaign's emails into the client's Klaviyo account as HTML templates.
// Same confirm-first modal as Push to GHL: the client, the subjects, and which
// emails are selected are on screen before anything is created.

type Candidate = {
  id: string;
  title: string;
  kind: string;
  subject: string;
  hasSubject: boolean;
};

type Result = {
  emailId: string;
  title: string;
  ok: boolean;
  templateId?: string;
  previewUrl?: string;
  error?: string;
};

export function PushToKlaviyo({
  campaignId,
  campaignTitle,
}: {
  campaignId: string;
  campaignTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState("");
  const [clientName, setClientName] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [emails, setEmails] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setBlocked("");
    setResults(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/push-to-klaviyo`);
      const data = await res.json();
      if (!res.ok) {
        setBlocked(data.error || "Cannot push this campaign.");
        setEmails([]);
        return;
      }
      setClientName(data.clientName || "");
      setHasKey(Boolean(data.hasKey));
      setKeyHint(data.keyHint || "");
      setEmails(data.emails || []);
      setPicked(new Set((data.emails || []).map((e: Candidate) => e.id)));
    } catch {
      setBlocked("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    setBlocked("");
    const res = await fetch(`/api/campaigns/${campaignId}/push-to-klaviyo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });
    const data = await res.json();
    setSavingKey(false);
    if (!res.ok) {
      setBlocked(data.error || "Could not save that Klaviyo key.");
      return;
    }
    setApiKey("");
    setHasKey(true);
    setKeyHint(data.keyHint || "");
    if (Array.isArray(data.emails)) {
      setEmails(data.emails);
      setPicked(new Set(data.emails.map((e: Candidate) => e.id)));
    }
  }

  async function push() {
    if (picked.size === 0) return;
    setPushing(true);
    const res = await fetch(`/api/campaigns/${campaignId}/push-to-klaviyo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailIds: [...picked] }),
    });
    const data = await res.json();
    setPushing(false);
    if (!res.ok) {
      setBlocked(data.error || "That push failed.");
      return;
    }
    setResults(data.results || []);
  }

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  const missingSubject = emails.filter((e) => picked.has(e.id) && !e.hasSubject);

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Push to Klaviyo
      </button>

      {open ? (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal card card-pad stack pgh"
            role="dialog"
            aria-modal="true"
            aria-label="Push emails to Klaviyo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pgh-head">
              <div>
                <h2 className="pgh-title">Push to Klaviyo</h2>
                <p className="pgh-sub">
                  Creates an HTML template per selection in{" "}
                  {clientName ? <strong>{clientName}</strong> : "the client"}
                  &apos;s Klaviyo account. Existing templates are not touched, so
                  pushing twice makes two.
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            {blocked ? <p className="error">{blocked}</p> : null}

            {loading ? <p className="muted">Checking...</p> : null}

            {!loading && !blocked && !hasKey ? (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  Paste a private API key from this client&apos;s Klaviyo account
                  (Settings → API keys). It needs Templates read and write.
                  The key stays on this server and is reused for this client.
                </p>
                <div className="field">
                  <label htmlFor="klaviyo-api-key">Private API key</label>
                  <input
                    id="klaviyo-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="pk_…"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="pgh-foot">
                  <span />
                  <button
                    className="btn btn-sm"
                    disabled={savingKey || !apiKey.trim()}
                    onClick={() => void saveKey()}
                  >
                    {savingKey ? "Checking key..." : "Save key"}
                  </button>
                </div>
              </div>
            ) : null}

            {!loading && hasKey && !blocked && emails.length === 0 ? (
              <p className="muted">
                Nothing here is an email. SMS, blog posts and mock-ups are not
                pushed, because they are not email templates.
              </p>
            ) : null}

            {results ? (
              <div className="pgh-results">
                {results.map((r) => (
                  <div key={r.emailId} className={`pgh-result ${r.ok ? "is-ok" : "is-bad"}`}>
                    <span className="pgh-result-name">{r.title}</span>
                    {r.ok ? (
                      r.previewUrl ? (
                        <a href={r.previewUrl} target="_blank" rel="noreferrer">
                          view in Klaviyo
                        </a>
                      ) : (
                        <span>pushed</span>
                      )
                    ) : (
                      <span className="pgh-result-err">{r.error}</span>
                    )}
                  </div>
                ))}
                <div className="pgh-foot">
                  <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
                    Push more
                  </button>
                  <button className="btn btn-sm" onClick={() => setOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            ) : hasKey && emails.length > 0 && !loading ? (
              <>
                {keyHint ? (
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Using key {keyHint}
                  </p>
                ) : null}
                <ul className="pgh-list">
                  {emails.map((e) => (
                    <li key={e.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={picked.has(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                        <span className="pgh-name">
                          {campaignTitle} - {e.title}
                        </span>
                      </label>
                      <span className={`pgh-subject ${e.hasSubject ? "" : "is-fallback"}`}>
                        {e.hasSubject ? e.subject : `no subject set, will use "${e.title}"`}
                      </span>
                    </li>
                  ))}
                </ul>

                {missingSubject.length ? (
                  <p className="pgh-warn">
                    {missingSubject.length} of these have no subject line, so the
                    email title is used in the template name. Set subjects first
                    if that matters.
                  </p>
                ) : null}

                <div className="pgh-foot">
                  <span className="muted" style={{ fontSize: 12 }}>
                    {picked.size} of {emails.length} selected
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={pushing || picked.size === 0}
                    onClick={() => void push()}
                  >
                    {pushing
                      ? "Pushing..."
                      : `Push ${picked.size} template${picked.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
