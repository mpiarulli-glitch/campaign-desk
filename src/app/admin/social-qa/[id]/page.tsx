"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { actorLabel } from "@/lib/people";
import {
  SOCIAL_ISSUE_TAGS,
  SOCIAL_QA_CHECKLIST,
  SOCIAL_QA_STATUS_LABELS,
  emptySocialQaChecklist,
  socialQaChecklistComplete,
  type SocialQaChecklistState,
} from "@/lib/social-qa-meta";

type Batch = {
  id: string;
  title: string;
  client_name: string;
  sprout_url: string;
  notes: string;
  status: string;
  created_by: string;
  created_by_label?: string;
  qa_assignee: string;
  qa_by: string | null;
  qa_by_label?: string | null;
  qa_at: string | null;
  qa_todo_url: string | null;
  approved_at: string | null;
  approved_by: string | null;
  archived_at: string | null;
  issue_tag: string;
  issue_note: string;
};

type Review = {
  id: string;
  decision: "approved" | "rejected";
  author_name: string;
  feedback: string;
  created_at: string;
  bc_comment_url: string | null;
};

type QaState = {
  ready: boolean;
  missing: string[];
  assignees: Array<{ slug: string; label: string }>;
  defaultReviewerSlug: string;
  peopleReason: string;
  todoUrl: string | null;
  message: string;
};

