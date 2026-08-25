"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adjacentPackageId } from "@/lib/email-package";

export type PinComment = {
  id: string;
  pin_x: number | null;
  pin_y: number | null;
  resolved: number;
  body?: string;
};

export type PackageNavItem = {
  id: string;
  title: string;
};

export type PackageNav = {
  items: PackageNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  itemLabel?: string;
};

type Props = {
  html: string;
  pins?: PinComment[];
  activePinId?: string | null;
  pinMode?: boolean;
  onPlacePin?: (xPercent: number, yPercent: number) => void;
  onSelectPin?: (id: string) => void;
  // When true the content is a form/quiz: its JS runs in a sandboxed iframe so
  // reviewers can click through it. Height is reported by the injected script.
  interactive?: boolean;
  // Turns the copy in the preview into something you can click into and type
  // over. Reports every run that now differs from the source, for
  // applyTextEdits to splice back in.
  editing?: boolean;
  onEditsChange?: (edits: PendingEdit[]) => void;
  // Prev/next across the rest of the package, shown in the device bar.
  packageNav?: PackageNav;
};

// A single run of text the reviewer has changed. `ordinal` counts occurrences
// of the original text across the document in reading order, which is what
// tells two identical labels apart when the edit is spliced back into source.
export type PendingEdit = {
  oldText: string;
  newText: string;
  ordinal: number;
};

// Copy lives in text nodes, so those are what becomes editable, via their
// parent element. Anything whose text is only whitespace is skipped: making it
// editable would put a caret in the gaps between table cells.
const NOT_EDITABLE = new Set([
  "SCRIPT",
  "STYLE",
  "TITLE",
  "HEAD",
  "META",
  "LINK",
  "NOSCRIPT",
]);

function editableHosts(doc: Document): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue || "";
    if (!text.trim()) continue;
    const host = n.parentElement;
    if (!host || NOT_EDITABLE.has(host.tagName)) continue;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// Injected into interactive previews. Reports the document height to the parent
