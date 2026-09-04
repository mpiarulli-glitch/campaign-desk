"use client";

import { kindMeta, type AssetKind, type BodyFormat } from "@/lib/asset-kinds";

// Shared content inputs for creating/adding a review asset. The fields shown
// adapt to the asset kind and its chosen body format:
//   html     -> code textarea (emails, forms, HTML blogs/decks)
//   markdown -> markdown textarea (blogs, copy decks)
//   image    -> hosted URL or file upload (mock-ups) + optional caption
//   figma    -> Figma link (mock-ups) + optional caption

const FORMAT_LABELS: Record<BodyFormat, string> = {
  html: "HTML",
  markdown: "Markdown",
  text: "Text",
  image: "Image",
  figma: "Figma link",
};

type Props = {
  kind: AssetKind;
  format: BodyFormat;
  setFormat: (f: BodyFormat) => void;
  content: string;
  setContent: (v: string) => void;
  media: string;
  setMedia: (v: string) => void;
};

export function AssetContentFields({
  kind,
  format,
  setFormat,
  content,
  setContent,
  media,
  setMedia,
}: Props) {
  const meta = kindMeta(kind);
  const formats = meta.formats;

  async function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setMedia(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {formats.length > 1 ? (
        <div className="field">
          <label>Format</label>
          <div className="tabs" style={{ marginTop: 4 }}>
            {formats.map((f) => (
              <button
                key={f}
                type="button"
                className={`tab ${format === f ? "active" : ""}`}
                onClick={() => setFormat(f)}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {format === "html" ? (
        <div className="field">
          <label htmlFor="assetContent">HTML</label>
          <textarea
            id="assetContent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              kind === "interactive"
                ? "Full HTML of the form or quiz (scripts run in preview)"
                : kind === "cold_email"
                  ? "Paste the cold email HTML"
                  : kind === "linkedin"
                    ? "Paste the LinkedIn outreach HTML"
                    : "Paste the full HTML"
            }
            style={{ minHeight: 200, fontFamily: "var(--mono)", fontSize: 12 }}
            required
          />
        </div>
      ) : null}

      {format === "text" ? (
        <div className="field">
          <label htmlFor="assetContent">Message</label>
          <textarea
            id="assetContent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Type the text message exactly as it should send."
            style={{ minHeight: 120, fontSize: 15, lineHeight: 1.5 }}
            required
          />
          {/* Each 160 characters bills as another segment, so the writer needs
              to see the count while they write, not after they send. */}
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {content.length} character{content.length === 1 ? "" : "s"} ·{" "}
            {content.length === 0
              ? 0
              : content.length <= 160
                ? 1
                : Math.ceil(content.length / 153)}{" "}
            segment{content.length > 160 || content.length === 0 ? "s" : ""}
          </p>
        </div>
      ) : null}

      {format === "markdown" ? (
        <div className="field">
          <label htmlFor="assetContent">
            {kind === "copydeck" ? "Copy deck (markdown)" : "Article (markdown)"}
          </label>
          <textarea
            id="assetContent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              "# Headline\n\nWrite in markdown. Use ## and ### for sections, - for bullets, **bold**, and [links](https://example.com)."
            }
            style={{ minHeight: 220, fontSize: 14, lineHeight: 1.6 }}
            required
          />
        </div>
      ) : null}

      {format === "image" ? (
        <>
          <div className="field">
            <label htmlFor="assetMedia">Image URL</label>
            <input
              id="assetMedia"
              value={media.startsWith("data:") ? "" : media}
              onChange={(e) => setMedia(e.target.value)}
              placeholder="https://... (or upload a file below)"
            />
          </div>
          <div className="field">
            <label className="btn btn-secondary btn-sm">
              {media.startsWith("data:") ? "Image loaded — replace" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await onFile(file);
                }}
              />
            </label>
          </div>
          <div className="field">
            <label htmlFor="assetCaption">Caption (optional)</label>
            <input
              id="assetCaption"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. Homepage hero, desktop"
            />
          </div>
        </>
      ) : null}

      {format === "figma" ? (
        <>
          <div className="field">
            <label htmlFor="assetMedia">Figma link</label>
            <input
              id="assetMedia"
              value={media}
              onChange={(e) => setMedia(e.target.value)}
              placeholder="Paste a Figma file or prototype share link"
              required
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Use a share link with view access so reviewers can open the frame.
            </p>
          </div>
          <div className="field">
            <label htmlFor="assetCaption">Caption (optional)</label>
            <input
              id="assetCaption"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. New landing page concept"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