type RevClientOption = { id: string; name: string };

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function SocialStatusBadge({ status }: { status: string }) {
  const label =
    SOCIAL_QA_STATUS_LABELS[status as keyof typeof SOCIAL_QA_STATUS_LABELS] || status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export default function SocialBatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [clients, setClients] = useState<RevClientOption[]>([]);
  const [qa, setQa] = useState<QaState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [reviewerSlug, setReviewerSlug] = useState("");
  const [dueOn, setDueOn] = useState(tomorrowYmd);
  const [qaMessage, setQaMessage] = useState("");
  const [signName, setSignName] = useState("");
  const [checklist, setChecklist] = useState<SocialQaChecklistState>(emptySocialQaChecklist);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/social-qa/${id}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 404) {
      setError("Batch not found.");
      return;
    }
    const data = await res.json();
    setBatch(data.batch);
    setReviews(data.reviews || []);
  }, [id, router]);

  const loadQa = useCallback(async () => {
    const res = await fetch(`/api/social-qa/${id}/send-qa`);
    if (!res.ok) return;
    const data = await res.json();
    setQa(data);
    if (data.defaultReviewerSlug) {
      setReviewerSlug((current) => current || data.defaultReviewerSlug);
    }
    if (data.message) {
      setQaMessage((current) => current || data.message);
    }
  }, [id]);

  useEffect(() => {
    const fromCreate = searchParams.get("error");
    if (fromCreate) setError(fromCreate);
    void load();
    void loadQa();
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setClients(d.clients.map((c: RevClientOption) => ({ id: c.id, name: c.name })));
      });
  }, [load, loadQa, searchParams]);

  async function saveBatch(patch: Record<string, unknown>) {
    setBusy("save");
    const res = await fetch(`/api/social-qa/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save.");
      return;
    }
    await load();
  }

  async function sendQa() {
    setBusy("qa");
    setError("");
    const res = await fetch(`/api/social-qa/${id}/send-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewerSlug,
        dueOn: dueOn || null,
        message: qaMessage,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(data.error || "Could not send for QA.");
      return;
    }
    setNotice(`Assigned ${data.reviewerName} on Basecamp.`);
    await load();
    await loadQa();
  }

  async function submitReview(approved: boolean) {
    setBusy(approved ? "sign" : "reject");
    setError("");
    const res = await fetch(`/api/social-qa/${id}/sign-off`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved,
        reviewedBy: signName,
        checklist,
        feedback,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(data.error || (approved ? "Could not approve." : "Could not send feedback."));
      return;
    }
    setNotice(
      data.warning ||
        (approved
          ? "Approved. A note was left on the Basecamp to-do."
          : "Sent back with feedback. A note was left on the Basecamp to-do.")
    );
    if (!approved) setFeedback("");
    await load();
    await loadQa();
  }

  if (!batch && !error) return <div className="container muted">Loading…</div>;
  if (!batch) {
    return (
      <div className="container">
        <p>{error}</p>
        <Link href="/admin/social-qa">Back to Social QA</Link>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/social-qa">
          Back to Social QA
        </Link>
        <SocialStatusBadge status={batch.status} />
      </div>
      <main className="container stack" style={{ gap: 16 }}>
        {error ? <div className="banner banner-danger">{error}</div> : null}
        {notice ? <div className="banner">{notice}</div> : null}

        <div className="card card-pad stack">
          <input
            value={batch.title}
            onChange={(e) => setBatch({ ...batch, title: e.target.value })}
            onBlur={() => saveBatch({ title: batch.title })}
            style={{ fontSize: 22, fontWeight: 650 }}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              list="sq-clients"
              value={batch.client_name}
              onChange={(e) => setBatch({ ...batch, client_name: e.target.value })}
              onBlur={() =>
                saveBatch({
                  clientName: batch.client_name,
                  clientId:
                    clients.find(
                      (c) => c.name.toLowerCase() === batch.client_name.trim().toLowerCase()
                    )?.id || null,
                })
              }
              placeholder="Client"
            />
            <datalist id="sq-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <input
              type="url"
              value={batch.sprout_url}
              onChange={(e) => setBatch({ ...batch, sprout_url: e.target.value })}
              onBlur={() => saveBatch({ sproutUrl: batch.sprout_url })}
              placeholder="Sprout Social link"
              style={{ flex: 1, minWidth: 220 }}
            />
            {batch.sprout_url ? (
              <a
                className="btn btn-secondary btn-sm"
                href={batch.sprout_url}
                target="_blank"
                rel="noreferrer"
              >
                Open Sprout
              </a>
            ) : null}
          </div>
          <textarea
            value={batch.notes}
            onChange={(e) => setBatch({ ...batch, notes: e.target.value })}
            onBlur={() => saveBatch({ notes: batch.notes })}
            rows={2}
            placeholder="Notes for QA"
          />
          <div className="muted" style={{ fontSize: 13 }}>
            Created by {batch.created_by_label || actorLabel(batch.created_by) || "unknown"}
            {batch.qa_by
              ? ` · QA’d by ${batch.qa_by_label || actorLabel(batch.qa_by)}`
              : batch.qa_assignee
                ? ` · Assigned to ${batch.qa_assignee}`
                : ""}
            {batch.approved_by
              ? ` · Signed off by ${batch.approved_by}${
                  batch.approved_at
                    ? ` on ${new Date(batch.approved_at).toLocaleDateString()}`
                    : ""
                }`
              : ""}
          </div>
        </div>

        <div className="card card-pad stack">
          <h2 className="h2">QA check</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Review the Sprout queue as a whole. Flag the batch if something is wrong, or
            mark it QA’d when it looks clean.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {batch.qa_at ? (
              <>
                <span>
                  QA’d
                  {batch.qa_by_label || batch.qa_by
                    ? ` by ${batch.qa_by_label || actorLabel(batch.qa_by || "")}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => saveBatch({ clearQa: true })}
                >
                  Clear
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => saveBatch({ markQa: true })}
              >
                Mark QA’d
              </button>
            )}
          </div>
          <label htmlFor="sq-issue">Issue (if sending back)</label>
          <select
            id="sq-issue"
            value={batch.issue_tag}
            onChange={(e) => saveBatch({ issueTag: e.target.value })}
          >
            <option value="">None</option>
            {SOCIAL_ISSUE_TAGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {batch.issue_tag ? (
            <input
              value={batch.issue_note}
              onChange={(e) => setBatch({ ...batch, issue_note: e.target.value })}
              onBlur={() => saveBatch({ issueNote: batch.issue_note })}
              placeholder="What was wrong in this queue"
            />
          ) : null}
        </div>

        <div className="row" style={{ gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
          <div className="card card-pad stack" style={{ flex: 1, minWidth: 280 }}>
            <h2 className="h2">Assign for review</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Assign a colleague. That creates a Basecamp to-do on the Social QA list,
              due on the date you pick, with a link back here and to Sprout.
            </p>
            {qa?.todoUrl ? (
              <a href={qa.todoUrl} target="_blank" rel="noreferrer">
                Open current review to-do
              </a>
            ) : null}
            {qa && !qa.ready ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Missing: {qa.missing.join(", ") || qa.peopleReason}
              </p>
            ) : null}
            <label htmlFor="sq-reviewer">Assign to</label>
            <select
              id="sq-reviewer"
              value={reviewerSlug}
              onChange={(e) => setReviewerSlug(e.target.value)}
            >
              <option value="">Pick a teammate</option>
              {(qa?.assignees || []).map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
            <label htmlFor="sq-due">Due date</label>
            <input
              id="sq-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
            <label htmlFor="sq-msg">To-do note</label>
            <textarea
              id="sq-msg"
              rows={6}
              value={qaMessage}
              onChange={(e) => setQaMessage(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === "qa" || !reviewerSlug || !dueOn}
              onClick={() => void sendQa()}
            >
              {busy === "qa" ? "Sending…" : "Assign and create to-do"}
            </button>
          </div>

          <div className="card card-pad stack" style={{ flex: 1, minWidth: 280 }}>
            <h2 className="h2">Review and approve</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Work the checklist. Approve posts a note on the Basecamp to-do from you:
              “I have reviewed and approved this work from a QA standpoint.” If it is
              not ready, leave feedback instead — that note goes on the to-do and stays
              on this page.
            </p>
            {SOCIAL_QA_CHECKLIST.map((item) => (
              <label
                key={item.key}
                className="row"
                style={{ gap: 8, alignItems: "flex-start" }}
              >
                <input
                  type="checkbox"
                  checked={checklist[item.key]}
                  disabled={batch.status === "approved"}
                  onChange={(e) =>
                    setChecklist((current) => ({
                      ...current,
                      [item.key]: e.target.checked,
                    }))
                  }
                />
                <span>{item.label}</span>
              </label>
            ))}
            <label htmlFor="sq-sign-name">Your name</label>
            <input
              id="sq-sign-name"
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              placeholder="Your full name"
              disabled={batch.status === "approved"}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy === "sign" ||
                batch.status === "approved" ||
                !signName.trim() ||
                !socialQaChecklistComplete(checklist)
              }
              onClick={() => void submitReview(true)}
            >
              {batch.status === "approved" ? "Already approved" : "Approve this batch"}
            </button>
            <label htmlFor="sq-feedback">If you do not approve, leave feedback</label>
            <textarea
              id="sq-feedback"
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change before this can go out"
              disabled={batch.status === "approved"}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={
                busy === "reject" ||
                batch.status === "approved" ||
                !signName.trim() ||
                feedback.trim().length < 2
              }
              onClick={() => void submitReview(false)}
            >
              {busy === "reject" ? "Sending…" : "Do not approve — send feedback"}
            </button>
            {reviews.length ? (
              <div className="stack" style={{ gap: 8 }}>
                <h3 className="h2" style={{ fontSize: 15, margin: 0 }}>
                  Review notes
                </h3>
                {reviews.map((review) => (
                  <div key={review.id} className="muted" style={{ fontSize: 13 }}>
                    <strong>
                      {review.decision === "approved" ? "Approved" : "Not approved"}
                    </strong>
                    {` · ${review.author_name} · ${new Date(review.created_at).toLocaleString()}`}
                    {review.feedback ? (
                      <p style={{ margin: "6px 0 0", color: "inherit" }}>{review.feedback}</p>
                    ) : null}
                    {review.bc_comment_url ? (
                      <div>
                        <a href={review.bc_comment_url} target="_blank" rel="noreferrer">
                          Basecamp note
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy === "save"}
              onClick={() => saveBatch({ archived: !batch.archived_at })}
            >
              {batch.archived_at ? "Restore" : "Archive"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