// via postMessage on load, resize, interaction, and DOM mutation, so the iframe
// grows/shrinks as the reviewer moves through a multi-step quiz.
const HEIGHT_SCRIPT = `<script>
(function(){
  function measure(){
    return Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.offsetHeight : 0
    );
  }
  var last = 0;
  function report(){
    var v = measure();
    if (v && v !== last){ last = v; parent.postMessage({ __cdHeight: v }, "*"); }
  }
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
  document.addEventListener("click", function(){ setTimeout(report, 60); });
  document.addEventListener("input", function(){ setTimeout(report, 60); });
  if (window.ResizeObserver){ try { new ResizeObserver(report).observe(document.documentElement); } catch(e){} }
  if (window.MutationObserver){
    try { new MutationObserver(report).observe(document.documentElement, { subtree:true, childList:true, attributes:true }); } catch(e){}
  }
  setInterval(report, 800);
  report();
})();
<\/script>`;

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
  interactive = false,
  editing = false,
  onEditsChange,
  packageNav,
}: Props) {
  const pinLayerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frozenHeightRef = useRef<number | null>(null);
  const [height, setHeight] = useState(700);
  const [ready, setReady] = useState(false);
  const [hoverHref, setHoverHref] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  // When not placing a pin, let hovers/clicks reach the email so links are
  // hoverable and clickable. In pin mode the overlay captures placement clicks.
  const passThrough = !pinMode;

  const srcDoc = useMemo(() => {
    if (interactive) {
      const looksFullDoc =
        /<html[\s>]/i.test(html) || /<!doctype/i.test(html);
      if (looksFullDoc) {
        // Author supplied a full document; run it as-is and just append the
        // height reporter (before </body> when present).
        return html.includes("</body>")
          ? html.replace("</body>", `${HEIGHT_SCRIPT}</body>`)
          : html + HEIGHT_SCRIPT;
      }
      // Bare fragment: wrap it in a clean white canvas (no email chrome) and
      // let the quiz control its own styling.
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>
        html,body{margin:0;padding:0;background:#ffffff;}
        img{max-width:100%;height:auto;}
      </style></head><body>${html}${HEIGHT_SCRIPT}</body></html>`;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#f4f6f8;}
      body{padding:16px 0;}
      img{max-width:100%;height:auto;}
    </style></head><body>${html}</body></html>`;
  }, [html, interactive]);

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
    setHoverHref(null);

    // Interactive frames report their height via postMessage. Show the frame
    // as soon as it loads rather than trying to measure its document here.
    if (interactive) {
      const onLoadInteractive = () => setReady(true);
      iframe.addEventListener("load", onLoadInteractive);
      if (iframe.contentWindow) {
        // srcDoc may already be loaded.
        setReady(true);
      }
      return () => iframe.removeEventListener("load", onLoadInteractive);
    }

    // Report the destination of whatever link the mouse is over, so the parent
    // can show it in a corner bar (like a browser status bar). Requires
    // same-origin access to the srcDoc iframe (sandbox allows it).
    let doc: Document | null = null;
    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLElement | null;
      const href = anchor?.getAttribute("href")?.trim() || null;
      setHoverHref(href && href !== "#" ? href : null);
    };
    const onLeave = () => setHoverHref(null);

    const attachHover = () => {
      try {
        doc = iframe.contentDocument;
        if (!doc) return;
        doc.addEventListener("mouseover", onOver);
        doc.addEventListener("mouseleave", onLeave);
      } catch {
        // cross-origin (shouldn't happen with srcDoc) — skip hover feature
      }
    };

    const onLoad = () => {
      attachHover();
      void freezeHeight();
    };

    iframe.addEventListener("load", onLoad);
    // srcDoc may already be loaded
    if (iframe.contentDocument?.readyState === "complete") {
      attachHover();
      void freezeHeight();
    }

    return () => {
      iframe.removeEventListener("load", onLoad);
      try {
        doc?.removeEventListener("mouseover", onOver);
        doc?.removeEventListener("mouseleave", onLeave);
      } catch {
        // ignore
      }
    };
  }, [srcDoc, freezeHeight, interactive]);

  // Copy editing. The preview is a same-origin srcDoc frame, so the text in it
  // can be made editable in place and read back. What is read back is only the
  // text: the source HTML is spliced by applyTextEdits rather than
  // re-serialised from this DOM, because this DOM has already lost the parts of
  // a full document that matter most (the <head> and its media queries).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || interactive) return;

    const doc = iframe.contentDocument;
    if (!doc || !doc.body) return;

    if (!editing) {
      for (const host of editableHosts(doc)) {
        host.removeAttribute("contenteditable");
        host.removeAttribute("data-cd-editable");
      }
      return;
    }

    // The text every run started as, and how many identical runs came before
    // it. Captured once on entering edit mode so the ordinals stay fixed even
    // as the reviewer types one of them into a duplicate of another.
    const baseline = new Map<HTMLElement, { text: string; ordinal: number }[]>();
    const seen = new Map<string, number>();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue || "";
      if (!text.trim()) continue;
      const host = n.parentElement;
      if (!host || NOT_EDITABLE.has(host.tagName)) continue;
      const ordinal = seen.get(text) ?? 0;
      seen.set(text, ordinal + 1);
      const list = baseline.get(host) || [];
      list.push({ text, ordinal });
      baseline.set(host, list);
    }

    const hosts = [...baseline.keys()];
    for (const host of hosts) {
      // plaintext-only keeps the browser from dropping <span style> and <div>
      // into table markup that has to survive Outlook. Where it is unsupported
      // the attribute falls back to plain contentEditable.
      host.setAttribute("contenteditable", "plaintext-only");
      if (host.contentEditable !== "plaintext-only") {
        host.setAttribute("contenteditable", "true");
      }
      host.setAttribute("data-cd-editable", "");
    }

    const style = doc.createElement("style");
    style.id = "cd-edit-style";
    style.textContent = `
      [data-cd-editable]{outline:1px dashed rgba(37,99,235,.45);outline-offset:2px;cursor:text;}
      [data-cd-editable]:hover{outline-color:rgba(37,99,235,.9);background:rgba(37,99,235,.06);}
      [data-cd-editable]:focus{outline:2px solid #2563eb;outline-offset:2px;background:rgba(37,99,235,.08);}
    `;
    doc.head?.appendChild(style);

    const collect = () => {
      const edits: PendingEdit[] = [];
      for (const [host, runs] of baseline) {
        const current: string[] = [];
        const w = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n.nodeValue || "";
          if (t.trim()) current.push(t);
        }
        // A run count that no longer matches means typing merged or split the
        // text nodes, and pairing them off by position would put copy in the
        // wrong place. Those are left out rather than guessed at.
        if (current.length !== runs.length) continue;
        runs.forEach((run, i) => {
          if (current[i] !== run.text) {
            edits.push({
              oldText: run.text,
              newText: current[i],
              ordinal: run.ordinal,
            });
          }
        });
      }
      onEditsChange?.(edits);
    };

    doc.addEventListener("input", collect);
    // Typing changes how tall the email is, so the frame has to follow.
    const onInput = () => setHeight(measureDocHeight(doc));
    doc.addEventListener("input", onInput);

    return () => {
      doc.removeEventListener("input", collect);
      doc.removeEventListener("input", onInput);
      doc.getElementById("cd-edit-style")?.remove();
      for (const host of hosts) {
        host.removeAttribute("contenteditable");
        host.removeAttribute("data-cd-editable");
      }
    };
  }, [editing, srcDoc, ready, interactive, onEditsChange]);

  // Interactive frames report their own height via postMessage. Match the
  // message to this instance's iframe so multiple previews on one page (e.g.
  // the admin "Current" vs "AI version" split) don't cross wires.
  useEffect(() => {
    if (!interactive) return;
    function onMessage(e: MessageEvent) {
      const iframe = iframeRef.current;
      if (iframe && e.source !== iframe.contentWindow) return;
      const data = e.data as { __cdHeight?: unknown } | null;
      if (data && typeof data.__cdHeight === "number") {
        const next = Math.max(300, Math.min(6000, Math.round(data.__cdHeight)));
        setHeight(next);
        setReady(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [interactive]);

  // Re-measure height when switching device width: the email reflows (mobile
  // is usually taller), so the frozen height must be recomputed.
  useEffect(() => {
    if (iframeRef.current?.contentDocument?.readyState === "complete") {
      void freezeHeight();
    }
  }, [device, freezeHeight]);

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

  const packageItems = packageNav?.items ?? [];
  const showPackageNav = packageItems.length > 1;
  const packageIds = packageItems.map((item) => item.id);
  const activePackageIndex = packageNav
    ? packageIds.indexOf(packageNav.activeId)
    : -1;
  const prevPackageId = packageNav
    ? adjacentPackageId(packageIds, packageNav.activeId, -1)
    : null;
  const nextPackageId = packageNav
    ? adjacentPackageId(packageIds, packageNav.activeId, 1)
    : null;
  const itemLabel = packageNav?.itemLabel || "email";
  const activePackageTitle =
    activePackageIndex >= 0 ? packageItems[activePackageIndex]?.title : "";

  return (
    <div className="preview-frame-wrap">
      <div
        className={`preview-devicebar${showPackageNav ? " has-package" : ""}`}
      >
        {showPackageNav && packageNav ? (
          <div className="preview-package-nav">
            <button
              type="button"
              className="preview-package-btn"
              aria-label={`Previous ${itemLabel}`}
              disabled={!prevPackageId}
              onClick={() => {
                if (prevPackageId) packageNav.onSelect(prevPackageId);
              }}
            >
              ‹
            </button>
            <span className="preview-package-label">
              <span className="preview-package-count">
                {activePackageIndex + 1} of {packageItems.length}
              </span>
              {activePackageTitle ? (
                <span className="preview-package-title">
                  {activePackageTitle}
                </span>
              ) : null}
            </span>
          </div>
        ) : (
          <div />
        )}
        <div className="preview-devices">
          <button
            type="button"
            className={`preview-device-btn ${device === "desktop" ? "active" : ""}`}
            onClick={() => setDevice("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            className={`preview-device-btn ${device === "mobile" ? "active" : ""}`}
            onClick={() => setDevice("mobile")}
          >
            Mobile
          </button>
        </div>
        {showPackageNav && packageNav ? (
          <div className="preview-package-nav preview-package-nav-end">
            <button
              type="button"
              className="preview-package-btn"
              aria-label={`Next ${itemLabel}`}
              disabled={!nextPackageId}
              onClick={() => {
                if (nextPackageId) packageNav.onSelect(nextPackageId);
              }}
            >
              ›
            </button>
          </div>
        ) : (
          <div />
        )}
      </div>
      {!ready ? (
        <div className="preview-loading">
          {interactive ? "Loading preview..." : "Loading email preview..."}
        </div>
      ) : null}
      <div
        className={`preview-canvas ${interactive ? "interactive" : ""} ${
          ready ? "is-ready" : "is-loading"
        }`}
        style={{
          height,
          width: device === "mobile" ? 390 : undefined,
          margin: device === "mobile" ? "0 auto" : undefined,
        }}
      >
        <iframe
          ref={iframeRef}
          title={interactive ? "Interactive preview" : "Email preview"}
          srcDoc={srcDoc}
          sandbox={
            interactive
              ? "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
              : "allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          }
          style={{
            height,
            width: "100%",
            pointerEvents: passThrough ? "auto" : "none",
          }}
        />
        <div
          ref={pinLayerRef}
          className={`pin-layer ${pinMode && ready ? "clickable" : ""}`}
          onClick={handleClick}
          style={{
            height,
            width: "100%",
            pointerEvents: passThrough ? "none" : "auto",
          }}
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
      {hoverHref ? (
        <div className="link-hover-bar" title={hoverHref}>
          <span className="link-hover-icon" aria-hidden="true">
            🔗
          </span>
          {hoverHref}
        </div>
      ) : null}
    </div>
  );
}
