"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { PEOPLE, actorLabel } from "@/lib/people";
import {
  SOCIAL_CHANNELS,
  SOCIAL_ISSUE_TAGS,
  SOCIAL_QA_STATUS_LABELS,
} from "@/lib/social-qa-meta";

type Batch = {
  id: string;
  title: string;
  client_name: string;
  client_id: string | null;
  sprout_url: string;
  notes: string;
  status: string;
  created_by: string;
  created_by_label?: string;
  qa_assignee: string;
  qa_todo_url: string | null;
  approved_at: string | null;
  approved_by: string | null;
  archived_at: string | null;
};

type Post = {
  id: string;
  title: string;
  channel: string;
  go_live_on: string | null;
  created_by: string;
  created_by_label?: string;
  qa_by: string | null;
  qa_by_label?: string | null;
  qa_at: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  issue_tag: string;
  issue_note: string;
};

type QaPerson = { id: number; name: string };
type QaState = {
  ready: boolean;
  missing: string[];
  people: QaPerson[];
  peopleReason: string;
  defaultReviewerId: number | null;
  todoUrl: string | null;
  message: string;
};

type RevClientOption = { id: string; name: string };

const CREATORS = [
  ...ADMIN_PEOPLE.map((p) => ({ slug: p.slug, label: p.label })),
  ...PEOPLE.filter((p) => !ADMIN_PEOPLE.some((a) => a.slug === p.slug)).map((p) => ({
    slug: p.slug,
    label: p.label,
  })),
];

