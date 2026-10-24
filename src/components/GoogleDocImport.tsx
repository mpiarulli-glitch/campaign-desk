"use client";

import { useId, useState } from "react";

type Imported = { markdown: string; title: string; saved: boolean };

// One field and one button. The sharing instruction only appears when the
// doc cannot be read.
export function GoogleDocImport({
  campaignId,
  emailId,
  hasContent,
  onImported,
}: {
  campaignId?: string;
  emailId?: string;
  hasContent?: boolean;
  onImported: (result: Imported) => void;
}) {
  const inputId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    const link = url.trim();
    if (!link || busy) return;
    if (
      hasContent &&
      !window.confirm("Replace the article with this Google Doc?")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns/google-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: link,
          campaignId: campaignId || undefined,
          emailId: emailId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("You don't have permission to change this blog post.");
        return;
      }
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Could not import that Google Doc."
        );
        return;
      }
      const markdown = typeof data.markdown === "string" ? data.markdown : "";
      if (!markdown.trim()) {
        setError("That document doesn't have any article text.");
        return;
      }
      setUrl("");
      onImported({
        markdown,
        title: typeof data.title === "string" ? data.title : "",
        saved: Boolean(data.saved),
      });
    } catch {
      setError("Could not import that Google Doc. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>Import from Google Doc</label>
      <div className="row" style={{ alignItems: "center" }}>
        <input
          id={inputId}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="https://docs.google.com/document/d/..."
          style={{ flex: 1, minWidth: 0 }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void run()}
          disabled={busy || !url.trim()}
        >
          {busy ? "Importing..." : "Import"}
        </button>
      </div>
      {error ? (
        <p className="error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
