"use client";

import { FormEvent, useRef, useState } from "react";
import {
  CAMPAIGN_DESCRIPTION_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
  normalizeCampaignDescription,
  normalizeCampaignTitle,
} from "@/lib/campaign-copy";

type SavedCampaign = {
  title: string;
  description: string;
  updated_at: string;
};

function PencilIcon() {
  return (
    <svg className="cd-pkg-edit-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h4L20 8l-4-4L4 16v4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Inline editor for the package heading and the note under it. Enter saves
// from either field. Shift+Enter in the description inserts a line break,
// which is how a multi-line note keeps its formatting on the review link.
// Escape cancels.
export function CampaignCopyFields({
  campaignId,
  title,
  description,
  disabled,
  onUpdated,
}: {
  campaignId: string;
  title: string;
  description: string;
  disabled?: boolean;
  onUpdated: (campaign: SavedCampaign) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  function begin() {
    setTitleDraft(title);
    setDescriptionDraft(description);
    setError("");
    setEditing(true);
  }

  function cancel() {
    setTitleDraft(title);
    setDescriptionDraft(description);
    setError("");
    setEditing(false);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (savingRef.current) return;

    const nextTitle = normalizeCampaignTitle(titleDraft, title);
    if (!nextTitle.ok) {
      setError(nextTitle.error);
      return;
    }
    const nextDescription = normalizeCampaignDescription(
      descriptionDraft,
      description
    );
    if (!nextDescription.ok) {
      setError(nextDescription.error);
      return;
    }

    const currentTitle = normalizeCampaignTitle(title, title);
    const currentDescription = normalizeCampaignDescription(
      description,
      description
    );
    if (
      currentTitle.ok &&
      currentDescription.ok &&
      nextTitle.title === currentTitle.title &&
      nextDescription.description === currentDescription.description
    ) {
      setEditing(false);
      setError("");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    let data: { error?: string; campaign?: { title?: string; description?: string; updated_at?: string } } = {};
    let ok = false;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle.title,
          description: nextDescription.description,
        }),
      });
      data = await res.json().catch(() => ({}));
      ok = res.ok;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!ok) {
      setError(data.error || "Could not save the title and description.");
      return;
    }
    const saved = data.campaign;
    if (saved && typeof saved.title === "string") {
      onUpdated({
        title: saved.title,
        description: typeof saved.description === "string" ? saved.description : "",
        updated_at:
          typeof saved.updated_at === "string" ? saved.updated_at : "",
      });
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="cd-pkg-copy">
        <div className="cd-pkg-title-row">
          <h1 className="h1">{title}</h1>
          <button
            type="button"
            className="btn btn-ghost btn-sm cd-pkg-edit"
            onClick={begin}
            disabled={disabled}
            aria-label="Edit title and description"
          >
            <PencilIcon />
            Edit
          </button>
        </div>
        {description ? (
          <p className="body-text cd-pkg-desc">{description}</p>
        ) : (
          <p className="muted cd-pkg-desc">No description yet.</p>
        )}
      </div>
    );
  }

  const titleCount = titleDraft.replace(/\r\n?/g, "\n").replace(/\n+/g, " ").trim()
    .length;
  const descriptionCount = descriptionDraft.replace(/\r\n?/g, "\n").trim().length;

  return (
    <form className="cd-pkg-copy cd-pkg-copy-form" onSubmit={save}>
      <div className="field">
        <label htmlFor="pkg-title">Title</label>
        <input
          id="pkg-title"
          value={titleDraft}
          autoFocus
          disabled={saving}
          aria-label="Package title"
          aria-invalid={Boolean(error)}
          autoComplete="off"
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
        <span className="muted cd-pkg-copy-count">
          {titleCount} / {CAMPAIGN_TITLE_MAX_LENGTH}
        </span>
      </div>
      <div className="field">
        <label htmlFor="pkg-description">Description</label>
        <textarea
          id="pkg-description"
          value={descriptionDraft}
          disabled={saving}
          aria-label="Package description"
          aria-invalid={Boolean(error)}
          autoComplete="off"
          placeholder="Shown on the client review link"
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
              return;
            }
            // Enter saves. Shift+Enter keeps a line break so the note can
            // stay a paragraph with the formatting the client already sees.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <span className="muted cd-pkg-copy-count">
          {descriptionCount} / {CAMPAIGN_DESCRIPTION_MAX_LENGTH}
        </span>
      </div>
      {error ? (
        <p className="error" id="pkg-copy-error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : (
        <p className="muted cd-pkg-copy-hint" id="pkg-copy-hint">
          Enter saves. Shift+Enter adds a line. Escape cancels.
        </p>
      )}
      <div className="cd-pkg-copy-actions">
        <button type="submit" className="btn btn-sm" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={cancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
