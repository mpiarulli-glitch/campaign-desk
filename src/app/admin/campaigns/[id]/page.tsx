"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { EmailPreview } from "@/components/EmailPreview";
import { EmailLinks } from "@/components/EmailLinks";
import { StatusBadge } from "@/components/StatusBadge";

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
  resolved: number;
  created_at: string;
  attachments?: Attachment[];
  replies?: Reply[];
};

type Version = {
  id: string;
  email_id?: string | null;
  note: string;
  created_at: string;
};

type SubjectOption = {
  id: string;
  subject: string;
  preview_text: string;
};

type EmailItem = {
  id: string;
  title: string;
  html_content: string;
  sort_order: number;
  open_comments: number;
  approved_at?: string | null;
  chosen_subject_id?: string | null;
  subjects?: SubjectOption[];
};

type Campaign = {
  id: string;
  title: string;
  client_name: string;
  description: string;
  status: string;
  magic_token: string;
  updated_at: string;
  review_url: string;
  open_comments: number;
  email_count?: number;
};

export default function AdminCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [emailTitleDraft, setEmailTitleDraft] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [status, setStatus] = useState("draft");
  const [tab, setTab] = useState<"feedback" | "html" | "versions">("feedback");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [newEmailTitle, setNewEmailTitle] = useState("");
  const [newEmailHtml, setNewEmailHtml] = useState("");
  const [aiLoadingCommentId, setAiLoadingCommentId] = useState<string | null>(
    null
  );
  const [aiChat, setAiChat] = useState<{
    commentId: string;
    emailId: string;
    originalHtml: string;
    currentHtml: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    model: string;
  } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [subjectRows, setSubjectRows] = useState<
    { subject: string; preview: string }[]
  >([]);
  const [savingSubjects, setSavingSubjects] = useState(false);

  async function submitReply(commentId: string) {
    const text = (replyDrafts[commentId] || "").trim();
    if (!text) return;
    setReplyingId(commentId);
    const res = await fetch(`/api/campaigns/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, body: text }),
    });
    setReplyingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not send reply.");
      return;
    }
    setReplyDrafts((prev) => ({ ...prev, [commentId]: "" }));
    load(activeEmailId);
  }

  async function load(preferredEmailId?: string | null) {
    const res = await fetch(`/api/campaigns/${id}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Campaign not found.");
      return;
    }
    const data = await res.json();
    setCampaign(data.campaign);
    setEmails(data.emails || []);
    setComments(data.comments || []);
    setVersions(data.versions || []);
    setStatus(data.campaign.status);

    const nextId =
      preferredEmailId &&
      (data.emails || []).some((e: EmailItem) => e.id === preferredEmailId)
        ? preferredEmailId
        : activeEmailId &&
            (data.emails || []).some((e: EmailItem) => e.id === activeEmailId)
          ? activeEmailId
          : data.emails?.[0]?.id || null;

    setActiveEmailId(nextId);
    const active = (data.emails || []).find((e: EmailItem) => e.id === nextId);
    if (active) {
      setHtmlDraft(active.html_content);
      setEmailTitleDraft(active.title);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const activeEmail = useMemo(
    () => emails.find((e) => e.id === activeEmailId) || emails[0] || null,
    [emails, activeEmailId]
  );

  // Keep the subject editor in sync with whichever email is active.
  useEffect(() => {
    const subs = activeEmail?.subjects || [];
    setSubjectRows(
      subs.length
        ? subs.map((s) => ({ subject: s.subject, preview: s.preview_text }))
        : [{ subject: "", preview: "" }]
    );
  }, [activeEmail?.id, activeEmail?.subjects]);

  async function toggleEmailApproved(approved: boolean) {
    if (!activeEmail) return;
    setSaving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setEmailApproved: { emailId: activeEmail.id, approved },
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update approval.");
      return;
    }
    const data = await res.json();
    if (data.emails) setEmails(data.emails);
    setMessage(approved ? "Email approved." : "Approval removed.");
  }

  async function saveSubjects() {
    if (!activeEmail) return;
    setSavingSubjects(true);
    setError("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setEmailSubjects: { emailId: activeEmail.id, options: subjectRows },
      }),
    });
    setSavingSubjects(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save subject lines.");
      return;
    }
    const data = await res.json();
    if (data.emails) setEmails(data.emails);
    setMessage("Subject lines saved.");
  }

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

  const openCount = comments.filter((c) => !c.resolved).length;
  const openOnActive = emailComments.filter((c) => !c.resolved).length;
  const unresolvedComments = emailComments.filter((c) => !c.resolved);
  const canMarkRevisionDone =
    status === "needs_changes" || openCount > 0 || status === "draft";
  const isApproved = status === "approved";

  function selectEmail(emailId: string) {
    setActiveEmailId(emailId);
    setActivePinId(null);
    setAiChat(null);
    setChatInput("");
    const email = emails.find((e) => e.id === emailId);
    if (email) {
      setHtmlDraft(email.html_content);
      setEmailTitleDraft(email.title);
    }
  }

  async function copyLink() {
    if (!campaign?.review_url) return;
    await navigator.clipboard.writeText(campaign.review_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveStatus(next: string) {
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not update status.");
      return;
    }
    setStatus(next);
    setMessage("Status updated.");
    load(activeEmailId);
  }

  async function saveHtml(e: FormEvent) {
    e.preventDefault();
    if (!activeEmail) return;
    setSaving(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/campaigns/${id}/emails`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailId: activeEmail.id,
        title: emailTitleDraft,
        htmlContent: htmlDraft,
        versionNote: versionNote || "Manual revision",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save HTML.");
      return;
    }
    setVersionNote("");
    setMessage("Revision saved for this email. Same review link stays live.");
    setTab("feedback");
    load(activeEmail.id);
  }

  async function toggleResolved(comment: Comment) {
    const res = await fetch(`/api/campaigns/${id}/comments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commentId: comment.id,
        resolved: !comment.resolved,
      }),
    });
    if (res.ok) load(activeEmailId);
  }

  async function runAiRevision(comment: Comment) {
    if (!activeEmail) return;
    setAiLoadingCommentId(comment.id);
    setError("");
    setMessage("");
    setAiChat(null);
    setChatInput("");

    const res = await fetch(`/api/campaigns/${id}/ai-revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commentId: comment.id,
        emailId: activeEmail.id,
      }),
    });

    setAiLoadingCommentId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "AI revision failed.");
      return;
    }

    const data = await res.json();
    setAiChat({
      commentId: comment.id,
      emailId: data.emailId,
      originalHtml: data.originalHtml,
      currentHtml: data.revisedHtml,
      messages: [
        { role: "user", content: comment.body },
        { role: "assistant", content: data.revisedHtml },
      ],
      model: data.model,
    });
    setMessage("AI drafted a revision. Scroll down in the card below to add more feedback and generate another version before applying.");
  }

  async function runAllAiRevisions() {
    const unresolved = emailComments.filter((c) => !c.resolved);
    if (unresolved.length === 0) return;

    const combinedFeedback = unresolved
      .map((c) => `${c.body} (from ${c.author_name})`)
      .join("\n\n");

    setAiLoadingCommentId("all");
    setError("");
    setMessage("");
    setAiChat(null);
    setChatInput("");

    const first = unresolved[0];

    const res = await fetch(`/api/campaigns/${id}/ai-revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commentId: first.id,
        emailId: activeEmail.id,
        feedback: combinedFeedback,
      }),
    });

    setAiLoadingCommentId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "AI failed to revise all feedback.");
      return;
    }

    const data = await res.json();
    setAiChat({
      commentId: first.id,
      emailId: data.emailId,
      originalHtml: data.originalHtml,
      currentHtml: data.revisedHtml,
      messages: [
        { role: "user" as const, content: "All open feedback combined:\n" + combinedFeedback },
        { role: "assistant" as const, content: data.revisedHtml },
      ],
      model: data.model,
    });
    setMessage("AI generated one revision addressing ALL open feedback. Scroll down to add more instructions or apply.");
  }

  async function sendFollowUp() {
    if (!aiChat || !chatInput.trim()) return;

    const feedback = chatInput.trim();
    setChatLoading(true);
    setError("");

    const history = aiChat.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const res = await fetch(`/api/campaigns/${id}/ai-revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        continue: true,
        emailId: aiChat.emailId,
        history,
        newFeedback: feedback,
      }),
    });

    setChatLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "AI follow-up failed.");
      return;
    }

    const data = await res.json();
    const newMessages = [
      ...aiChat.messages,
      { role: "user" as const, content: feedback },
      { role: "assistant" as const, content: data.revisedHtml },
    ];

    setAiChat({
      ...aiChat,
      currentHtml: data.revisedHtml,
      messages: newMessages,
    });
    setChatInput("");
  }

  async function applyAiRevision() {
    if (!aiChat) return;
    setSaving(true);
    setError("");
    setMessage("");

    const res = await fetch(`/api/campaigns/${id}/ai-revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apply: true,
        emailId: aiChat.emailId,
        commentId: aiChat.commentId,
        revisedHtml: aiChat.currentHtml,
        versionNote: "AI revision",
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not apply AI revision.");
      return;
    }

    setAiChat(null);
    setChatInput("");
    setMessage("AI revision applied and feedback marked done.");
    load(aiChat.emailId);
  }

  function discardAiChat() {
    setAiChat(null);
    setChatInput("");
  }

  async function markRevisionDone() {
    setSaving(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markRevisionDone: true }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not mark revision done.");
      return;
    }
    setStatus("in_review");
    setMessage(
      "Revision marked done. All feedback resolved and package is ready for re-review."
    );
    load(activeEmailId);
  }

  async function markApproved() {
    setSaving(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markApproved: true }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not approve campaign.");
      return;
    }
    setStatus("approved");
    setMessage(
      "Approved. The email team has been notified and feedback is closed on the review link."
    );
    load(activeEmailId);
  }

  async function addEmail(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/campaigns/${id}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newEmailTitle || `Email ${emails.length + 1}`,
        htmlContent: newEmailHtml,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add email.");
      return;
    }
    const data = await res.json();
    setAddingEmail(false);
    setNewEmailTitle("");
    setNewEmailHtml("");
    setMessage("Email added to this review package.");
    await load(data.email?.id);
    setTab("feedback");
  }

  async function removeActiveEmail() {
    if (!activeEmail) return;
    if (emails.length <= 1) {
      setError("A package must keep at least one email.");
      return;
    }
    if (!confirm(`Remove "${activeEmail.title}" from this package?`)) return;
    const res = await fetch(`/api/campaigns/${id}/emails`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: activeEmail.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove email.");
      return;
    }
    setMessage("Email removed.");
    load(null);
  }

  async function removeCampaign() {
    if (!confirm("Delete this campaign and all feedback?")) return;
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin");
  }

  if (error && !campaign) {
    return (
      <div className="container">
        <p className="error">{error}</p>
        <Link href="/admin">Back to campaigns</Link>
      </div>
    );
  }

  if (!campaign || !activeEmail) {
    return (
      <div className="container">
        <p className="muted">Loading campaign...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <StatusBadge status={status} />
          <Link className="btn btn-ghost btn-sm" href="/admin">
            All campaigns
          </Link>
        </div>
      </header>

      <main className="container container-wide stack">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <p className="eyebrow">Review package</p>
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
          <div className="toolbar">
            {canMarkRevisionDone ? (
              <button className="btn" onClick={markRevisionDone} disabled={saving}>
                {saving ? "Saving..." : "Mark revision done"}
              </button>
            ) : null}
            {!isApproved ? (
              <button
                className="btn btn-approve"
                onClick={markApproved}
                disabled={saving}
              >
                {saving ? "Saving..." : "Approve and notify email team"}
              </button>
            ) : null}
            <select
              value={status}
              onChange={(e) => saveStatus(e.target.value)}
              disabled={saving}
              className="select-clean"
            >
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="needs_changes">Needs changes</option>
              <option value="approved">Approved</option>
            </select>
            <button className="btn btn-danger btn-sm" onClick={removeCampaign}>
              Delete
            </button>
          </div>
        </div>

        <div className="card card-pad stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Emails in this package</strong>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setAddingEmail((v) => !v)}
            >
              {addingEmail ? "Cancel" : "Add email"}
            </button>
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
                <span className="email-tab-num">
                  {email.approved_at ? "✓" : index + 1}
                </span>
                <span className="email-tab-label">{email.title}</span>
                {email.open_comments > 0 ? (
                  <span className="email-tab-badge">{email.open_comments}</span>
                ) : null}
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Reviewers get one magic link and can toggle between these emails.
            Approval covers the whole package.
          </p>

          {addingEmail ? (
            <form className="stack" onSubmit={addEmail} style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="newEmailTitle">Email title</label>
                <input
                  id="newEmailTitle"
                  value={newEmailTitle}
                  onChange={(e) => setNewEmailTitle(e.target.value)}
                  placeholder={`Email ${emails.length + 1}`}
                />
              </div>
              <div className="field">
                <label htmlFor="newEmailHtml">HTML</label>
                <textarea
                  id="newEmailHtml"
                  value={newEmailHtml}
                  onChange={(e) => setNewEmailHtml(e.target.value)}
                  style={{ minHeight: 180, fontFamily: "var(--mono)", fontSize: 12 }}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Adding..." : "Add email to package"}
              </button>
            </form>
          ) : null}
        </div>

        {canMarkRevisionDone ? (
          <div className="card card-pad revision-done-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Finished the changes?</strong>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                  Marks all open feedback resolved and sets status to In review
                  so your boss can check the update.
                </p>
              </div>
              <button className="btn" onClick={markRevisionDone} disabled={saving}>
                {saving ? "Saving..." : "Mark revision done"}
              </button>
            </div>
          </div>
        ) : null}

        {!isApproved ? (
          <div className="card card-pad approve-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Ready to approve?</strong>
                <p
                  className="muted"
                  style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55 }}
                >
                  Click this button and let the email team know this is approved.
                  That resolves open feedback and closes new comments on the
                  review link.
                </p>
              </div>
              <button
                className="btn btn-approve"
                onClick={markApproved}
                disabled={saving}
              >
                {saving ? "Saving..." : "Approve and notify email team"}
              </button>
            </div>
          </div>
        ) : (
          <div className="card card-pad approve-card is-approved">
            <strong>This package is approved.</strong>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              The email team has been notified. Feedback is closed. Change the
              status dropdown if you need to reopen it.
            </p>
          </div>
        )}

        <div className="card card-pad stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Magic review link</strong>
            <button className="btn btn-secondary btn-sm" onClick={copyLink}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="copy-box">
            <code>{campaign.review_url}</code>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            One link for the whole package. Your boss can toggle emails inside it.
          </p>
        </div>

        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {aiChat ? (
          <div className="card card-pad stack ai-preview-card">
            <div style={{ background: "#fff3cd", color: "#664d03", padding: "6px 10px", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
              ⚠️ AI revisions use paid API credits (per-token). Each revision or follow-up costs money. Use sparingly.
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <p className="eyebrow">AI revision</p>
                <strong>Iterate with AI — keep giving feedback</strong>
              </div>
              <div className="row">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={discardAiChat}
                  disabled={saving || chatLoading}
                >
                  Discard
                </button>
                <button
                  className="btn btn-sm"
                  onClick={applyAiRevision}
                  disabled={saving || chatLoading}
                >
                  {saving ? "Applying..." : "Apply this version"}
                </button>
              </div>
            </div>

            {/* Follow-up input — right after buttons, very obvious */}
            <div className="stack" style={{ background: "#f0f4ff", border: "3px solid #5a3fcf", borderRadius: 6, padding: 16, marginBottom: 12 }}>
              <strong style={{ fontSize: 16, color: "#5a3fcf" }}>Talk to AI to make more revisions</strong>
              <div className="row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !chatLoading) sendFollowUp();
                  }}
                  placeholder="E.g. make the headline shorter, strengthen the CTA, remove the last line..."
                  style={{ flex: 1, fontSize: 14 }}
                  disabled={chatLoading}
                />
                <button
                  className="btn btn-sm"
                  onClick={sendFollowUp}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? "Generating..." : "Send to AI for new revision"}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Type more instructions below and click send to generate an updated version. You can iterate multiple times before applying.
              </p>
            </div>

            <div className="split-review">
              <div className="stack">
                <h2 className="h2">Current</h2>
                <EmailPreview html={activeEmail.html_content} />
              </div>
              <div className="stack">
                <h2 className="h2">Latest AI version</h2>
                <EmailPreview html={aiChat.currentHtml} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="tabs">
          <button
            className={`tab ${tab === "feedback" ? "active" : ""}`}
            onClick={() => setTab("feedback")}
          >
            Feedback ({emailComments.length}
            {openOnActive ? ` · ${openOnActive} open` : ""})
          </button>
          <button
            className={`tab ${tab === "html" ? "active" : ""}`}
            onClick={() => setTab("html")}
          >
            Revise HTML
          </button>
          <button
            className={`tab ${tab === "versions" ? "active" : ""}`}
            onClick={() => setTab("versions")}
          >
            Versions ({versions.length})
          </button>
        </div>

        {tab === "feedback" ? (
          <div className="split-review">
            <div className="stack">
              <EmailPreview
                html={activeEmail.html_content}
                pins={inlinePins}
                activePinId={activePinId}
                onSelectPin={setActivePinId}
              />
              <EmailLinks html={activeEmail.html_content} />

              <div className="card card-pad stack">
                <h2 className="h2" style={{ margin: 0 }}>
                  Subject lines & preview text
                </h2>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Add the options the client will choose from on the review
                  page.
                  {activeEmail.chosen_subject_id
                    ? " The client has picked one (highlighted below)."
                    : ""}
                </p>
                {subjectRows.map((row, i) => {
                  const savedId = activeEmail.subjects?.[i]?.id;
                  const isChosen =
                    !!savedId && savedId === activeEmail.chosen_subject_id;
                  return (
                    <div
                      key={i}
                      className="subject-editor-row"
                      style={{
                        borderColor: isChosen ? "#16a34a" : undefined,
                      }}
                    >
                      <div className="subject-editor-fields">
                        <input
                          value={row.subject}
                          placeholder={`Subject option ${i + 1}`}
                          onChange={(e) =>
                            setSubjectRows((rows) =>
                              rows.map((r, j) =>
                                j === i ? { ...r, subject: e.target.value } : r
                              )
                            )
                          }
                        />
                        <input
                          value={row.preview}
                          placeholder="Preview text"
                          onChange={(e) =>
                            setSubjectRows((rows) =>
                              rows.map((r, j) =>
                                j === i ? { ...r, preview: e.target.value } : r
                              )
                            )
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setSubjectRows((rows) =>
                            rows.filter((_, j) => j !== i)
                          )
                        }
                        aria-label="Remove option"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setSubjectRows((rows) => [
                        ...rows,
                        { subject: "", preview: "" },
                      ])
                    }
                  >
                    Add option
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={saveSubjects}
                    disabled={savingSubjects}
                  >
                    {savingSubjects ? "Saving..." : "Save subject lines"}
                  </button>
                </div>
              </div>
            </div>
            <div className="card card-pad stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 className="h2">{activeEmail.title}</h2>
                {activeEmail.approved_at ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleEmailApproved(false)}
                    disabled={saving}
                  >
                    Un-approve email
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleEmailApproved(true)}
                    disabled={saving}
                  >
                    Approve email
                  </button>
                )}
                {openCount > 0 ? (
                  <button
                    className="btn btn-sm"
                    onClick={markRevisionDone}
                    disabled={saving}
                  >
                    Mark revision done
                  </button>
                ) : null}
                {unresolvedComments.length > 0 ? (
                  <button
                    className="btn btn-sm"
                    onClick={runAllAiRevisions}
                    disabled={
                      saving || aiLoadingCommentId !== null || isApproved
                    }
                  >
                    {aiLoadingCommentId === "all"
                      ? "AI is revising all..."
                      : "Use AI to make all revisions"}
                  </button>
                ) : null}
              </div>
              {openOnActive > 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {openOnActive} open item{openOnActive === 1 ? "" : "s"} on this
                  email
                </p>
              ) : null}
              {emailComments.length === 0 ? (
                <div className="empty">
                  No feedback on this email yet. Share the magic link.
                </div>
              ) : (
                <div className="comment-list">
                  {emailComments.map((c, index) => (
                    <div
                      key={c.id}
                      className={`comment-card ${c.resolved ? "resolved" : ""} ${
                        activePinId === c.id ? "active" : ""
                      }`}
                      onClick={() => c.type === "inline" && setActivePinId(c.id)}
                    >
                      <div className="comment-head">
                        <span>
                          {c.author_name}
                          {c.type === "inline"
                            ? ` · Pin ${index + 1}`
                            : " · General"}
                          {c.resolved ? " · Done" : ""}
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

                      {c.replies && c.replies.length > 0 ? (
                        <div className="reply-thread">
                          {c.replies.map((r) => (
                            <div
                              key={r.id}
                              className={`reply ${r.is_admin ? "reply-admin" : ""}`}
                            >
                              <div className="reply-head">
                                {r.author_name}
                                {r.is_admin ? " · Team" : " · Client"} ·{" "}
                                {new Date(r.created_at).toLocaleString()}
                              </div>
                              <div className="reply-body">{r.body}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}

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
                          placeholder="Reply to the client..."
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

                      <div className="row" style={{ marginTop: 10 }}>
                         {!c.resolved ? (
                           <button
                             className="btn btn-sm"
                             onClick={(e) => {
                               e.stopPropagation();
                               runAiRevision(c);
                             }}
                              disabled={
                                saving ||
                                aiLoadingCommentId === c.id ||
                                isApproved ||
                                aiLoadingCommentId === "all"
                              }
                           >
{aiLoadingCommentId === c.id
                                ? "AI is revising..."
                                : "Use AI to make revision"}
                           </button>
                         ) : null}
                         <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>costs API credits</span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleResolved(c);
                          }}
                        >
                          {c.resolved ? "Reopen" : "Mark done"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "html" ? (
          <form className="card card-pad stack" onSubmit={saveHtml}>
            <p className="muted" style={{ margin: 0 }}>
              Editing: <strong>{activeEmail.title}</strong>. Save creates a new
              version for this email only.
            </p>
            <div className="field">
              <label htmlFor="emailTitle">Email title</label>
              <input
                id="emailTitle"
                value={emailTitleDraft}
                onChange={(e) => setEmailTitleDraft(e.target.value)}
                placeholder="Email 2 subject / label"
              />
            </div>
            <div className="field">
              <label htmlFor="versionNote">What changed?</label>
              <input
                id="versionNote"
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
                placeholder="Fixed headline and CTA color"
              />
            </div>
            <div className="field">
              <label htmlFor="html">HTML</label>
              <textarea
                id="html"
                value={htmlDraft}
                onChange={(e) => setHtmlDraft(e.target.value)}
                style={{ minHeight: 360, fontFamily: "var(--mono)", fontSize: 12 }}
                required
              />
            </div>
            <div className="row">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save revision"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (htmlDraft !== activeEmail.html_content) {
                    setSaving(true);
                    setError("");
                    const saveRes = await fetch(`/api/campaigns/${id}/emails`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        emailId: activeEmail.id,
                        title: emailTitleDraft,
                        htmlContent: htmlDraft,
                        versionNote: versionNote || "Manual revision",
                      }),
                    });
                    setSaving(false);
                    if (!saveRes.ok) {
                      setError("Could not save HTML.");
                      return;
                    }
                    setVersionNote("");
                  }
                  await markRevisionDone();
                  setTab("feedback");
                }}
              >
                Save and mark revision done
              </button>
              {emails.length > 1 ? (
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={removeActiveEmail}
                >
                  Remove this email
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        {tab === "versions" ? (
          <div className="card card-pad stack">
            {versions.length === 0 ? (
              <div className="empty">No versions yet.</div>
            ) : (
              versions.map((v) => {
                const emailForVersion = emails.find((e) => e.id === v.email_id);
                return (
                  <div key={v.id} className="comment-card">
                    <div className="comment-head">
                      <span>
                        {emailForVersion ? emailForVersion.title + " — " : ""}
                        {v.note || "Update"}
                      </span>
                      <span>{new Date(v.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
