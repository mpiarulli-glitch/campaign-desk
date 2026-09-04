"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  defaultSocialQaAssignee,
  socialQaAssigneeOptions,
} from "@/lib/people";

type RevClientOption = { id: string; name: string };

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function NewSocialBatchPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clients, setClients] = useState<RevClientOption[]>([]);
  const [clientName, setClientName] = useState("");
  const [sproutUrl, setSproutUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewerSlug, setReviewerSlug] = useState("lana");
  const [dueOn, setDueOn] = useState(tomorrowYmd);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"draft" | "send" | "">("");
  const assignees = socialQaAssigneeOptions();

  useEffect(() => {
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setClients(d.clients.map((c: RevClientOption) => ({ id: c.id, name: c.name })));
      });
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const slug = d?.owner ? "michael" : d?.person || "";
        if (slug) setReviewerSlug(defaultSocialQaAssignee(slug));
      });
  }, []);

  async function submit(sendForReview: boolean) {
    setLoading(sendForReview ? "send" : "draft");
    setError("");
    const res = await fetch("/api/social-qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        clientName,
        clientId:
          clients.find((c) => c.name.toLowerCase() === clientName.trim().toLowerCase())
            ?.id || null,
        sproutUrl,
        notes,
        sendForReview,
        reviewerSlug,
        dueOn,
      }),
    });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not create the batch.");
      setLoading("");
      return;
    }
    const id = data.batch?.id;
    if (!id) {
      setError("Could not create the batch.");
      setLoading("");
      return;
    }
    const q = data.error ? `?error=${encodeURIComponent(data.error)}` : "";
    router.push(`/admin/social-qa/${id}${q}`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submit(true);
  }

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/social-qa">
          Back
        </Link>
      </div>
      <main className="container">
        <form
          className="card card-pad stack"
          onSubmit={onSubmit}
          style={{ maxWidth: 720, margin: "0 auto" }}
        >
          <div>
            <h1 className="h1">New social batch</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Paste the Sprout queue, assign a teammate, and a Basecamp to-do is created
              for them to review it.
            </p>
          </div>
          {error ? <div className="banner banner-danger">{error}</div> : null}
          <div className="field">
            <label htmlFor="sq-title">Title</label>
            <input
              id="sq-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Humble Somm — week of Sep 8"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sq-client">Client</label>
            <input
              id="sq-client"
              list="sq-clients"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Start typing a client"
              required
            />
            <datalist id="sq-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="sq-sprout">Sprout Social link</label>
            <input
              id="sq-sprout"
              type="url"
              value={sproutUrl}
              onChange={(e) => setSproutUrl(e.target.value)}
              placeholder="https://app.sproutsocial.com/..."
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sq-reviewer">Assign to</label>
            <select
              id="sq-reviewer"
              value={reviewerSlug}
              onChange={(e) => setReviewerSlug(e.target.value)}
              required
            >
              {assignees.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sq-due">Due date</label>
            <input
              id="sq-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sq-notes">Notes</label>
            <textarea
              id="sq-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" disabled={Boolean(loading)}>
              {loading === "send" ? "Sending…" : "Create and send for review"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={Boolean(loading)}
              onClick={() => void submit(false)}
            >
              {loading === "draft" ? "Saving…" : "Save draft"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
