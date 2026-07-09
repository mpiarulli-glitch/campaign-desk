"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PinComment = {
  id: string;
  pin_x: number | null;
  pin_y: number | null;
  resolved: number;
  body?: string;
};

type Props = {
  html: string;
  pins?: PinComment[];
  activePinId?: string | null;
  pinMode?: boolean;
  onPlacePin?: (xPercent: number, yPercent: number) => void;
  onSelectPin?: (id: string) => void;
  interactiveEmail?: boolean;
};

async function waitForImages(doc: Document): Promise<void> {
  const images = Array.from(doc.images || []);
  if (images.length === 0) return;

  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    )
  );
}

function measureDocHeight(doc: Document): number {
  const body = doc.body;
  const htmlEl = doc.documentElement;
  return Math.max(
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    htmlEl?.scrollHeight || 0,
    htmlEl?.offsetHeight || 0,
    500
  );
}

export function EmailPreview({
  html,
  pins = [],
  activePinId,
  pinMode = false,
  onPlacePin,
  onSelectPin,
  interactiveEmail = false,
}: Props) {
  const pinLayerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frozenHeightRef = useRef<number | null>(null);
  const [height, setHeight] = useState(700);
  const [ready, setReady] = useState(false);

  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#f4f6f8;}
      body{padding:16px 0;}
      img{max-width:100%;height:auto;}
    </style></head><body>${html}</body></html>`;
  }, [html]);

  const freezeHeight = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;

      await waitForImages(doc);
      // One more frame after images so layout can settle
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );

      const measured = measureDocHeight(doc);
      // Freeze once per HTML load so pins never drift from remeasurement
      frozenHeightRef.current = measured;
      setHeight(measured);
      setReady(true);
    } catch {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    frozenHeightRef.current = null;
    setReady(false);
    setHeight(700);

    const onLoad = () => {
      void freezeHeight();
    };

    iframe.addEventListener("load", onLoad);
    // srcDoc may already be loaded
    if (iframe.contentDocument?.readyState === "complete") {
      void freezeHeight();
    }

    return () => {
      iframe.removeEventListener("load", onLoad);
    };
  }, [srcDoc, freezeHeight]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!pinMode || !onPlacePin || !ready) return;

    const layer = pinLayerRef.current;
    if (!layer) return;

    // Use offset dimensions (stable layout size), not viewport-clamped rect height
    const width = layer.offsetWidth || 1;
    const heightPx = layer.offsetHeight || frozenHeightRef.current || 1;
    const rect = layer.getBoundingClientRect();

    const x = ((e.clientX - rect.left) / width) * 100;
    const y = ((e.clientY - rect.top) / heightPx) * 100;

    onPlacePin(
      Math.min(100, Math.max(0, Number(x.toFixed(3)))),
      Math.min(100, Math.max(0, Number(y.toFixed(3))))
    );
  }

  const inlinePins = pins.filter(
    (p) => p.pin_x !== null && p.pin_y !== null
  );

  return (
    <div className="preview-frame-wrap">
      {!ready ? (
        <div className="preview-loading">Loading email preview...</div>
      ) : null}
      <div
        className={`preview-canvas ${interactiveEmail ? "interactive" : ""} ${
          ready ? "is-ready" : "is-loading"
        }`}
        style={{ height }}
      >
        <iframe
          ref={iframeRef}
          title="Email preview"
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          style={{ height, width: "100%" }}
        />
        <div
          ref={pinLayerRef}
          className={`pin-layer ${pinMode && ready ? "clickable" : ""}`}
          onClick={handleClick}
          style={{ height, width: "100%" }}
        >
          {ready
            ? inlinePins.map((pin, index) => (
                <button
                  key={pin.id}
                  type="button"
                  className={`pin ${pin.resolved ? "resolved" : ""} ${
                    activePinId === pin.id ? "active" : ""
                  }`}
                  style={{
                    left: `${pin.pin_x}%`,
                    top: `${pin.pin_y}%`,
                  }}
                  title={pin.body || `Comment ${index + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPin?.(pin.id);
                  }}
                  aria-label={`Gorilla pin ${index + 1}`}
                >
                  <span className="pin-face" aria-hidden="true">
                    🦍
                  </span>
                  <span className="pin-num">{index + 1}</span>
                </button>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
