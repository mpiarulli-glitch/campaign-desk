"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { actorLabel } from "@/lib/people";
import {
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
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(data.error || "Could not assign this review.");
      return;
    }
    setNotice(`Assigned ${data.reviewerName}. Their Basecamp to-do only links here.`);
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

  const latestReject = [...reviews].reverse().find((r) => r.decision === "rejected");
  const assigned = Boolean(batch.qa_todo_url || batch.qa_assignee);
  const done = batch.status === "approved";

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/social-qa">
          Back to Social QA
        </Link>
        <SocialStatusBadge status={batch.status} />
      </div>
      <main className="container stack" style={{ gap: 20, maxWidth: 760 }}>
        {error ? <div className="banner banner-danger">{error}</div> : null}
        {notice ? <div className="banner">{notice}</div> : null}

        <div className="card card-pad stack">
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Social QA
            </p>
            <input
              value={batch.title}
              onChange={(e) => setBatch({ ...batch, title: e.target.value })}
              onBlur={() => saveBatch({ title: batch.title })}
              style={{ fontSize: 22, fontWeight: 650 }}
              aria-label="Batch title"
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Review this Sprout queue here. The Basecamp to-do only sends people to this
            page.
          </p>
          <div className="field">
            <label htmlFor="sq-client">Client</label>
            <input
              id="sq-client"
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
            />
            <datalist id="sq-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="sq-sprout">Sprout queue (stays in Campaign Desk)</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                id="sq-sprout"
                type="url"
                value={batch.sprout_url}
                onChange={(e) => setBatch({ ...batch, sprout_url: e.target.value })}
                onBlur={() => saveBatch({ sproutUrl: batch.sprout_url })}
                placeholder="https://app.sproutsocial.com/..."
                style={{ flex: 1, minWidth: 200 }}
              />
              {batch.sprout_url ? (
                <a
                  className="btn btn-primary"
                  href={batch.sprout_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Sprout queue
                </a>
              ) : null}
            </div>
          </div>
          <div className="field">
            <label htmlFor="sq-notes">Notes for the reviewer</label>
            <textarea
              id="sq-notes"
              value={batch.notes}
              onChange={(e) => setBatch({ ...batch, notes: e.target.value })}
              onBlur={() => saveBatch({ notes: batch.notes })}
              rows={2}
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Created by {batch.created_by_label || actorLabel(batch.created_by) || "unknown"}
            {batch.qa_assignee ? ` · Assigned to ${batch.qa_assignee}` : ""}
            {batch.approved_by
              ? ` · Approved by ${batch.approved_by}${
                  batch.approved_at
                    ? ` on ${new Date(batch.approved_at).toLocaleDateString()}`
                    : ""
                }`
              : ""}
          </p>
        </div>

        {latestReject && batch.status !== "approved" ? (
          <div className="banner banner-danger">
            <strong>Sent back by {latestReject.author_name}.</strong>
            <p style={{ margin: "8px 0 0" }}>{latestReject.feedback || batch.issue_note}</p>
          </div>
        ) : null}

        <div className="card card-pad stack">
          <h2 className="h2">1. Assign a reviewer</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            They get a Basecamp to-do with a link to this page only. They open Sprout
            from here, then approve or send it back below.
          </p>
          {assigned ? (
            <p style={{ margin: 0 }}>
              Assigned to <strong>{batch.qa_assignee || "a teammate"}</strong>
              {qa?.todoUrl ? (
                <>
                  {" · "}
                  <a href={qa.todoUrl} target="_blank" rel="noreferrer">
                    Open Basecamp to-do
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {qa && !qa.ready ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Missing: {qa.missing.join(", ") || qa.peopleReason}
            </p>
          ) : null}
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
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
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="sq-due">Due</label>
              <input
                id="sq-due"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy === "qa" || !reviewerSlug || !dueOn}
            onClick={() => void sendQa()}
          >
            {busy === "qa"
              ? "Sending…"
              : assigned
                ? "Reassign and update to-do"
                : "Assign and create to-do"}
          </button>
        </div>

        <div className="card card-pad stack">
          <h2 className="h2">2. Review this batch</h2>
          {done ? (
            <p style={{ margin: 0 }}>
              Approved by {batch.approved_by}
              {batch.approved_at
                ? ` on ${new Date(batch.approved_at).toLocaleDateString()}`
                : ""}
              .
            </p>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Open the Sprout queue above. Check all three, type your name, then
                approve — or leave feedback if it is not ready.
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
              <div className="field">
                <label htmlFor="sq-sign-name">Your name</label>
                <input
                  id="sq-sign-name"
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy === "sign" ||
                  !signName.trim() ||
                  !socialQaChecklistComplete(checklist)
                }
                onClick={() => void submitReview(true)}
              >
                {busy === "sign" ? "Saving…" : "Approve"}
              </button>
              <div className="field">
                <label htmlFor="sq-feedback">Not ready? Leave feedback</label>
                <textarea
                  id="sq-feedback"
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What needs to change"
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={
                  busy === "reject" || !signName.trim() || feedback.trim().length < 2
                }
                onClick={() => void submitReview(false)}
              >
                {busy === "reject" ? "Sending…" : "Send back with feedback"}
              </button>
            </>
          )}
          {reviews.length ? (
            <div className="stack" style={{ gap: 8 }}>
              <h3 className="h2" style={{ fontSize: 15, margin: 0 }}>
                Review history
              </h3>
              {reviews.map((review) => (
                <div key={review.id} className="muted" style={{ fontSize: 13 }}>
                  <strong>
                    {review.decision === "approved" ? "Approved" : "Sent back"}
                  </strong>
                  {` · ${review.author_name} · ${new Date(review.created_at).toLocaleString()}`}
                  {review.feedback ? (
                    <p style={{ margin: "6px 0 0", color: "inherit" }}>{review.feedback}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy === "save"}
          onClick={() => saveBatch({ archived: !batch.archived_at })}
        >
          {batch.archived_at ? "Restore" : "Archive"}
        </button>
      </main>
    </div>
  );
}
