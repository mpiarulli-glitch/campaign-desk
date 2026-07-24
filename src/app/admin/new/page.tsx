"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AssetContentFields } from "@/components/AssetContentFields";
import {
  ASSET_KINDS,
  coerceFormat,
  type AssetKind,
  type BodyFormat,
} from "@/lib/asset-kinds";

type RevClientOption = { id: string; name: string };

export default function NewCampaignPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clients, setClients] = useState<RevClientOption[]>([]);
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [kind, setKind] = useState<AssetKind>("email");
  const [format, setFormat] = useState<BodyFormat>("html");
  const [mediaUrl, setMediaUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/revenue/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setClients(d.clients.map((c: RevClientOption) => ({ id: c.id, name: c.name }))));
  }, []);

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
        clientId: clients.find((c) => c.name.toLowerCase() === clientName.trim().toLowerCase())?.id || null,
        description,
        audience,
        htmlContent,
        kind,
        bodyFormat: format,
        mediaUrl,
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
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">
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
            <h1 className="h1">New campaign</h1>
          </div>

          <div className="field">
            <label>What is this?</label>
            <div className="tabs" style={{ marginTop: 4, flexWrap: "wrap" }}>
              {ASSET_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  className={`tab ${kind === k.kind ? "active" : ""}`}
                  onClick={() => {
                    setKind(k.kind);
                    setFormat(coerceFormat(k.kind, format));
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
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
              list="rev-clients"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
            />
            <datalist id="rev-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
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

          {format === "html" ? (
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
          ) : null}

          <AssetContentFields
            kind={kind}
            format={format}
            setFormat={setFormat}
            content={htmlContent}
            setContent={setHtmlContent}
            media={mediaUrl}
            setMedia={setMediaUrl}
          />

          {error ? <p className="error">{error}</p> : null}

          <div className="row">
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create campaign"}
            </button>
            <Link className="btn btn-secondary" href="/admin/campaigns">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
