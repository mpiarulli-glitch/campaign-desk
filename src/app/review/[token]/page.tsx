"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";
import { EmailPreview } from "@/components/EmailPreview";
import { EmailLinks } from "@/components/EmailLinks";
import { StatusBadge } from "@/components/StatusBadge";
import { AutomationMap } from "@/components/AutomationMap";
import {
  renderAssetDoc,
  kindNoun,
  type AssetKind,
  type BodyFormat,
} from "@/lib/asset-kinds";
import { coercePresentation, type FlowStepRecord } from "@/lib/automation-map";
import { isCopyQuote, type CopyQuote } from "@/lib/copy-quote";

type Attachment = {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
};

type Reply = {
  id: string;
  author_name: string;
  body: string;
  is_admin: number;
  created_at: string;
};

type Comment = {
  id: string;
  email_id: string | null;
  author_name: string;
  body: string;
  type: "general" | "inline";
  pin_x: number | null;
  pin_y: number | null;
  quote_text: string | null;
  quote_ordinal: number | null;
  resolved: number;
  created_at: string;
  attachments?: Attachment[];
  replies?: Reply[];
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

// First letters of a reviewer's name, for the small round avatar on a comment.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

type SubjectOption = {
  id: string;
  subject: string;
  preview_text: string;
};

type EmailItem = {
  id: string;
  title: string;
  html_content: string;
  kind?: AssetKind;
  body_format?: BodyFormat;
  media_url?: string | null;
  sort_order: number;
  open_comments: number;
  approved_at: string | null;
  approved_by?: string | null;
  chosen_subject_id?: string | null;
  subjects?: SubjectOption[];
  delay_ms?: number;
  purpose?: string;
};

type Campaign = {
  id: string;
  title: string;
  client_name: string;
  description: string;
  status: string;
  updated_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  presentation?: string;
  trigger_label?: string;
  trigger_kind?: string;
  internally_approved?: boolean;
};

// A typed first + last name is what makes an approval a paper trail rather
// than an anonymous click from the magic link.
function isFullName(name: string): boolean {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [flow, setFlow] = useState<FlowStepRecord[]>([]);
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"general" | "pin">("general");
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(
    null
  );
  const [pendingQuote, setPendingQuote] = useState<CopyQuote | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  // Page-level notices cover the link itself and the approve actions, which
  // live at the top of the page. Form-level notices stay next to the compose
  // box in the rail so a reviewer never has to scroll to find the response.
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function submitReply(commentId: string) {
    const text = (replyDrafts[commentId] || "").trim();
    if (!text) return;
    setReplyingId(commentId);
    const name = authorName.trim() || "Reviewer";
    localStorage.setItem("cd_reviewer_name", name);
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replyTo: commentId, body: text, authorName: name }),
    });
    setReplyingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Could not send reply.");
      return;
    }
    setFormError("");
    setReplyDrafts((prev) => ({ ...prev, [commentId]: "" }));
    load(activeEmailId, { silent: true });
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setFormError("");
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

  // silent = true skips the full-page loading state so a reply, approval, or
  // comment submit doesn't blank the whole screen out from under the client
  // mid-interaction; only the initial mount load shows it.
  async function load(keepEmailId?: string | null, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/review/${token}`);
      if (!res.ok) {
        setError("This review link is invalid or expired.");
        return;
      }
      const data = await res.json();
      setCampaign(data.campaign);
      setEmails(data.emails || []);
      setFlow(data.flow || []);
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
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!previewOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

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
    () =>
      emailComments.filter(
        (c) => c.type === "inline" && c.pin_x !== null && c.pin_y !== null
      ),
    [emailComments]
  );

  const quoteComments = useMemo(
    () => emailComments.filter(isCopyQuote),
    [emailComments]
  );

  function selectEmail(emailId: string) {
    setActiveEmailId(emailId);
    setActivePinId(null);
    setPendingPin(null);
    setPendingQuote(null);
    setMode("general");
  }

  async function chooseSubject(emailId: string, subjectId: string) {
    const current = emails.find((e) => e.id === emailId);
    // Clicking the already-chosen option clears it (toggle off).
    const next = current?.chosen_subject_id === subjectId ? null : subjectId;
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chooseSubject: { emailId, subjectId: next } }),
    });
    if (res.ok) load(emailId, { silent: true });
  }

  async function unapproveOneEmail(emailId: string) {
    setApproving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unapproveEmail: emailId }),
    });
    setApproving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not undo approval.");
      return;
    }
    const data = await res.json();
    setMessage(data.message || "Approval undone.");
    load(emailId, { silent: true });
  }

  async function approveOneEmail(emailId: string) {
    const name = authorName.trim();
    if (!isFullName(name)) {
      setError("Enter your first and last name above to approve.");
      return;
    }
    const noun = kindNoun(emails.find((e) => e.id === emailId)?.kind ?? "email");
    if (
      !confirm(
        `Approve this ${noun}? This tells the team this one is good to go.`
      )
    ) {
      return;
    }
    setApproving(true);
    setError("");
    setMessage("");
    localStorage.setItem("cd_reviewer_name", name);
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approveEmail: emailId, approverName: name }),
    });
    setApproving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not approve this email.");
      return;
    }
    const data = await res.json();
    setMessage(data.message || "Email approved.");
    load(emailId, { silent: true });
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!activeEmail) return;
    setSubmitting(true);
    setFormError("");
    setFormMessage("");

    if (mode === "pin" && !pendingPin) {
      setFormError("Click on the email to place a pin first.");
      setSubmitting(false);
      return;
    }

    if (!body.trim() && images.length === 0) {
      setFormError("Add a comment or attach an image.");
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
        type: pendingQuote || mode === "pin" ? "inline" : "general",
        pinX: pendingPin?.x,
        pinY: pendingPin?.y,
        quoteText: pendingQuote?.text,
        quoteOrdinal: pendingQuote?.ordinal,
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
      setFormError(data.error || "Could not post comment.");
      return;
    }

    setBody("");
    setPendingPin(null);
    setPendingQuote(null);
    setImages([]);
    setFormMessage("Feedback sent. Thank you.");
    load(activeEmail.id, { silent: true });
  }

  async function approveEmail() {
    const name = authorName.trim();
    if (!isFullName(name)) {
      setError("Enter your first and last name above to approve.");
      return;
    }
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
    localStorage.setItem("cd_reviewer_name", name);
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markApproved: true, approverName: name }),
    });
    setApproving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not approve this email.");
      return;
    }
    setMessage("Got it. The email team has been notified this is approved.");
    load(activeEmailId, { silent: true });
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
  // Copy adapts per item so a blog/deck/mock-up isn't called an "email".
  const activeDoc = renderAssetDoc(activeEmail);
  const itemNoun = kindNoun(activeEmail.kind ?? "email");
  const isAutomation = coercePresentation(campaign.presentation) === "automation";

  return (
    <div className="app-shell review-page">
      <header className="topbar">
        <Brand />
        <StatusBadge
          status={campaign.status}
          approvedChannel={
            campaign.internally_approved
              ? "internal"
              : campaign.status === "approved"
                ? "client"
                : null
          }
        />
      </header>

      <main className="container container-wide stack">
        <div className="rv-hero">
          <div>
            <p className="eyebrow">{isAutomation ? "Automation review" : "Review"}</p>
            <h1 className="h1">{campaign.title}</h1>
          </div>
          <p className="rv-meta">
            {campaign.client_name ? (
              <>
                <span>{campaign.client_name}</span>
                <span className="rv-meta-dot" aria-hidden />
              </>
            ) : null}
            <span>
              {emails.length} {isAutomation ? "email" : "item"}
              {emails.length === 1 ? "" : "s"}
              {isAutomation ? " in this automation" : ""}
            </span>
            <span className="rv-meta-dot" aria-hidden />
            <span>
              Updated {new Date(campaign.updated_at).toLocaleString()}
            </span>
          </p>
          {campaign.description ? (
            <p className="rv-hero-desc">{campaign.description}</p>
          ) : isAutomation ? (
            <p className="rv-hero-desc">
              Follow the path from the trigger through each wait and email.
              Click an email to preview it.
            </p>
          ) : null}
        </div>

        {isAutomation ? (
          <div className="card card-pad am-map-card">
            <AutomationMap
              triggerLabel={campaign.trigger_label}
              triggerKind={campaign.trigger_kind}
              emails={emails.map((email) => ({
                id: email.id,
                title: email.title,
                kind: email.kind,
                delay_ms: email.delay_ms,
                approved_at: email.approved_at,
                open_comments: email.open_comments,
                purpose: email.purpose,
                subject:
                  email.subjects?.find((s) => s.id === email.chosen_subject_id)
                    ?.subject ||
                  email.subjects?.[0]?.subject ||
                  null,
              }))}
              steps={flow}
              selectedId={previewOpen ? activeEmail.id : null}
              previewHint
              onSelectStep={(_stepId, emailId) => {
                if (!emailId) return;
                selectEmail(emailId);
                setPreviewOpen(true);
              }}
            />
          </div>
        ) : emails.length > 1 ? (
          <div className="card rv-switch">
            <span className="rv-switch-count">
              {itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1)}{" "}
              {activeIndex + 1} of {emails.length}
            </span>
            <div className="rv-switch-tabs">
              {emails.map((email, index) => (
                <button
                  key={email.id}
                  type="button"
                  className={`email-tab ${
                    email.id === activeEmail.id ? "active" : ""
                  } ${email.approved_at ? "is-done" : ""}`}
                  onClick={() => selectEmail(email.id)}
                >
                  <span className="email-tab-num">
                    {email.approved_at ? "✓" : index + 1}
                  </span>
                  <span className="email-tab-label">{email.title}</span>
                </button>
              ))}
            </div>
            <div className="rv-switch-nav">
              <button
                className="rv-step"
                aria-label={`Previous ${itemNoun}`}
                disabled={activeIndex <= 0}
                onClick={() => selectEmail(emails[activeIndex - 1].id)}
              >
                ‹
              </button>
              <button
                className="rv-step"
                aria-label={`Next ${itemNoun}`}
                disabled={activeIndex >= emails.length - 1}
                onClick={() => selectEmail(emails[activeIndex + 1].id)}
              >
                ›
              </button>
            </div>
          </div>
        ) : null}

        {locked ? (
          <div className="rv-approve is-approved">
            <div className="rv-approve-with-check">
              <span className="rv-approve-check" aria-hidden>
                ✓
              </span>
              <div className="rv-approve-copy">
                <span className="rv-approve-title">This campaign is approved.</span>
                <p className="rv-approve-sub">
                  {campaign.approved_by
                    ? `Approved by ${campaign.approved_by}. `
                    : ""}
                  The email team has been notified and feedback is now closed.
                  You can still read every item and all prior comments.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rv-approve">
            <div className="rv-approve-copy">
              <span className="rv-approve-title">
                {campaign.internally_approved
                  ? "Approved internally, waiting for your approval"
                  : "Ready to approve?"}
              </span>
              <p className="rv-approve-sub">
                {campaign.internally_approved
                  ? "The team has signed off internally. This still needs your approval before it is client-approved."
                  : `This covers every ${isAutomation ? "email in the automation" : "item in the package"}. Type your full name to confirm it is you.`}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="plan-name-input"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your full name"
              />
              <button
                className="btn btn-approve"
                onClick={approveEmail}
                disabled={approving || !isFullName(authorName)}
              >
                {approving ? "Sending..." : "Approve and notify email team"}
              </button>
            </div>
          </div>
        )}

        {message ? <p className="rv-notice rv-notice-ok">{message}</p> : null}
        {error ? <p className="rv-notice rv-notice-bad">{error}</p> : null}

        {isAutomation && !previewOpen ? null : (
        <div
          className={isAutomation ? "modal-backdrop" : undefined}
          role={isAutomation ? "dialog" : undefined}
          aria-modal={isAutomation ? true : undefined}
          aria-label={isAutomation ? "Email preview" : undefined}
          onClick={isAutomation ? () => setPreviewOpen(false) : undefined}
        >
          <div
            className={isAutomation ? "card card-pad am-preview-modal" : undefined}
            onClick={isAutomation ? (e) => e.stopPropagation() : undefined}
          >
            {isAutomation ? (
              <div className="am-preview-head">
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    Email preview
                  </p>
                  <h2 className="h2" style={{ margin: "4px 0 0" }}>
                    {activeEmail.title}
                  </h2>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPreviewOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : null}

        <div className="split-review">
          <div className="stack">
            <div className="rv-asset-head">
              <h2 className="h2">{activeEmail.title}</h2>
              {activeEmail.approved_at ? (
                <div className="rv-asset-actions">
                  <span className="badge badge-approved">
                    {activeEmail.approved_by
                      ? `Approved by ${activeEmail.approved_by}`
                      : "Approved"}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => unapproveOneEmail(activeEmail.id)}
                    disabled={approving}
                  >
                    Undo
                  </button>
                </div>
              ) : !locked ? (
                <div className="rv-asset-actions">
                  <button
                    className="btn btn-approve btn-sm"
                    onClick={() => approveOneEmail(activeEmail.id)}
                    disabled={approving || !isFullName(authorName)}
                    title={
                      isFullName(authorName)
                        ? undefined
                        : "Type your full name in the approve box above first."
                    }
                  >
                    Approve this {itemNoun}
                  </button>
                </div>
              ) : null}
            </div>

            {!locked ? (
              <div className="rv-modebar">
                <div className="rv-segment">
                  <button
                    type="button"
                    className={mode === "general" ? "active" : ""}
                    onClick={() => {
                      setMode("general");
                      setPendingPin(null);
                    }}
                  >
                    General comment
                  </button>
                  <button
                    type="button"
                    className={mode === "pin" ? "active" : ""}
                    onClick={() => {
                      setMode("pin");
                      setPendingQuote(null);
                    }}
                  >
                    Pin on {itemNoun}
                  </button>
                </div>
                {mode === "pin" ? (
                  <span className={`rv-hint ${pendingPin ? "is-ready" : ""}`}>
                    {pendingPin
                      ? "Pin placed. Write your note on the right."
                      : `Click anywhere on the ${itemNoun} to drop a pin.`}
                  </span>
                ) : (
                  <span className={`rv-hint ${pendingQuote ? "is-ready" : ""}`}>
                    {pendingQuote
                      ? "Passage highlighted. Write your note on the right."
                      : "Select any copy in the preview to comment on that line."}
                  </span>
                )}
              </div>
            ) : null}

            <EmailPreview
              html={activeDoc.html}
              interactive={activeDoc.interactive}
              pins={[
                ...emailComments,
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
              pendingQuote={pendingQuote}
              onSelectQuote={
                locked
                  ? undefined
                  : (quote) => {
                      setPendingQuote(quote);
                      setPendingPin(null);
                      setMode("general");
                      setActivePinId(null);
                      requestAnimationFrame(() => bodyRef.current?.focus());
                    }
              }
              packageNav={
                emails.length > 1
                  ? {
                      items: emails.map((email) => ({
                        id: email.id,
                        title: email.title,
                      })),
                      activeId: activeEmail.id,
                      onSelect: selectEmail,
                      itemLabel: itemNoun,
                    }
                  : undefined
              }
            />

            {activeEmail.subjects && activeEmail.subjects.length > 0 ? (
              <div className="card card-pad stack">
                <div>
                  <h2 className="h2">Pick a subject line</h2>
                  <p className="rv-form-sub">
                    Choose the subject line and preview text you want to send.
                    {locked ? "" : " Tap one to select it."}
                  </p>
                </div>
                <div className="subject-options">
                  {activeEmail.subjects.map((s) => {
                    const chosen = activeEmail.chosen_subject_id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`subject-option ${chosen ? "chosen" : ""}`}
                        disabled={locked}
                        onClick={() => chooseSubject(activeEmail.id, s.id)}
                      >
                        <span className="subject-radio" aria-hidden>
                          {chosen ? "●" : "○"}
                        </span>
                        <span className="subject-text">
                          <span className="subject-line">
                            {s.subject || "(no subject)"}
                          </span>
                          {s.preview_text ? (
                            <span className="subject-preview">
                              {s.preview_text}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <EmailLinks html={activeDoc.html} />
          </div>

          <div className="rv-rail">
            {!locked ? (
              <form className="card card-pad stack" onSubmit={submitComment}>
                <div>
                  <h2 className="h2">
                    {pendingQuote
                      ? "Comment on this copy"
                      : mode === "pin"
                        ? "Pinned feedback"
                        : "General feedback"}
                  </h2>
                  <p className="rv-form-sub">
                    Commenting on <strong>{activeEmail.title}</strong>
                  </p>
                </div>

                {pendingQuote ? (
                  <div className="comment-quote-pending">
                    <blockquote className="comment-quote">
                      {pendingQuote.text}
                    </blockquote>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPendingQuote(null)}
                    >
                      Clear highlight
                    </button>
                  </div>
                ) : null}

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
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={
                      pendingQuote
                        ? "What should change in this copy?"
                        : mode === "pin"
                        ? "What should change at this spot?"
                        : "Overall thoughts, tone, offer, CTA..."
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Attach images{" "}
                    <span className="rv-label-note">
                      (optional, up to {MAX_IMAGES})
                    </span>
                  </label>
                  {images.length > 0 ? (
                    <div className="rv-thumbs">
                      {images.map((img) => (
                        <div key={img.id} className="rv-thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.dataUrl} alt="attachment preview" />
                          <button
                            type="button"
                            className="rv-thumb-x"
                            onClick={() => removeImage(img.id)}
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {images.length < MAX_IMAGES ? (
                    <label
                      className={`rv-filepick ${imgBusy ? "is-busy" : ""}`}
                    >
                      {imgBusy
                        ? "Processing images..."
                        : images.length > 0
                          ? "Add another image"
                          : "Choose images"}
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
                    </label>
                  ) : null}
                </div>

                {formError ? (
                  <p className="rv-notice rv-notice-bad">{formError}</p>
                ) : null}
                {formMessage ? (
                  <p className="rv-notice rv-notice-ok">{formMessage}</p>
                ) : null}

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
              <h2 className="h2">Comments on this {itemNoun}</h2>
              {emailComments.length === 0 ? (
                <div className="empty">No comments on this {itemNoun} yet.</div>
              ) : (
                <div className="comment-list">
                  {emailComments.map((c) => {
                    const pinNumber =
                      c.type === "inline" && c.pin_x !== null
                        ? inlinePins.findIndex((p) => p.id === c.id) + 1
                        : 0;
                    const quoteNumber = isCopyQuote(c)
                      ? quoteComments.findIndex((q) => q.id === c.id) + 1
                      : 0;
                    return (
                      <div
                        key={c.id}
                        className={`comment-card ${c.resolved ? "resolved" : ""} ${
                          activePinId === c.id ? "active" : ""
                        } ${c.type === "inline" ? "is-pinned" : ""}`}
                        onClick={() =>
                          (c.type === "inline" || isCopyQuote(c)) &&
                          setActivePinId(c.id)
                        }
                      >
                        <div className="rv-comment-head">
                          <span className="rv-avatar" aria-hidden>
                            {initials(c.author_name)}
                          </span>
                          <span className="rv-comment-who">
                            <span className="rv-comment-name">
                              {c.author_name}
                            </span>
                            <span className="rv-comment-when">
                              {new Date(c.created_at).toLocaleString()}
                            </span>
                          </span>
                          {c.resolved ? (
                            <span className="rv-chip is-resolved">Resolved</span>
                          ) : isCopyQuote(c) ? (
                            <span className="rv-chip is-quote">
                              Highlight {quoteNumber}
                            </span>
                          ) : c.type === "inline" ? (
                            <span className="rv-chip is-pin">
                              Pin {pinNumber}
                            </span>
                          ) : (
                            <span className="rv-chip">General</span>
                          )}
                        </div>

                        {isCopyQuote(c) ? (
                          <blockquote className="comment-quote">
                            {c.quote_text}
                          </blockquote>
                        ) : null}

                        {c.body ? (
                          <div className="comment-body">{c.body}</div>
                        ) : null}

                        {c.attachments && c.attachments.length > 0 ? (
                          <div className="rv-attachments">
                            {c.attachments.map((a) => (
                              <a
                                key={a.id}
                                href={`/api/attachments/${a.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/attachments/${a.id}`}
                                  alt="feedback attachment"
                                />
                              </a>
                            ))}
                          </div>
                        ) : null}

                        {c.replies && c.replies.length > 0 ? (
                          <div className="reply-thread">
                            {c.replies.map((r) => (
                              <div
                                key={r.id}
                                className={`reply ${r.is_admin ? "reply-admin" : ""}`}
                              >
                                <div className="reply-head">
                                  {r.author_name}
                                  {r.is_admin ? " · Team" : ""} ·{" "}
                                  {new Date(r.created_at).toLocaleString()}
                                </div>
                                <div className="reply-body">{r.body}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {!locked ? (
                          <div
                            className="reply-form"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              value={replyDrafts[c.id] || ""}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value,
                                }))
                              }
                              placeholder="Reply..."
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  submitReply(c.id);
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={
                                replyingId === c.id ||
                                !(replyDrafts[c.id] || "").trim()
                              }
                              onClick={() => submitReply(c.id)}
                            >
                              {replyingId === c.id ? "..." : "Reply"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
