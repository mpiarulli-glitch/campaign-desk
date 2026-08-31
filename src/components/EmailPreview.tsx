"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adjacentPackageId } from "@/lib/email-package";
import {
  MOBILE_PREVIEW_WIDTH,
  buildPreviewSrcDoc,
  fitScaleForPreview,
  measureEmailContentWidth,
  measurePreviewDocumentHeight,
} from "@/lib/email-preview";
import {
  QUOTE_MARK_ATTR,
  applyQuoteMarks,
  isCopyQuote,
  quoteFromSelection,
  selectionViewportRect,
  type CopyQuote,
  type QuoteMark,
} from "@/lib/copy-quote";

export type PinComment = {
  id: string;
  pin_x: number | null;
  pin_y: number | null;
  quote_text?: string | null;
  quote_ordinal?: number | null;
  resolved: number;
  body?: string;
  author_name?: string;
};

export type InlineFeedbackPayload = {
  body: string;
  authorName: string;
  pinX?: number;
  pinY?: number;
  quote?: CopyQuote;
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
  // Name field shared with the approve box on the review link.
  authorName?: string;
  onAuthorNameChange?: (name: string) => void;
  // When set, selecting copy or dropping a pin opens a compose popup here.
  onSubmitInline?: (payload: InlineFeedbackPayload) => Promise<boolean>;
  // Delete a pin or highlight from the hover tip.
  onDeleteComment?: (id: string) => void;
};

const QUOTE_STYLE = `
  html, body, body *{
    -webkit-user-select: text !important;
    user-select: text !important;
  }
  mark[${QUOTE_MARK_ATTR}]{
    background: rgba(0, 212, 232, 0.38);
    color: inherit;
    padding: 0 1px;
    cursor: pointer;
    border-radius: 2px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  mark[${QUOTE_MARK_ATTR}].is-active{
    background: rgba(0, 212, 232, 0.72);
    outline: 2px solid #04808d;
    outline-offset: 1px;
  }
  mark[${QUOTE_MARK_ATTR}].is-resolved{
    background: rgba(148, 163, 184, 0.4);
  }
  mark[${QUOTE_MARK_ATTR}].is-pending{
    background: rgba(37, 99, 235, 0.28);
    outline: 2px dashed #2563eb;
    outline-offset: 1px;
  }
`;

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

type ComposeState = {
  kind: "quote" | "pin";
  top: number;
  left: number;
  quote?: CopyQuote;
  pinX?: number;
  pinY?: number;
};

