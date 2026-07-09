"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";
import { EmailPreview } from "@/components/EmailPreview";
import { StatusBadge } from "@/components/StatusBadge";

type Comment = {
  id: string;
  email_id: string | null;
  author_name: string;
  body: string;
  type: "general" | "inline";
  pin_x: number | null;
  pin_y: number | null;
  resolved: number;
  created_at: string;
};

type EmailItem = {
  id: string;
  title: string;
  html_content: string;
  sort_order: number;
  open_comments: number;
};

type Campaign = {
  id: string;
  title: string;
  client_name: string;
  description: string;
  status: string;
  updated_at: string;
};

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"general" | "pin">("general");
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(
    null
  );
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("cd_reviewer_name");
    if (saved) setAuthorName(saved);
  }, []);

  async function load(keepEmailId?: string | null) {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/review/${token}`);
    if (!res.ok) {
      setError("This review link is invalid or expired.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCampaign(data.campaign);
    setEmails(data.emails || []);
    setComments(data.comments || []);

    const nextId =
      keepEmailId &&
      (data.emails || []).some((e: EmailItem) => e.id === keepEmailId)
        ? keepEmailId
        : activeEmailId &&
            (data.emails || []).some((e: EmailItem) => e.id === activeEmailId)
          ? activeEmailId
          : data.emails?.[0]?.id || null;
    setActiveEmailId(nextId);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [token]);

  const activeEmail = useMemo(
    () => emails.find((e) => e.id === activeEmailId) || emails[0] || null,
    [emails, activeEmailId]
  );

  const emailComments = useMemo(
    () =>
      comments.filter(
        (c) => !activeEmail || c.email_id === activeEmail.id || !c.email_id
      ),
    [comments, activeEmail]
  );

  const inlinePins = useMemo(
    () => emailComments.filter((c) => c.type === "inline"),
    [emailComments]
  );

  function selectEmail(emailId: string) {
    setActiveEmailId(emailId);
    setActivePinId(null);
    setPendingPin(null);
    setMode("general");
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!activeEmail) return;
    setSubmitting(true);
    setError("");
    setMessage("");

    if (mode === "pin" && !pendingPin) {
      setError("Click on the email to place a pin first.");
      setSubmitting(false);
      return;
    }

    const name = authorName.trim() || "Reviewer";
    localStorage.setItem("cd_reviewer_name", name);

    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorName: name,
        body,
        type: mode === "pin" ? "inline" : "general",
        pinX: pendingPin?.x,
        pinY: pendingPin?.y,
        emailId: activeEmail.id,
      }),
    });

    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not post comment.");
      return;
    }

    setBody("");
    setPendingPin(null);
    setMessage("Feedback sent. Thank you.");
    load(activeEmail.id);
  }

  async function approveEmail() {
    if (
      !confirm(
        "This will let the email team know this campaign is approved. Continue?"
      )
    ) {
      return;
    }
    setApproving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markApproved: true }),
    });
    setApproving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not approve this email.");
      return;
    }
    setMessage("Got it. The email team has been notified this is approved.");
    load(activeEmailId);
  }

  if (loading) {
    return (
      <div className="login-wrap">
        <p className="muted">Loading campaign...</p>
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!campaign || !activeEmail) return null;

  const locked = campaign.status === "approved";
  const activeIndex = emails.findIndex((e) => e.id === activeEmail.id);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <StatusBadge status={campaign.status} />
      </header>

      <main className="container container-wide stack">
        <div>
          <p className="eyebrow">Email review</p>
          <h1 className="h1">{campaign.title}</h1>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            {campaign.client_name ? `${campaign.client_name} · ` : ""}
            {emails.length} email{emails.length === 1 ? "" : "s"} · Updated{" "}
            {new Date(campaign.updated_at).toLocaleString()}
          </p>
          {campaign.description ? (
            <p className="body-text" style={{ marginTop: 10, lineHeight: 1.6 }}>
              {campaign.description}
            </p>
          ) : null}
        </div>

        {emails.length > 1 ? (
          <div className="card card-pad stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                Email {activeIndex + 1} of {emails.length}
              </strong>
              <div className="row">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={activeIndex <= 0}
                  onClick={() => selectEmail(emails[activeIndex - 1].id)}
                >
                  Previous
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={activeIndex >= emails.length - 1}
                  onClick={() => selectEmail(emails[activeIndex + 1].id)}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="email-tabs">
              {emails.map((email, index) => (
                <button
                  key={email.id}
                  type="button"
                  className={`email-tab ${
                    email.id === activeEmail.id ? "active" : ""
                  }`}
                  onClick={() => selectEmail(email.id)}
                >
                  <span className="email-tab-num">{index + 1}</span>
                  <span className="email-tab-label">{email.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {locked ? (
          <div className="card card-pad approve-card is-approved">
            <strong>This email is approved.</strong>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              The email team has been notified. Feedback is closed. You can still
              view the emails and prior comments.
            </p>
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <strong>How to leave feedback</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Toggle between emails above, then leave general notes or pin
                comments on the one you are viewing.
              </p>
            </div>
            <div className="card card-pad approve-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Ready to approve?</strong>
                  <p
                    className="muted"
                    style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55 }}
                  >
                    Click this button and let the email team know this is
                    approved. That covers every email in this package.
                  </p>
                </div>
                <button
                  className="btn btn-approve"
                  onClick={approveEmail}
                  disabled={approving}
                >
                  {approving ? "Sending..." : "Approve and notify email team"}
                </button>
              </div>
            </div>
          </>
        )}
        {message ? <p className="success">{message}</p> : null}
        {error && campaign ? <p className="error">{error}</p> : null}

        <div className="split-review">
          <div className="stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="h2">{activeEmail.title}</h2>
            </div>
            {!locked ? (
              <div className="toolbar">
                <button
                  className={`tab ${mode === "general" ? "active" : ""}`}
                  onClick={() => {
                    setMode("general");
                    setPendingPin(null);
                  }}
                >
                  General comment
                </button>
                <button
                  className={`tab ${mode === "pin" ? "active" : ""}`}
                  onClick={() => setMode("pin")}
                >
                  Pin on email
                </button>
                {mode === "pin" ? (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {pendingPin
                      ? "Pin placed. Write your note on the right."
                      : "Click anywhere on the email to drop a pin."}
                  </span>
                ) : null}
              </div>
            ) : null}

            <EmailPreview
              html={activeEmail.html_content}
              pins={[
                ...inlinePins,
                ...(pendingPin
                  ? [
                      {
                        id: "pending",
                        pin_x: pendingPin.x,
                        pin_y: pendingPin.y,
                        resolved: 0,
                        body: "New pin",
                      },
                    ]
                  : []),
              ]}
              activePinId={activePinId}
              pinMode={mode === "pin" && !locked}
              onPlacePin={(x, y) => setPendingPin({ x, y })}
              onSelectPin={setActivePinId}
            />
          </div>

          <div className="stack">
            {!locked ? (
              <form className="card card-pad stack" onSubmit={submitComment}>
                <h2 className="h2">
                  {mode === "pin" ? "Pinned feedback" : "General feedback"}
                </h2>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Commenting on: <strong>{activeEmail.title}</strong>
                </p>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input
                    id="name"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Boss / Client name"
                  />
                </div>
                <div className="field">
                  <label htmlFor="body">Comment</label>
                  <textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={
                      mode === "pin"
                        ? "What should change at this spot?"
                        : "Overall thoughts, tone, offer, CTA..."
                    }
                    required
                  />
                </div>
                {error ? <p className="error">{error}</p> : null}
                {message ? <p className="success">{message}</p> : null}
                <button className="btn" type="submit" disabled={submitting}>
                  {submitting ? "Sending..." : "Send feedback"}
                </button>
              </form>
            ) : null}

            <div className="card card-pad stack">
              <h2 className="h2">Comments on this email</h2>
              {emailComments.length === 0 ? (
                <div className="empty">No comments on this email yet.</div>
              ) : (
                <div className="comment-list">
                  {emailComments.map((c, index) => (
                    <div
                      key={c.id}
                      className={`comment-card ${c.resolved ? "resolved" : ""} ${
                        activePinId === c.id ? "active" : ""
                      }`}
                      onClick={() => c.type === "inline" && setActivePinId(c.id)}
                      style={{
                        cursor: c.type === "inline" ? "pointer" : "default",
                      }}
                    >
                      <div className="comment-head">
                        <span>
                          {c.author_name}
                          {c.type === "inline"
                            ? ` · Pin ${
                                inlinePins.findIndex((p) => p.id === c.id) + 1
                              }`
                            : " · General"}
                          {c.resolved ? " · Resolved" : ""}
                        </span>
                        <span>{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <div className="comment-body">{c.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
