"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SOCIAL_QA_STATUS_LABELS } from "@/lib/social-qa-meta";
import { actorLabel } from "@/lib/people";

type Tab = "batches" | "issues";
type StatusFilter = "all" | "draft" | "in_qa" | "needs_revisions" | "approved";
type SocialBatchRow = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  created_by: string;
  qa_assignee: string;
  qa_by: string | null;
  approved_by: string | null;
  issue_tag: string;
};

type IssueCount = { tag: string; label: string; count: number };
type IssueRow = {
  tag: string;
  label: string;
  created_by: string;
  client_name: string;
  batch_id: string;
  batch_title: string;
};

function SocialStatusBadge({ status }: { status: string }) {
  const label =
    SOCIAL_QA_STATUS_LABELS[status as keyof typeof SOCIAL_QA_STATUS_LABELS] || status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export default function SocialQaPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("batches");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [batches, setBatches] = useState<SocialBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<IssueCount[]>([]);
  const [issueRows, setIssueRows] = useState<IssueRow[]>([]);

  async function loadBatches(nextFilter: "active" | "archived" = filter) {
    setLoading(true);
    setError("");
    const res = await fetch(
      `/api/social-qa${nextFilter === "archived" ? "?archived=1" : ""}`
    );
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Could not load Social QA.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setBatches(data.batches || []);
    setLoading(false);
  }

  async function loadIssues() {
    const res = await fetch("/api/social-qa/issues");
    if (!res.ok) return;
    const data = await res.json();
    setCounts(data.counts || []);
    setIssueRows(data.rows || []);
  }

  useEffect(() => {
    void loadBatches();
    void loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible =
    statusFilter === "all"
      ? batches
      : batches.filter((b) => b.status === statusFilter);

  return (
    <div className="app-shell">
      <div className="page-actions">
        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === "batches" ? "active" : ""}`}
            onClick={() => setTab("batches")}
          >
            Batches
          </button>
          <button
            type="button"
            className={`tab ${tab === "issues" ? "active" : ""}`}
            onClick={() => setTab("issues")}
          >
            Issues
            {counts.reduce((n, c) => n + c.count, 0) ? (
              <span className="tab-count">
                {counts.reduce((n, c) => n + c.count, 0)}
              </span>
            ) : null}
          </button>
        </div>
        <Link className="btn btn-primary btn-sm" href="/admin/social-qa/new">
          New batch
        </Link>
      </div>

      <main className="container">
        {tab === "issues" ? (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h1 className="h1">Issue patterns</h1>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Flagged batches, so you can see what keeps coming back.
              </p>
            </div>
            {counts.length === 0 ? (
              <div className="card card-pad muted">No flagged batches yet.</div>
            ) : (
              <>
                <div className="social-issue-grid">
                  {counts.map((c) => (
                    <div key={c.tag} className="card card-pad">
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.label}
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 650 }}>{c.count}</div>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ overflow: "auto" }}>
                  <table className="social-sheet">
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Client</th>
                        <th>Created by</th>
                        <th>Batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issueRows.map((row) => (
                        <tr key={row.batch_id}>
                          <td>{row.label}</td>
                          <td>{row.client_name || "—"}</td>
                          <td>{actorLabel(row.created_by) || row.created_by}</td>
                          <td>
                            <Link href={`/admin/social-qa/${row.batch_id}`}>
                              {row.batch_title}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h1 className="h1">Social QA</h1>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Log a Sprout queue, send a colleague to QA it, and keep a named sign-off.
              </p>
            </div>

            <div className="tabs" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className={`tab ${filter === "active" ? "active" : ""}`}
                onClick={() => {
                  setFilter("active");
                  void loadBatches("active");
                }}
              >
                Active
              </button>
              <button
                type="button"
                className={`tab ${filter === "archived" ? "active" : ""}`}
                onClick={() => {
                  setFilter("archived");
                  void loadBatches("archived");
                }}
              >
                Archived
              </button>
            </div>

            <div className="tabs" style={{ flexWrap: "wrap" }}>
              {(
                [
                  ["all", "All statuses"],
                  ["draft", "Draft"],
                  ["in_qa", "In QA"],
                  ["needs_revisions", "Needs revisions"],
                  ["approved", "Approved"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tab ${statusFilter === value ? "active" : ""}`}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                  <span className="tab-count">
                    {value === "all"
                      ? batches.length
                      : batches.filter((b) => b.status === value).length}
                  </span>
                </button>
              ))}
            </div>

            {error ? <div className="banner banner-danger">{error}</div> : null}
            {loading ? (
              <div className="muted">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="card card-pad muted">
                No batches yet.{" "}
                <Link href="/admin/social-qa/new">Create the first one</Link>.
              </div>
            ) : (
              <div className="campaign-list">
                {visible.map((b) => (
                  <Link
                    key={b.id}
                    href={`/admin/social-qa/${b.id}`}
                    className="campaign-item"
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{b.title}</h3>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {b.client_name || "No client"}
                        {` · Created by ${actorLabel(b.created_by) || b.created_by || "unknown"}`}
                        {b.issue_tag ? " · Flagged" : ""}
                        {b.qa_assignee ? ` · QA: ${b.qa_assignee}` : ""}
                        {b.approved_by ? ` · Signed off: ${b.approved_by}` : ""}
                      </div>
                    </div>
                    <SocialStatusBadge status={b.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
