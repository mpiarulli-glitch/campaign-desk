"use client";

import { useEffect, useState } from "react";

type Issue = {
  id: string;
  submitted_by: string;
  anonymous: number;
  subject: string;
  body: string;
  status: string;
  created_at: string;
};

const STATUSES = ["open", "acknowledged", "resolved"];
function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function HrSection({ isAdmin, personLabel }: { isAdmin: boolean; personLabel: (s: string) => string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sent, setSent] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);

  async function loadIssues() {
    if (!isAdmin) return;
    const res = await fetch("/api/hub/hr");
    if (res.ok) setIssues((await res.json()).issues || []);
  }
  useEffect(() => { loadIssues(); }, [isAdmin]);

  async function submit() {
    if (!subject.trim()) return;
    const res = await fetch("/api/hub/hr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, anonymous }),
    });
    if (res.ok) {
      setSubject(""); setBody(""); setAnonymous(false);
      setSent(true);
      setTimeout(() => setSent(false), 4000);
      loadIssues();
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/hub/hr/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadIssues();
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="acct-section">
        <div className="acct-section-head"><h2 className="acct-section-title">Raise something with HR</h2></div>
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Anything you need to escalate — a conflict, a concern, a question. Only the owner and admins can read these.
          </p>
          {sent ? <p className="hub-sent">Sent. Thank you for raising it — someone will follow up.</p> : null}
          <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea rows={5} placeholder="What's going on?" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="row" style={{ gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Submit anonymously (your name won&apos;t be attached)
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={submit} disabled={!subject.trim()}>Submit</button>
          </div>
        </div>
      </div>

      {isAdmin ? (
        <div className="acct-section">
          <div className="acct-section-head"><h2 className="acct-section-title">Escalations</h2></div>
          {issues.length === 0 ? (
            <div className="empty"><p>No issues raised.</p></div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {issues.map((it) => (
                <div key={it.id} className="card card-pad">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <p style={{ margin: "0 0 3px", fontWeight: 600, fontSize: 15 }}>{it.subject}</p>
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        {it.anonymous ? "Anonymous" : personLabel(it.submitted_by) || "Unknown"} · {fmt(it.created_at)}
                      </p>
                    </div>
                    <select className="select-clean badge-select" value={it.status} onChange={(e) => setStatus(it.id, e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {it.body ? <p style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 14 }}>{it.body}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
