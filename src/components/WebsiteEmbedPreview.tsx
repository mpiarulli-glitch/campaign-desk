"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  WEBSITE_PREVIEW_MESSAGE,
  WEBSITE_PREVIEW_SANDBOX,
  buildWebsitePreviewSrcDoc,
  findEmbedOpenTrigger,
  previewFitScale,
  previewFrameBox,
  type PreviewDevice,
} from "@/lib/website-embed-preview";

type Mode = "inline" | "website";

export function EmbedPreviewSwitch({
  enabled,
  html,
  children,
  initialMode = "inline",
}: {
  enabled: boolean;
  html: string;
  children: ReactNode;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  if (!enabled) return children;
  const website = mode === "website";
  return (
    <div className="wep" data-website-preview-root>
      <div className="wep-modes" role="tablist" aria-label="Preview mode">
        <button
          type="button"
          role="tab"
          className={`preview-device-btn ${website ? "" : "active"}`}
          aria-selected={!website}
          data-preview-mode-tab="inline"
          onClick={() => setMode("inline")}
        >
          Inline preview
        </button>
        <button
          type="button"
          role="tab"
          className={`preview-device-btn ${website ? "active" : ""}`}
          aria-selected={website}
          data-preview-mode-tab="website"
          onClick={() => setMode("website")}
        >
          Preview on a website
        </button>
      </div>
      {website ? <WebsiteEmbedPreview html={html} /> : children}
    </div>
  );
}

export function WebsiteEmbedPreview({
  html,
  initialDevice = "desktop",
}: {
  html: string;
  initialDevice?: PreviewDevice;
}) {
  const [device, setDevice] = useState<PreviewDevice>(initialDevice);
  const [replayKey, setReplayKey] = useState(0);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildWebsitePreviewSrcDoc(html), [html]);
  const openTrigger = useMemo(() => findEmbedOpenTrigger(html), [html]);
  const box = previewFrameBox(device);

  useEffect(() => {
    const sizer = sizerRef.current;
    if (!sizer) return;
    const measure = () => {
      const next = previewFitScale(sizer.clientWidth, box.width);
      setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sizer);
    return () => observer.disconnect();
  }, [box.width]);

  const scaledWidth = Math.round(box.width * scale);
  const scaledHeight = Math.round(box.height * scale);

  function postToFrame(action: "open" | "clear-storage") {
    iframeRef.current?.contentWindow?.postMessage(
      { type: WEBSITE_PREVIEW_MESSAGE, action },
      "*"
    );
  }

  return (
    <div className="wep-card" data-website-preview>
      <div className="wep-toolbar">
        <div className="preview-devices" role="group" aria-label="Preview device">
          <button
            type="button"
            className={`preview-device-btn ${device === "desktop" ? "active" : ""}`}
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            className={`preview-device-btn ${device === "mobile" ? "active" : ""}`}
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            Mobile
          </button>
        </div>
        <div className="wep-toolbar-actions">
          {openTrigger ? (
            <button type="button" className="preview-device-btn" onClick={() => postToFrame("open")}>
              Open now
            </button>
          ) : null}
          <button
            type="button"
            className="preview-device-btn"
            onClick={() => {
              postToFrame("clear-storage");
              setReplayKey((key) => key + 1);
            }}
          >
            Replay
          </button>
        </div>
      </div>
      <p className="wep-note">
        Exit intent fires when the mouse leaves the top of the desktop frame.
        Replay reloads the page and clears this preview&apos;s storage, so a snoozed pop-up can show again.
      </p>
      <div
        ref={stageRef}
        className={`wep-stage is-${device}`}
        data-preview-device={device}
      >
        <div ref={sizerRef} className="wep-sizer" />
        <div className="wep-browser" style={{ width: scaledWidth }}>
          {device === "desktop" ? (
            <div className="wep-chrome" aria-hidden="true">
              <span className="wep-dots" />
              <span className="wep-url">northline.example</span>
            </div>
          ) : null}
          <div
            className={`wep-frame is-${device}`}
            style={{ width: scaledWidth, height: scaledHeight }}
          >
            <iframe
              key={replayKey}
              ref={iframeRef}
              title="Website preview"
              sandbox={WEBSITE_PREVIEW_SANDBOX}
              referrerPolicy="no-referrer"
              srcDoc={srcDoc}
              data-preview-viewport-width={box.width}
              data-preview-viewport-height={box.height}
              style={{
                width: box.width,
                height: box.height,
                transform: scale === 1 ? undefined : `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
