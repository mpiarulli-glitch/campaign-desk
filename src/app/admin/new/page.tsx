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
import {
  TRIGGER_KINDS,
  coerceTriggerFormFormat,
  coerceTriggerKind,
  type Presentation,
  type TriggerFormFormat,
  type TriggerKind,
} from "@/lib/automation-map";

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
  const [presentation, setPresentation] = useState<Presentation>("package");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("tag");
  const [triggerLabel, setTriggerLabel] = useState("");
  const [triggerFormFormat, setTriggerFormFormat] =
    useState<TriggerFormFormat>("");
  const [triggerFormHtml, setTriggerFormHtml] = useState("");
  const [triggerFormMediaUrl, setTriggerFormMediaUrl] = useState("");

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
        presentation,
        triggerKind,
        triggerLabel,
        triggerFormFormat:
          presentation === "automation" ? triggerFormFormat : "",
        triggerFormHtml:
          presentation === "automation" && triggerFormFormat === "html"
            ? triggerFormHtml
            : "",
        triggerFormMediaUrl:
          presentation === "automation" && triggerFormFormat === "image"
            ? triggerFormMediaUrl
            : "",
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
            <label>How should the client review this?</label>
            <div className="tabs" style={{ marginTop: 4, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`tab ${presentation === "package" ? "active" : ""}`}
                onClick={() => setPresentation("package")}
              >
                Package
              </button>
              <button
                type="button"
                className={`tab ${presentation === "automation" ? "active" : ""}`}
                onClick={() => setPresentation("automation")}
              >
                Automation
              </button>
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
              {presentation === "automation"
                ? "The review link shows a map: trigger, wait times, then each email. Clicking an email opens the preview."
                : "The usual review package — tabs of emails, SMS, blogs, and the rest."}
            </p>
          </div>

          {presentation === "automation" ? (
            <div className="am-trigger-fields">
              <div className="field">
                <label htmlFor="triggerKind">What starts it</label>
                <select
                  id="triggerKind"
                  value={triggerKind}
                  onChange={(e) => setTriggerKind(coerceTriggerKind(e.target.value))}
                >
                  {TRIGGER_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="triggerLabel">Trigger</label>
                <input
                  id="triggerLabel"
                  value={triggerLabel}
                  onChange={(e) => setTriggerLabel(e.target.value)}
                  placeholder="Tag added: New patient"
                />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Opt-in form (optional)</label>
                <p className="muted" style={{ margin: "4px 0 8px", fontSize: 13 }}>
                  Attach the form people use to opt in — HTML or a screenshot.
                </p>
                <div className="tabs" style={{ marginBottom: 8 }}>
                  {(
                    [
                      { value: "", label: "None" },
                      { value: "html", label: "HTML" },
                      { value: "image", label: "Image" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value || "none"}
                      type="button"
                      className={`tab ${triggerFormFormat === opt.value ? "active" : ""}`}
                      onClick={() =>
                        setTriggerFormFormat(coerceTriggerFormFormat(opt.value))
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {triggerFormFormat === "html" ? (
                  <textarea
                    value={triggerFormHtml}
                    onChange={(e) => setTriggerFormHtml(e.target.value)}
                    placeholder="Paste the full HTML of the opt-in / pop-up form"
                    style={{ minHeight: 140, fontFamily: "var(--mono)", fontSize: 12 }}
                  />
                ) : null}
                {triggerFormFormat === "image" ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <input
                      value={
                        triggerFormMediaUrl.startsWith("data:")
                          ? ""
                          : triggerFormMediaUrl
                      }
                      onChange={(e) => setTriggerFormMediaUrl(e.target.value)}
                      placeholder="https://... (or upload a file below)"
                    />
                    <label className="btn btn-secondary btn-sm" style={{ width: "fit-content" }}>
                      {triggerFormMediaUrl.startsWith("data:")
                        ? "Image loaded — replace"
                        : "Upload image"}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () =>
                            setTriggerFormMediaUrl(String(reader.result || ""));
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

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
              {loading
                ? "Creating..."
                : presentation === "automation"
                  ? "Create automation"
                  : "Create campaign"}
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
