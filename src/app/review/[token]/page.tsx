"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";
import { EmailPreview } from "@/components/EmailPreview";
import { StatusBadge } from "@/components/StatusBadge";

type Attachment = {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
};

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
  attachments?: Attachment[];
};

type LocalImage = {
  id: string;
  dataUrl: string;
  base64: string;
  mime: string;
  width: number;
  height: number;
};

const MAX_IMAGES = 6;
const MAX_EDGE = 1600;

// Compress a picked image in the browser so uploads stay small: scale the
// longest edge down to MAX_EDGE and re-encode as JPEG. Returns base64 (no
// data: prefix) plus a preview data URL.
function compressImage(file: File): Promise<LocalImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_EDGE || height > MAX_EDGE) {
          const scale = MAX_EDGE / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unsupported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        resolve({
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${file.name}-${width}x${height}`,
          dataUrl,
          base64: dataUrl.split(",")[1] || "",
          mime: "image/jpeg",
          width,
          height,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

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
  const [images, setImages] = useState<LocalImage[]>([]);
  const [imgBusy, setImgBusy] = useState(false);

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError("");
    setImgBusy(true);
    try {
      const remaining = MAX_IMAGES - images.length;
      const files = Array.from(fileList)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, Math.max(0, remaining));
      const compressed: LocalImage[] = [];
      for (const f of files) {
        try {
          compressed.push(await compressImage(f));
        } catch {
          // Skip any file that fails to process.
        }
      }
      if (compressed.length > 0) {
        setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
      }
    } finally {
      setImgBusy(false);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

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

    if (!body.trim() && images.length === 0) {
      setError("Add a comment or attach an image.");
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
        images: images.map((i) => ({
          mime: i.mime,
          dataBase64: i.base64,
          width: i.width,
          height: i.height,
        })),
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
    setImages([]);
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
                  />
                </div>

                <div className="field">
                  <label>
                    Attach images{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      (optional, up to {MAX_IMAGES})
                    </span>
                  </label>
                  {images.length > 0 ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      {images.map((img) => (
                        <div
                          key={img.id}
                          style={{ position: "relative", lineHeight: 0 }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.dataUrl}
                            alt="attachment preview"
                            style={{
                              width: 72,
                              height: 72,
                              objectFit: "cover",
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => removeImage(img.id)}
                            aria-label="Remove image"
                            style={{
                              position: "absolute",
                              top: -8,
                              right: -8,
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              border: "none",
                              background: "#111827",
                              color: "#fff",
                              cursor: "pointer",
                              fontSize: 13,
                              lineHeight: "22px",
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {images.length < MAX_IMAGES ? (
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={imgBusy}
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  ) : null}
                  {imgBusy ? (
                    <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                      Processing images...
                    </p>
                  ) : null}
                </div>
                {error ? <p className="error">{error}</p> : null}
                {message ? <p className="success">{message}</p> : null}
                <button
                  className="btn"
                  type="submit"
                  disabled={submitting || imgBusy}
                >
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
                      {c.body ? (
                        <div className="comment-body">{c.body}</div>
                      ) : null}
                      {c.attachments && c.attachments.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
                          {c.attachments.map((a) => (
                            <a
                              key={a.id}
                              href={`/api/attachments/${a.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ lineHeight: 0 }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/attachments/${a.id}`}
                                alt="feedback attachment"
                                style={{
                                  width: 96,
                                  height: 96,
                                  objectFit: "cover",
                                  borderRadius: 8,
                                  border: "1px solid #e5e7eb",
                                }}
                              />
                            </a>
                          ))}
                        </div>
                      ) : null}
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
