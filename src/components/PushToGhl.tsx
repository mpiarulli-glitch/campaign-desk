"use client";

import { useCallback, useEffect, useState } from "react";

// Push a campaign's emails into the client's GoHighLevel subaccount as
// templates.
//
// A modal rather than an inline button, because the thing that goes wrong here
// is not the push failing: it is pushing the wrong subject line, or pushing to
// the wrong subaccount, and only finding out inside GoHighLevel. So the client
// name, the subject that will be used, and which emails are selected are all
// on screen before the button is live.

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

export function PushToGhl({
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
  const [emails, setEmails] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setBlocked("");
    setResults(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/push-to-ghl`);
      const data = await res.json();
      if (!res.ok) {
        setBlocked(data.error || "Cannot push this campaign.");
        setEmails([]);
        return;
      }
      if (!data.ready) {
        setBlocked("GoHighLevel is not connected on this environment.");
        return;
      }
      setClientName(data.clientName || "");
      setEmails(data.emails || []);
      // Everything selected by default: pushing one of five is the exception,
      // and unticking is less work than ticking.
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

  async function push() {
    if (picked.size === 0) return;
    setPushing(true);
    const res = await fetch(`/api/campaigns/${campaignId}/push-to-ghl`, {
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
        Push to GHL
      </button>

      {open ? (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal card card-pad stack pgh"
            role="dialog"
            aria-modal="true"
            aria-label="Push emails to GoHighLevel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pgh-head">
              <div>
                <h2 className="pgh-title">Push to GoHighLevel</h2>
                <p className="pgh-sub">
                  Creates an email template per selection in{" "}
                  {clientName ? <strong>{clientName}</strong> : "the client"}
                  &apos;s subaccount. Existing templates are not touched, so
                  pushing twice makes two.
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            {blocked ? <p className="error">{blocked}</p> : null}

            {loading ? <p className="muted">Checking...</p> : null}

            {!loading && !blocked && emails.length === 0 ? (
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
                          view in GHL
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
            ) : emails.length > 0 ? (
              <>
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
                    email title gets used instead. Set subjects first if that
                    matters.
                  </p>
                ) : null}

                <div className="pgh-foot">
                  <span className="muted" style={{ fontSize: 12 }}>
                    {picked.size} of {emails.length} selected
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={pushing || picked.size === 0}
                    onClick={push}
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