function SocialStatusBadge({ status }: { status: string }) {
  const label =
    SOCIAL_QA_STATUS_LABELS[status as keyof typeof SOCIAL_QA_STATUS_LABELS] || status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export default function SocialBatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [clients, setClients] = useState<RevClientOption[]>([]);
  const [qa, setQa] = useState<QaState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [reviewerId, setReviewerId] = useState<number>(0);
  const [dueOn, setDueOn] = useState("");
  const [qaMessage, setQaMessage] = useState("");
  const [signName, setSignName] = useState("");
  const [newTitle, setNewTitle] = useState("");

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
    setPosts(data.posts || []);
  }, [id, router]);

  const loadQa = useCallback(async () => {
    const res = await fetch(`/api/social-qa/${id}/send-qa`);
    if (!res.ok) return;
    const data = await res.json();
    setQa(data);
    if (data.defaultReviewerId) {
      setReviewerId((current) => current || data.defaultReviewerId);
    }
    if (data.message) {
      setQaMessage((current) => current || data.message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadQa();
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setClients(d.clients.map((c: RevClientOption) => ({ id: c.id, name: c.name })));
      });
  }, [load, loadQa]);

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

  async function patchPost(postId: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/social-qa/${id}/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update that post.");
      return;
    }
    await load();
  }

  async function addPost() {
    const title = newTitle.trim();
    if (!title) return;
    setBusy("add");
    const res = await fetch(`/api/social-qa/${id}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, createdBy: batch?.created_by || "" }),
    });
    setBusy("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add the post.");
      return;
    }
    setNewTitle("");
    await load();
  }

  async function sendQa() {
    setBusy("qa");
    setError("");
    const res = await fetch(`/api/social-qa/${id}/send-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewerId,
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

  async function signOff() {
    setBusy("sign");
    setError("");
    const res = await fetch(`/api/social-qa/${id}/sign-off`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedBy: signName }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(data.error || "Could not sign off.");
      return;
    }
    setNotice(
      data.warning ||
        "Signed off. If a QA to-do exists, a checked subtask was added under it."
    );
    setSignName("");
    await load();
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

  const openIssues = posts.filter((p) => p.issue_tag).length;

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
              <a className="btn btn-secondary btn-sm" href={batch.sprout_url} target="_blank" rel="noreferrer">
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
            {batch.approved_by
              ? ` · Signed off by ${batch.approved_by}${
                  batch.approved_at
                    ? ` on ${new Date(batch.approved_at).toLocaleDateString()}`
                    : ""
                }`
              : ""}
          </div>
        </div>

        <div className="card" style={{ overflow: "auto" }}>
          <table className="social-sheet">
            <thead>
              <tr>
                <th>Post / creative</th>
                <th>Channel</th>
                <th>Go live</th>
                <th>Created by</th>
                <th>QA</th>
                <th>Signed off</th>
                <th>Issue</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className={post.issue_tag ? "social-sheet-issue" : undefined}>
                  <td>
                    <input
                      value={post.title}
                      onChange={(e) =>
                        setPosts((rows) =>
                          rows.map((r) => (r.id === post.id ? { ...r, title: e.target.value } : r))
                        )
                      }
                      onBlur={() => patchPost(post.id, { title: post.title })}
                    />
                  </td>
                  <td>
                    <select
                      value={post.channel}
                      onChange={(e) => patchPost(post.id, { channel: e.target.value })}
                    >
                      <option value="">—</option>
                      {SOCIAL_CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={post.go_live_on || ""}
                      onChange={(e) => patchPost(post.id, { goLiveOn: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={post.created_by}
                      onChange={(e) => patchPost(post.id, { createdBy: e.target.value })}
                    >
                      {CREATORS.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {post.qa_at ? (
                      <div>
                        {post.qa_by_label || actorLabel(post.qa_by || "") || "QA’d"}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => patchPost(post.id, { clearQa: true })}
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => patchPost(post.id, { markQa: true })}
                      >
                        Mark QA’d
                      </button>
                    )}
                  </td>
                  <td>
                    {post.signed_off_by
                      ? `${post.signed_off_by}${
                          post.signed_off_at
                            ? ` · ${new Date(post.signed_off_at).toLocaleDateString()}`
                            : ""
                        }`
                      : "—"}
                  </td>
                  <td>
                    <select
                      value={post.issue_tag}
                      onChange={(e) => patchPost(post.id, { issueTag: e.target.value })}
                    >
                      <option value="">None</option>
                      {SOCIAL_ISSUE_TAGS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {post.issue_tag ? (
                      <input
                        value={post.issue_note}
                        onChange={(e) =>
                          setPosts((rows) =>
                            rows.map((r) =>
                              r.id === post.id ? { ...r, issue_note: e.target.value } : r
                            )
                          )
                        }
                        onBlur={() => patchPost(post.id, { issueNote: post.issue_note })}
                        placeholder="What was wrong"
                        style={{ marginTop: 6 }}
                      />
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await fetch(`/api/social-qa/${id}/posts/${post.id}`, {
                          method: "DELETE",
                        });
                        await load();
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row card-pad" style={{ gap: 8 }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a post"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addPost();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy === "add"}
              onClick={() => void addPost()}
            >
              Add
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
          <div className="card card-pad stack" style={{ flex: 1, minWidth: 280 }}>
            <h2 className="h2">Send for QA</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Creates a Basecamp to-do on the Social QA list and assigns your colleague.
            </p>
            {qa?.todoUrl ? (
              <a href={qa.todoUrl} target="_blank" rel="noreferrer">
                Open current QA to-do
              </a>
            ) : null}
            {qa && !qa.ready ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Missing: {qa.missing.join(", ") || qa.peopleReason}
              </p>
            ) : null}
            <label htmlFor="sq-reviewer">Teammate</label>
            <select
              id="sq-reviewer"
              value={reviewerId || ""}
              onChange={(e) => setReviewerId(Number(e.target.value))}
            >
              <option value="">Pick someone</option>
              {(qa?.people || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
              disabled={busy === "qa" || !reviewerId}
              onClick={() => void sendQa()}
            >
              {busy === "qa" ? "Sending…" : "Send for QA"}
            </button>
          </div>

          <div className="card card-pad stack" style={{ flex: 1, minWidth: 280 }}>
            <h2 className="h2">Sign off</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Type your name. That stamps every post and checks off a Basecamp subtask
              under the QA to-do: “{signName.trim() || "Your name"} has reviewed and
              approved this batch of social.”
            </p>
            {openIssues ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {openIssues} flagged {openIssues === 1 ? "post needs" : "posts need"} to
                be cleared before sign-off.
              </p>
            ) : null}
            <input
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              placeholder="Your full name"
              disabled={batch.status === "approved"}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === "sign" || batch.status === "approved" || !signName.trim()}
              onClick={() => void signOff()}
            >
              {batch.status === "approved" ? "Already signed off" : "Approve this batch"}
            </button>
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
