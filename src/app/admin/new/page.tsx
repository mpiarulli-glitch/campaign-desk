"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Brand } from "@/components/Brand";

export default function NewCampaignPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [kind, setKind] = useState<"email" | "interactive">("email");
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function readFile(file: File) {
    const text = await file.text();
    setHtmlContent(text);
    setFileName(file.name);
    if (!title) {
      setTitle(file.name.replace(/\.html?$/i, "").replace(/[-_]/g, " "));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        clientName,
        description,
        audience,
        htmlContent,
        kind,
      }),
    });

    if (res.status === 401) {
      router.push("/login");
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not create campaign.");
      setLoading(false);
      return;
    }

    const data = await res.json();
    router.push(`/admin/campaigns/${data.campaign.id}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <Link className="btn btn-ghost btn-sm" href="/admin">
          Back
        </Link>
      </header>

      <main className="container">
        <form
          className="card card-pad stack"
          onSubmit={onSubmit}
          style={{ maxWidth: 720, margin: "0 auto" }}
        >
          <div>
            <p className="eyebrow">New upload</p>
            <h1 className="h1">New campaign</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              {kind === "interactive"
                ? "Upload a form or quiz built in HTML. Its scripts run so reviewers can click through it."
                : "Upload an HTML email file or paste the markup below."}
            </p>
          </div>

          <div className="field">
            <label>What is this?</label>
            <div className="tabs" style={{ marginTop: 4 }}>
              <button
                type="button"
                className={`tab ${kind === "email" ? "active" : ""}`}
                onClick={() => setKind("email")}
              >
                Email
              </button>
              <button
                type="button"
                className={`tab ${kind === "interactive" ? "active" : ""}`}
                onClick={() => setKind("interactive")}
              >
                Form / quiz
              </button>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              {kind === "interactive"
                ? "Interactive: JavaScript runs in a sandboxed frame. Best for quizzes and forms."
                : "Static email: scripts are stripped, rendered like an inbox preview."}
            </p>
          </div>

          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="July promo email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="client">Client (optional)</label>
            <input
              id="client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
            />
          </div>

          <div className="field">
            <label htmlFor="description">Notes for reviewer (optional)</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything your boss should know before reviewing"
            />
          </div>

          <div className="field">
            <label htmlFor="audience">Audience (optional)</label>
            <input
              id="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. Past customers who bought in the last 90 days"
            />
          </div>

          <div
            className={`dropzone ${dragActive ? "active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) await readFile(file);
            }}
          >
            <p style={{ margin: 0 }}>
              {fileName
                ? `Loaded: ${fileName}`
                : "Drop an .html file here, or choose one"}
            </p>
            <label
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12 }}
            >
              Choose file
              <input
                type="file"
                accept=".html,text/html"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await readFile(file);
                }}
              />
            </label>
          </div>

          <div className="field">
            <label htmlFor="html">HTML content</label>
            <textarea
              id="html"
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              placeholder={
                kind === "interactive"
                  ? "Paste the full HTML of your form or quiz (scripts included)"
                  : "Paste full HTML email here"
              }
              style={{ minHeight: 220, fontFamily: "var(--mono)", fontSize: 12 }}
              required
            />
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="row">
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create campaign"}
            </button>
            <Link className="btn btn-secondary" href="/admin">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
