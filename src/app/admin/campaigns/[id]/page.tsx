"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { EmailPreview } from "@/components/EmailPreview";
import { EmailLinks } from "@/components/EmailLinks";
import { StatusBadge } from "@/components/StatusBadge";
import { AssetContentFields } from "@/components/AssetContentFields";
import {
  ASSET_KINDS,
  renderAssetDoc,
  kindLabel,
  kindNoun,
  coerceFormat,
  type AssetKind,
  type BodyFormat,
} from "@/lib/asset-kinds";

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
  channel: "internal" | "external";
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
  kind?: AssetKind;
  body_format?: BodyFormat;
  media_url?: string | null;
  purpose?: string;
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
  client_id: string | null;
  description: string;
  audience: string;
  status: string;
  magic_token: string;
  updated_at: string;
  review_url: string;
  external_review_url: string;
  open_comments: number;
  email_count?: number;
  archived_at?: string | null;
};

type BasecampPerson = {
  id: number;
  name: string;
  email: string;
  isClient: boolean;
  mentionable: boolean;
};

type BasecampApprovalState = {
  ready: boolean;
  missing: string[];
  recipient: string;
  projectConfigured: boolean;
  message: string;
  alreadySent: boolean;
  lastSentAt: string | null;
  cardUrl: string | null;
  people: BasecampPerson[];
  peopleReason: string;
  defaultRecipientId: number | null;
  dueOn: string;
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
  const [copiedExternal, setCopiedExternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [newEmailTitle, setNewEmailTitle] = useState("");
  const [newEmailHtml, setNewEmailHtml] = useState("");
  const [newEmailKind, setNewEmailKind] = useState<AssetKind>("email");
  const [newEmailFormat, setNewEmailFormat] = useState<BodyFormat>("html");
  const [newEmailMedia, setNewEmailMedia] = useState("");
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
  const [purposeDraft, setPurposeDraft] = useState("");
  const [savingPurpose, setSavingPurpose] = useState(false);
  const [basecampApproval, setBasecampApproval] =
    useState<BasecampApprovalState | null>(null);
  const [sendingBasecampApproval, setSendingBasecampApproval] = useState(false);
  // Two-step confirm lives in the page rather than a native confirm() dialog.
  // A browser that has suppressed dialogs for the tab returns false from
  // confirm() instantly, which made this button look dead with no error.
  const [confirmingBasecampApproval, setConfirmingBasecampApproval] =
    useState(false);
  // The send form's own choices. They start from what the server suggests and
  // are only sent when the sender has actually seen the form, so a send from a
  // stale tab cannot silently reassign a card.
  const [approvalRecipientId, setApprovalRecipientId] = useState<number | "">("");
  const [approvalAssigneeIds, setApprovalAssigneeIds] = useState<number[]>([]);
  const [approvalDueOn, setApprovalDueOn] = useState("");

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
    try {
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
      loadBasecampApproval();

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
    } catch {
      setError("Network error. Check your connection and try again.");
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function loadBasecampApproval() {
    const res = await fetch(`/api/campaigns/${id}/basecamp-approval`);
    if (!res.ok) {
      setBasecampApproval(null);
      return;
    }
    const data: BasecampApprovalState = await res.json();
    setBasecampApproval(data);
    // Seed the form from the server's view, but never overwrite a choice the
    // sender has already made: this reloads after a send and after a save.
    setApprovalRecipientId((current) =>
      current === "" ? (data.defaultRecipientId ?? "") : current
    );
    setApprovalDueOn((current) => current || data.dueOn || "");
  }

  const [revClients, setRevClients] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRevClients(d.clients));
  }, []);

  async function changeClient(clientId: string) {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientId || null,
        clientName: revClients.find((c) => c.id === clientId)?.name || "",
      }),
    });
    if (res.ok) load();
  }

  const activeEmail = useMemo(
    () => emails.find((e) => e.id === activeEmailId) || emails[0] || null,
    [emails, activeEmailId]
  );

  // Rendered preview document for the active asset (blogs/decks/mock-ups get
  // turned into displayable HTML here; emails pass through unchanged).
  const activeDoc = useMemo(
    () => (activeEmail ? renderAssetDoc(activeEmail) : { html: "", interactive: false }),
    [activeEmail]
  );

  // The AI reviser rewrites HTML, so it only applies to HTML-backed assets
  // (emails and HTML blogs/decks), never interactive forms, markdown docs, or
  // image/Figma mock-ups.
  const canAiRevise = useMemo(
    () =>
      !!activeEmail &&
      !activeDoc.interactive &&
      (activeEmail.body_format ?? "html") === "html" &&
      activeEmail.kind !== "mockup",
    [activeEmail, activeDoc.interactive]
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

  useEffect(() => {
    setPurposeDraft(activeEmail?.purpose || "");
  }, [activeEmail?.id, activeEmail?.purpose]);

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

  async function savePurpose() {
    if (!activeEmail) return;
    setSavingPurpose(true);
    setError("");
    const res = await fetch(`/api/campaigns/${id}/emails`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: activeEmail.id, purpose: purposeDraft }),
    });
    setSavingPurpose(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save purpose.");
      return;
    }
    load(activeEmail.id);
    setMessage("Purpose saved.");
  }

  function effectiveSubject(email: EmailItem): SubjectOption | null {
    const subs = email.subjects || [];
    if (!subs.length) return null;
    return subs.find((s) => s.id === email.chosen_subject_id) || subs[0];
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

  async function copyExternalLink() {
    if (!campaign?.external_review_url) return;
    await navigator.clipboard.writeText(campaign.external_review_url);
    setCopiedExternal(true);
    setTimeout(() => setCopiedExternal(false), 1500);
  }

  async function sendBasecampApproval() {
    if (sendingBasecampApproval) return;
    if (!basecampApproval?.ready) {
      setError(
        basecampApproval?.missing?.length
          ? `Setup needed before this can send: ${basecampApproval.missing.join(", ")}.`
          : "This campaign is not ready to send for approval yet."
      );
      return;
    }
    if (!approvalRecipientId && !basecampApproval.recipient) {
      setError("Pick who this approval goes to before sending it.");
      return;
    }
    const resend = basecampApproval.alreadySent;

    setConfirmingBasecampApproval(false);
    setSendingBasecampApproval(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/campaigns/${id}/basecamp-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        force: resend,
        recipientId: approvalRecipientId || undefined,
        assigneeIds: approvalAssigneeIds,
        dueOn: approvalDueOn,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSendingBasecampApproval(false);

    if (!res.ok) {
      setError(data.error || "Could not send the approval in Basecamp.");
      if (data.cardUrl) {
        setMessage(`Basecamp card: ${data.cardUrl}`);
      }
      await loadBasecampApproval();
      return;
    }

    setStatus(data.status || "in_review");
    setMessage(
      `Approval sent to ${data.recipient || "the client"} in Basecamp.` +
        (data.dueOn ? ` Due ${data.dueOn}.` : "")
    );
    await load(activeEmailId);
    await loadBasecampApproval();
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
    setMessage("AI drafted a revision below.");
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
    setMessage("AI drafted a revision addressing all open feedback.");
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


  async function addEmail(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/campaigns/${id}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newEmailTitle || `Item ${emails.length + 1}`,
        htmlContent: newEmailHtml,
        kind: newEmailKind,
        bodyFormat: newEmailFormat,
        mediaUrl: newEmailMedia,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add item.");
      return;
    }
    const data = await res.json();
    setAddingEmail(false);
    setNewEmailTitle("");
    setNewEmailHtml("");
    setNewEmailKind("email");
    setNewEmailFormat("html");
    setNewEmailMedia("");
    setMessage("Added to this review package.");
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

  async function toggleArchived() {
    if (!campaign) return;
    const archived = !campaign.archived_at;
    setSaving(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(archived ? "Could not archive." : "Could not restore.");
      return;
    }
    const data = await res.json();
    if (data.campaign) setCampaign(data.campaign);
    setMessage(archived ? "Campaign archived." : "Campaign restored.");
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
        <Link href="/admin/campaigns">Back to campaigns</Link>
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

  // Who the send form is actually pointed at, which is what every line of the
  // Basecamp panel should name. Falls back to the account's saved contact so a
  // roster that failed to load does not make the panel claim nobody.
  const approvalRecipientName =
    basecampApproval?.people.find(
      (person) => person.id === approvalRecipientId
    )?.name ||
    basecampApproval?.recipient ||
    "";

  return (
    <div className="app-shell">
      <div className="page-actions">
        <StatusBadge status={status} />
        <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">
          All campaigns
        </Link>
      </div>

      <main className="container container-wide stack">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <p className="eyebrow">
              Review package{campaign.archived_at ? " · Archived" : ""}
            </p>
            <h1 className="h1">{campaign.title}</h1>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {emails.length} email{emails.length === 1 ? "" : "s"} · Updated{" "}
              {new Date(campaign.updated_at).toLocaleString()}
            </p>
            <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 6 }}>
              <label className="muted" style={{ fontSize: 13 }} htmlFor="campaign-client">
                Client
              </label>
              <select
                id="campaign-client"
                className="select-clean badge-select"
                value={campaign.client_id || ""}
                onChange={(e) => changeClient(e.target.value)}
              >
                <option value="">{campaign.client_name || "Unlinked"}</option>
                {revClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
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
              <option value="scheduled">Scheduled</option>
              <option value="sent">Sent</option>
            </select>
            <button
              className="btn btn-secondary btn-sm"
              onClick={toggleArchived}
              disabled={saving}
            >
              {campaign.archived_at ? "Restore" : "Archive"}
            </button>
            <button className="btn btn-danger btn-sm" onClick={removeCampaign}>
              Delete
            </button>
          </div>
        </div>

        <div className="card card-pad stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Items in this package</strong>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setAddingEmail((v) => !v)}
            >
              {addingEmail ? "Cancel" : "Add item"}
            </button>
          </div>
          <div className="email-tabs">
            {emails.map((email, index) => {
              const subject = effectiveSubject(email);
              return (
                <div key={email.id} className="email-tab-wrap">
                  <button
                    type="button"
                    className={`email-tab ${
                      email.id === activeEmail.id ? "active" : ""
                    }`}
                    onClick={() => selectEmail(email.id)}
                  >
                    <span className="email-tab-num">
                      {email.approved_at ? "✓" : index + 1}
                    </span>
                    <span className="email-tab-label">
                      {email.title}
                      {email.kind && email.kind !== "email"
                        ? ` · ${kindLabel(email.kind)}`
                        : ""}
                    </span>
                    {email.open_comments > 0 ? (
                      <span className="email-tab-badge">
                        {email.open_comments}
                      </span>
                    ) : null}
                  </button>
                  <div className="email-tab-tooltip">
                    <div className="email-tab-tooltip-row">
                      <div className="email-tab-tooltip-label">Subject</div>
                      <div>{subject?.subject || "Not set yet"}</div>
                    </div>
                    <div className="email-tab-tooltip-row">
                      <div className="email-tab-tooltip-label">
                        Preview text
                      </div>
                      <div>{subject?.preview_text || "Not set yet"}</div>
                    </div>
                    <div className="email-tab-tooltip-row">
                      <div className="email-tab-tooltip-label">Purpose</div>
                      <div>{email.purpose || "Not set yet"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {addingEmail ? (
            <form className="stack" onSubmit={addEmail} style={{ marginTop: 8 }}>
              <div className="field">
                <label>Type</label>
                <div className="tabs" style={{ marginTop: 4, flexWrap: "wrap" }}>
                  {ASSET_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className={`tab ${newEmailKind === k.kind ? "active" : ""}`}
                      onClick={() => {
                        setNewEmailKind(k.kind);
                        setNewEmailFormat(coerceFormat(k.kind, newEmailFormat));
                      }}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="newEmailTitle">Title</label>
                <input
                  id="newEmailTitle"
                  value={newEmailTitle}
                  onChange={(e) => setNewEmailTitle(e.target.value)}
                  placeholder={`Item ${emails.length + 1}`}
                />
              </div>
              <AssetContentFields
                kind={newEmailKind}
                format={newEmailFormat}
                setFormat={setNewEmailFormat}
                content={newEmailHtml}
                setContent={setNewEmailHtml}
                media={newEmailMedia}
                setMedia={setNewEmailMedia}
              />
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Adding..." : "Add to package"}
              </button>
            </form>
          ) : null}
        </div>

        {isApproved ? (
          <div className="card card-pad approve-card is-approved">
            <strong>This package is approved.</strong>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              Feedback is closed. Change the status dropdown if you need to
              reopen it.
            </p>
          </div>
        ) : canMarkRevisionDone ? (
          <div className="card next-steps-bar">
            <div className="next-steps-copy">
              <strong>Next step</strong>
              <span className="muted">
                Resolve open feedback and send it back for review.
              </span>
            </div>
            <div className="row next-steps-actions">
              <button
                className="btn"
                onClick={markRevisionDone}
                disabled={saving}
                title="Marks all open feedback resolved and sets status to In review so your boss can check the update."
              >
                {saving ? "Saving..." : "Mark revision done"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="card card-pad stack review-links-card">
          <strong>Review links</strong>

          <div className="review-link-row">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <span className="review-link-label">
                Internal <span className="muted">· boss / team</span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={copyLink}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="copy-box">
              <code>{campaign.review_url}</code>
            </div>
          </div>

          <div className="review-link-row">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <span className="review-link-label">
                External <span className="muted">· client</span>
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={copyExternalLink}
              >
                {copiedExternal ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="copy-box">
              <code>{campaign.external_review_url}</code>
            </div>
          </div>

          <div className="review-link-row">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <span className="review-link-label">
                Basecamp{" "}
                <span className="muted">· client approval workflow</span>
              </span>
              {confirmingBasecampApproval && !sendingBasecampApproval ? (
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConfirmingBasecampApproval(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-sm" onClick={sendBasecampApproval}>
                    {basecampApproval?.alreadySent
                      ? "Yes, resend it"
                      : "Yes, send it"}
                  </button>
                </div>
              ) : (
                <button
                  className={`btn btn-sm ${
                    basecampApproval?.alreadySent ? "btn-secondary" : ""
                  }`}
                  onClick={() => setConfirmingBasecampApproval(true)}
                  disabled={
                    !basecampApproval?.ready || sendingBasecampApproval
                  }
                >
                  {sendingBasecampApproval
                    ? "Sending..."
                    : basecampApproval?.alreadySent
                      ? "Resend approval"
                      : "Send approval"}
                </button>
              )}
            </div>

            {basecampApproval?.ready && !sendingBasecampApproval ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span className="muted">Send to</span>
                  <select
                    value={approvalRecipientId}
                    onChange={(e) =>
                      setApprovalRecipientId(
                        e.target.value ? Number(e.target.value) : ""
                      )
                    }
                    disabled={!basecampApproval.people.length}
                  >
                    <option value="">
                      {basecampApproval.people.length
                        ? "Pick a person..."
                        : basecampApproval.peopleReason ||
                          "No project roster available"}
                    </option>
                    {basecampApproval.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.isClient ? "" : " (our team)"}
                        {person.mentionable ? "" : " — cannot be mentioned"}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span className="muted">Due date</span>
                  <input
                    type="date"
                    value={approvalDueOn}
                    onChange={(e) => setApprovalDueOn(e.target.value)}
                  />
                </label>

                {basecampApproval.people.length > 1 ? (
                  <details>
                    <summary
                      className="muted"
                      style={{ cursor: "pointer", fontSize: 13 }}
                    >
                      Also assign
                      {approvalAssigneeIds.length
                        ? ` (${approvalAssigneeIds.length})`
                        : ""}
                    </summary>
                    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                      {basecampApproval.people
                        .filter((person) => person.id !== approvalRecipientId)
                        .map((person) => (
                          <label
                            key={person.id}
                            className="row"
                            style={{ gap: 6, fontSize: 13 }}
                          >
                            <input
                              type="checkbox"
                              checked={approvalAssigneeIds.includes(person.id)}
                              onChange={(e) =>
                                setApprovalAssigneeIds((current) =>
                                  e.target.checked
                                    ? [...current, person.id]
                                    : current.filter((pid) => pid !== person.id)
                                )
                              }
                            />
                            <span>
                              {person.name}
                              {person.isClient ? "" : " (our team)"}
                            </span>
                          </label>
                        ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            {confirmingBasecampApproval && !sendingBasecampApproval ? (
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                {basecampApproval?.alreadySent ? "Resend" : "Send"} this
                approval
                {approvalRecipientName ? ` to ${approvalRecipientName}` : ""}
                {approvalAssigneeIds.length
                  ? `, assign ${approvalAssigneeIds.length} more`
                  : ""}
                {approvalDueOn ? `, due ${approvalDueOn}` : ""} and move its
                Deliverables card to Needs Approval?
              </p>
            ) : null}

            {basecampApproval ? (
              <>
                <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                  {basecampApproval.ready
                    ? `Sends to ${approvalRecipientName || "whoever you pick above"} and moves the Deliverables card to Needs Approval.`
                    : `Setup needed: ${basecampApproval.missing.join(", ")}.`}
                  {basecampApproval.lastSentAt
                    ? ` Last sent ${new Date(basecampApproval.lastSentAt).toLocaleString()}.`
                    : ""}
                </p>
                {basecampApproval.cardUrl ? (
                  <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                    <a
                      href={basecampApproval.cardUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Basecamp Deliverables card
                    </a>
                  </p>
                ) : null}
                <details style={{ marginTop: 10 }}>
                  <summary className="muted" style={{ cursor: "pointer" }}>
                    Preview approval message
                  </summary>
                  <pre
                    className="copy-box"
                    style={{
                      marginTop: 8,
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    {basecampApproval.message}
                  </pre>
                </details>
              </>
            ) : (
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                Checking Basecamp setup...
              </p>
            )}
          </div>
        </div>

        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {aiChat ? (
          <div className="card card-pad stack ai-preview-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <p className="eyebrow">AI revision</p>
                <strong>Iterate with AI</strong>
                <span className="ai-cost-note"> · uses paid API credits</span>
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

            <div className="ai-followup-box">
              <div className="row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !chatLoading) sendFollowUp();
                  }}
                  placeholder="E.g. make the headline shorter, strengthen the CTA..."
                  style={{ flex: 1, fontSize: 14 }}
                  disabled={chatLoading}
                />
                <button
                  className="btn btn-sm"
                  onClick={sendFollowUp}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? "Generating..." : "Send"}
                </button>
              </div>
            </div>

            <div className="split-review">
              <div className="stack">
                <h2 className="h2">Current</h2>
                <EmailPreview
                  html={activeDoc.html}
                  interactive={activeDoc.interactive}
                />
              </div>
              <div className="stack">
                <h2 className="h2">Latest AI version</h2>
                <EmailPreview
                  html={aiChat.currentHtml}
                  interactive={activeDoc.interactive}
                />
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
                html={activeDoc.html}
                pins={inlinePins}
                activePinId={activePinId}
                onSelectPin={setActivePinId}
                interactive={activeDoc.interactive}
              />
              <EmailLinks html={activeDoc.html} />

              <div className="card card-pad stack">
                <h2 className="h2" style={{ margin: 0 }}>
                  Purpose of this {kindNoun(activeEmail.kind ?? "email")}
                </h2>
                <textarea
                  value={purposeDraft}
                  onChange={(e) => setPurposeDraft(e.target.value)}
                  placeholder="What is this specific email trying to do?"
                  style={{ minHeight: 70 }}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={savePurpose}
                    disabled={savingPurpose}
                  >
                    {savingPurpose ? "Saving..." : "Save purpose"}
                  </button>
                </div>
              </div>

              <div className="card card-pad stack">
                <h2 className="h2" style={{ margin: 0 }}>
                  Subject lines & preview text
                </h2>
                {activeEmail.chosen_subject_id ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    The client has picked one, highlighted below.
                  </p>
                ) : null}
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
                    Un-approve {kindNoun(activeEmail.kind ?? "email")}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleEmailApproved(true)}
                    disabled={saving}
                  >
                    Approve {kindNoun(activeEmail.kind ?? "email")}
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
                {unresolvedComments.length > 0 && canAiRevise ? (
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
                  {emailComments.map((c) => (
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
                            ? ` · Pin ${
                                inlinePins.findIndex((p) => p.id === c.id) + 1
                              }`
                            : " · General"}
                          {c.resolved ? " · Done" : ""}
                          <span className={`comment-channel-tag ${c.channel}`}>
                            {c.channel === "external" ? "External" : "Internal"}
                          </span>
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
                         {!c.resolved && canAiRevise ? (
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