type TipState = {
  top: number;
  left: number;
  comment: PinComment;
};

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
  authorName = "",
  onAuthorNameChange,
  onSubmitInline,
  onDeleteComment,
}: Props) {
  const pinLayerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const frozenHeightRef = useRef<number | null>(null);
  const lastFitRef = useRef(1);
  const onSelectPinRef = useRef(onSelectPin);
  onSelectPinRef.current = onSelectPin;
  const tipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [height, setHeight] = useState(700);
  const [ready, setReady] = useState(false);
  const [hoverHref, setHoverHref] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [fitScale, setFitScale] = useState(1);
  const [fitContentWidth, setFitContentWidth] = useState(MOBILE_PREVIEW_WIDTH);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [composeError, setComposeError] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);
  const composeTextRef = useRef<HTMLTextAreaElement>(null);

  // When not placing a pin, let hovers/clicks reach the email so links are
  // hoverable and clickable. In pin mode the overlay captures placement clicks.
  const passThrough = !pinMode;

  const srcDoc = useMemo(
    () =>
      buildPreviewSrcDoc(html, {
        interactive,
        heightScript: HEIGHT_SCRIPT,
      }),
    [html, interactive]
  );

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

      const measured = measurePreviewDocumentHeight(doc, iframe);
      // Freeze once per HTML load so pins never drift from remeasurement
      frozenHeightRef.current = measured;
      setHeight(measured);

      // Phone frame is 390px. A 600px table (or a 320px table left-aligned on
      // a white body) has to be scaled to fill it — that's what Gmail does on
      // a real phone. Interactive quizzes keep native width so clicks line up.
      if (!interactive && device === "mobile") {
        const contentWidth = measureEmailContentWidth(doc);
        const scale = fitScaleForPreview(contentWidth, MOBILE_PREVIEW_WIDTH);
        setFitScale((prev) => (Math.abs(prev - scale) < 0.001 ? prev : scale));
        setFitContentWidth((prev) => {
          const next =
            scale === 1 ? MOBILE_PREVIEW_WIDTH : Math.round(contentWidth);
          return prev === next ? prev : next;
        });
      } else {
        setFitScale((prev) => (prev === 1 ? prev : 1));
        setFitContentWidth((prev) =>
          prev === MOBILE_PREVIEW_WIDTH ? prev : MOBILE_PREVIEW_WIDTH
        );
      }

      setReady(true);
    } catch {
      setReady(true);
    }
  }, [device, interactive]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    frozenHeightRef.current = null;
    lastFitRef.current = 1;
    setReady(false);
    setHeight(700);
    setHoverHref(null);
    setFitScale(1);
    setFitContentWidth(MOBILE_PREVIEW_WIDTH);

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
    const onInput = () =>
      setHeight(measurePreviewDocumentHeight(doc, iframe));
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

  const quoteMarks = useMemo((): QuoteMark[] => {
    const saved = pins.filter(isCopyQuote);
    const marks: QuoteMark[] = saved.map((p, i) => ({
      id: p.id,
      text: p.quote_text || "",
      ordinal: p.quote_ordinal ?? 0,
      resolved: Boolean(p.resolved),
      active: activePinId === p.id,
      number: i + 1,
    }));
    if (compose?.kind === "quote" && compose.quote?.text) {
      marks.push({
        id: "pending",
        text: compose.quote.text,
        ordinal: compose.quote.ordinal,
        pending: true,
      });
    }
    return marks;
  }, [pins, activePinId, compose]);

  const quoteSignature = quoteMarks
    .map(
      (m) =>
        `${m.id}:${m.text}:${m.ordinal}:${m.resolved ? 1 : 0}:${m.active ? 1 : 0}:${m.pending ? 1 : 0}`
    )
    .join("|");
  const quoteMarksRef = useRef(quoteMarks);
  quoteMarksRef.current = quoteMarks;

  // Paint highlight marks inside the preview. Injected <mark>s never go back
  // into stored HTML; they are a visual overlay on the live DOM.
  useEffect(() => {
    if (!ready || editing) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body) return;

    let style = doc.getElementById("cd-quote-style");
    if (!style) {
      style = doc.createElement("style");
      style.id = "cd-quote-style";
      style.textContent = QUOTE_STYLE;
      doc.head?.appendChild(style);
    }

    applyQuoteMarks(doc.body, quoteMarksRef.current);

    const mapRectToCanvas = (rect: DOMRect) => {
      const iframe = iframeRef.current;
      const canvas = canvasRef.current;
      if (!iframe || !canvas) return null;
      const iframeBox = iframe.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      const scale = fitScale !== 1 ? fitScale : 1;
      return {
        top: iframeBox.top - canvasBox.top + (rect.bottom + 8) * scale,
        left: Math.max(
          140,
          Math.min(
            canvasBox.width - 140,
            iframeBox.left - canvasBox.left + (rect.left + rect.width / 2) * scale
          )
        ),
      };
    };

    const showTipForId = (id: string, rect: DOMRect) => {
      const comment = pinsRef.current.find((p) => p.id === id);
      if (!comment?.body) return;
      const pos = mapRectToCanvas(rect);
      if (!pos) return;
      if (tipHideTimer.current) clearTimeout(tipHideTimer.current);
      setTip({ ...pos, comment });
    };

    const onMarkClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const mark = target?.closest?.(`mark[${QUOTE_MARK_ATTR}]`);
      const id = mark?.getAttribute(QUOTE_MARK_ATTR);
      if (!id || id === "pending") return;
      e.preventDefault();
      e.stopPropagation();
      onSelectPinRef.current?.(id);
    };
    const onMarkOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const mark = target?.closest?.(
        `mark[${QUOTE_MARK_ATTR}]`
      ) as HTMLElement | null;
      const id = mark?.getAttribute(QUOTE_MARK_ATTR);
      if (!mark || !id || id === "pending") return;
      showTipForId(id, mark.getBoundingClientRect());
    };
    const onMarkOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Element | null;
      if (related?.closest?.(`mark[${QUOTE_MARK_ATTR}]`)) return;
      tipHideTimer.current = setTimeout(() => setTip(null), 180);
    };
    doc.addEventListener("click", onMarkClick, true);
    doc.addEventListener("mouseover", onMarkOver);
    doc.addEventListener("mouseout", onMarkOut);

    const activeId = quoteMarksRef.current.find((m) => m.active)?.id;
    if (activeId) {
      const active = doc.querySelector(
        `mark[${QUOTE_MARK_ATTR}="${CSS.escape(activeId)}"]`
      );
      active?.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    return () => {
      doc.removeEventListener("click", onMarkClick, true);
      doc.removeEventListener("mouseover", onMarkOver);
      doc.removeEventListener("mouseout", onMarkOut);
    };
  }, [quoteSignature, ready, editing, srcDoc, fitScale]);

  const canCompose = Boolean(onSubmitInline) && !editing;

  // Select copy → open a compose card right next to the passage.
  useEffect(() => {
    if (!ready || !canCompose || pinMode) return;
    const iframeEl = iframeRef.current;
    const canvasEl = canvasRef.current;
    const previewDoc = iframeEl?.contentDocument;
    const root = previewDoc?.body;
    if (!iframeEl || !canvasEl || !previewDoc || !root) return;
    const iframe: HTMLIFrameElement = iframeEl;
    const canvas: HTMLDivElement = canvasEl;
    const doc: Document = previewDoc;
    const body: HTMLElement = root;

    function openQuoteCompose(quote: CopyQuote, rect: DOMRect) {
      const iframeBox = iframe.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      const scale = fitScale !== 1 ? fitScale : 1;
      const cardH = 220;
      const preferred =
        iframeBox.top - canvasBox.top + (rect.bottom + 10) * scale;
      const maxTop = Math.max(
        8,
        canvasBox.height - Math.min(cardH, canvasBox.height)
      );
      const top = Math.max(8, Math.min(maxTop, preferred));
      const left = Math.max(
        150,
        Math.min(
          canvasBox.width - 150,
          iframeBox.left - canvasBox.left + (rect.left + rect.width / 2) * scale
        )
      );
      setCompose({ kind: "quote", quote, top, left });
      setComposeBody("");
      setComposeError("");
      requestAnimationFrame(() => composeTextRef.current?.focus());
    }

    function readSelection() {
      const sel = doc.getSelection();
      const quote = quoteFromSelection(body, sel);
      const rect = selectionViewportRect(sel);
      if (!quote || !rect) return;
      openQuoteCompose(quote, rect);
      sel?.removeAllRanges();
    }

    const onMouseUp = () => {
      requestAnimationFrame(readSelection);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCompose(null);
        doc.getSelection()?.removeAllRanges();
      }
    };

    doc.addEventListener("mouseup", onMouseUp);
    doc.addEventListener("touchend", onMouseUp);
    doc.addEventListener("keyup", onKeyUp);
    return () => {
      doc.removeEventListener("mouseup", onMouseUp);
      doc.removeEventListener("touchend", onMouseUp);
      doc.removeEventListener("keyup", onKeyUp);
    };
  }, [ready, canCompose, pinMode, srcDoc, fitScale]);

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
  // is usually taller), so the frozen height must be recomputed. Reset scale
  // first so we measure at the new iframe width, not a leftover 600px layout.
  useEffect(() => {
    lastFitRef.current = 1;
    setFitScale(1);
    setFitContentWidth(MOBILE_PREVIEW_WIDTH);
    if (iframeRef.current?.contentDocument?.readyState === "complete") {
      void freezeHeight();
    }
  }, [device, freezeHeight]);

  // After a fit scale is applied the iframe is as wide as the email (e.g.
  // 600px), then CSS-scaled down to the phone frame. Height at that layout
  // can differ from the 390px pass, so measure once more.
  useEffect(() => {
    if (interactive || device !== "mobile" || fitScale === 1) return;
    if (Math.abs(lastFitRef.current - fitScale) < 0.001) return;
    lastFitRef.current = fitScale;
    if (iframeRef.current?.contentDocument?.readyState === "complete") {
      void freezeHeight();
    }
  }, [fitScale, fitContentWidth, device, interactive, freezeHeight]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!pinMode || !ready) return;

    const layer = pinLayerRef.current;
    const canvas = canvasRef.current;
    if (!layer || !canvas) return;

    // Use offset dimensions (stable layout size), not viewport-clamped rect height
    const width = layer.offsetWidth || 1;
    const heightPx = layer.offsetHeight || frozenHeightRef.current || 1;
    const rect = layer.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();

    const x = Math.min(
      100,
      Math.max(0, Number((((e.clientX - rect.left) / width) * 100).toFixed(3)))
    );
    const y = Math.min(
      100,
      Math.max(0, Number((((e.clientY - rect.top) / heightPx) * 100).toFixed(3)))
    );

    onPlacePin?.(x, y);

    if (onSubmitInline) {
      const cardH = 220;
      const preferred = e.clientY - canvasBox.top + 12;
      const maxTop = Math.max(8, canvasBox.height - Math.min(cardH, canvasBox.height));
      const top = Math.max(8, Math.min(maxTop, preferred));
      const left = Math.max(
        150,
        Math.min(canvasBox.width - 150, e.clientX - canvasBox.left)
      );
      setCompose({ kind: "pin", pinX: x, pinY: y, top, left });
      setComposeBody("");
      setComposeError("");
      requestAnimationFrame(() => composeTextRef.current?.focus());
    }
  }

  function closeCompose() {
    setCompose(null);
    setComposeBody("");
    setComposeError("");
  }

  async function submitCompose() {
    if (!compose || !onSubmitInline) return;
    const text = composeBody.trim();
    if (!text) {
      setComposeError("Write a short note.");
      return;
    }
    const name = authorName.trim() || "Reviewer";
    setComposeBusy(true);
    setComposeError("");
    const ok = await onSubmitInline({
      body: text,
      authorName: name,
      pinX: compose.pinX,
      pinY: compose.pinY,
      quote: compose.quote,
    });
    setComposeBusy(false);
    if (ok !== false) closeCompose();
  }

  const inlinePins = [
    ...pins.filter((p) => p.pin_x !== null && p.pin_y !== null),
    ...(compose?.kind === "pin" &&
    compose.pinX != null &&
    compose.pinY != null
      ? [
          {
            id: "pending",
            pin_x: compose.pinX,
            pin_y: compose.pinY,
            resolved: 0,
            body: "New pin",
          } satisfies PinComment,
        ]
      : []),
  ];

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
        ref={canvasRef}
        className={`preview-canvas ${interactive ? "interactive" : ""} ${
          ready ? "is-ready" : "is-loading"
        }${device === "mobile" ? " is-mobile" : ""}${
          compose || tip ? " has-overlay" : ""
        }`}
        style={{
          height: device === "mobile" ? Math.round(height * fitScale) : height,
          width: device === "mobile" ? MOBILE_PREVIEW_WIDTH : undefined,
          maxWidth: device === "mobile" ? "100%" : undefined,
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
            width:
              device === "mobile" && fitScale !== 1
                ? fitContentWidth
                : "100%",
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
            pointerEvents: passThrough ? "auto" : "none",
          }}
        />
        <div
          ref={pinLayerRef}
          className={`pin-layer ${pinMode && ready ? "clickable" : ""}`}
          onClick={handleClick}
          style={{
            height: device === "mobile" ? Math.round(height * fitScale) : height,
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
                  } ${pin.id === "pending" ? "is-pending" : ""}`}
                  style={{
                    left: `${pin.pin_x}%`,
                    top: `${pin.pin_y}%`,
                  }}
                  onMouseEnter={(e) => {
                    if (pin.id === "pending" || !pin.body) return;
                    if (tipHideTimer.current) clearTimeout(tipHideTimer.current);
                    const canvas = canvasRef.current;
                    if (!canvas) return;
                    const canvasBox = canvas.getBoundingClientRect();
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({
                      top: r.bottom - canvasBox.top + 8,
                      left: Math.max(
                        140,
                        Math.min(
                          canvasBox.width - 140,
                          r.left - canvasBox.left + r.width / 2
                        )
                      ),
                      comment: pin,
                    });
                  }}
                  onMouseLeave={() => {
                    tipHideTimer.current = setTimeout(() => setTip(null), 180);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pin.id === "pending") return;
                    onSelectPin?.(pin.id);
                  }}
                  aria-label={`Gorilla pin ${index + 1}`}
                >
                  <span className="pin-face" aria-hidden="true">
                    🦍
                  </span>
                  <span className="pin-num">
                    {pin.id === "pending" ? "+" : index + 1}
                  </span>
                </button>
              ))
            : null}
        </div>
        {compose ? (
          <div
            className="feedback-compose"
            style={{ top: compose.top, left: compose.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="feedback-compose-head">
              <strong>
                {compose.kind === "pin" ? "Pinned note" : "Note on this copy"}
              </strong>
              <button
                type="button"
                className="feedback-compose-x"
                onClick={closeCompose}
                aria-label="Cancel"
              >
                ×
              </button>
            </div>
            {compose.quote?.text ? (
              <blockquote className="feedback-compose-quote">
                {compose.quote.text}
              </blockquote>
            ) : null}
            <input
              className="feedback-compose-name"
              value={authorName}
              onChange={(e) => onAuthorNameChange?.(e.target.value)}
              placeholder="Your name"
            />
            <textarea
              ref={composeTextRef}
              className="feedback-compose-body"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder={
                compose.kind === "pin"
                  ? "What should change at this spot?"
                  : "What should change in this copy?"
              }
              rows={3}
            />
            {composeError ? (
              <p className="feedback-compose-error">{composeError}</p>
            ) : null}
            <div className="feedback-compose-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeCompose}
                disabled={composeBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void submitCompose()}
                disabled={composeBusy}
              >
                {composeBusy ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        ) : null}
        {tip && !compose ? (
          <div
            className="feedback-tip"
            style={{ top: tip.top, left: tip.left }}
            onMouseEnter={() => {
              if (tipHideTimer.current) clearTimeout(tipHideTimer.current);
            }}
            onMouseLeave={() => {
              tipHideTimer.current = setTimeout(() => setTip(null), 120);
            }}
          >
            <div className="feedback-tip-author">
              {tip.comment.author_name || "Reviewer"}
            </div>
            {tip.comment.quote_text ? (
              <blockquote className="feedback-tip-quote">
                {tip.comment.quote_text}
              </blockquote>
            ) : null}
            <div className="feedback-tip-body">{tip.comment.body}</div>
            {onDeleteComment && tip.comment.id !== "pending" ? (
              <button
                type="button"
                className="feedback-tip-delete"
                onClick={() => {
                  onDeleteComment(tip.comment.id);
                  setTip(null);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
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
