"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClientCombobox } from "@/components/ClientCombobox";
import { StatusBadge } from "@/components/StatusBadge";
import { operatorStatusLabel } from "@/lib/campaign-status";
import { buildPreviewSrcDoc } from "@/lib/email-preview";
import {
  EMAIL_BOARD_BUCKETS,
  EMAIL_BOARD_NOTE_COLORS,
  EMAIL_BOARD_SOURCE,
  EMAIL_DOC_W,
  EMAIL_FRAME_W,
  EMAIL_PREVIEW_H,
  isEmailBoardBucket,
  type EmailBoardFrame,
  type EmailBoardNote,
  type EmailBoardNoteColor,
  type EmailBoardPayload,
} from "@/lib/email-board-model";

type Cam = { x: number; y: number; zoom: number };

type Drag = {
  key: string;
  pointerId: number;
  px: number;
  py: number;
  x: number;
  y: number;
  moved: boolean;
  xNow: number;
  yNow: number;
};

const HINT_KEY = "cd-email-board-hint";
const HTML_CAP = 14;

function clampZoom(zoom: number): number {
  return Math.min(2, Math.max(0.08, zoom));
}

function toneOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return hash % 6;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

function HtmlPreview({ html, title, live }: { html: string; title: string; live: boolean }) {
  const srcDoc = useMemo(() => buildPreviewSrcDoc(html || "<p></p>"), [html]);
  if (!live) return null;
  const scale = EMAIL_FRAME_W / EMAIL_DOC_W;
  const height = Math.round(EMAIL_PREVIEW_H / scale);
  return (
    <iframe
      className="eb-iframe"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      tabIndex={-1}
      style={{ width: EMAIL_DOC_W, height, transform: `scale(${scale})` }}
    />
  );
}

const FrameCard = memo(function FrameCard({
  frame,
  x,
  y,
  live,
  selected,
  onPointerDown,
  onOpen,
}: {
  frame: EmailBoardFrame;
  x: number;
  y: number;
  live: boolean;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, frame: EmailBoardFrame) => void;
  onOpen: (frame: EmailBoardFrame) => void;
}) {
  const label = [
    frame.title,
    frame.subject || "No subject line",
    frame.sendLabel,
    operatorStatusLabel(frame.status, frame.approvedChannel),
  ].join(", ");
  return (
    <div
      className={`eb-frame${selected ? " is-selected" : ""}${frame.render === "condition" ? " is-gate" : ""}`}
      data-tone={toneOf(frame.groupId)}
      data-render={frame.render}
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ left: x, top: y, width: frame.w, height: frame.h }}
      onPointerDown={(event) => onPointerDown(event, frame)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onOpen(frame);
        }
      }}
    >
      {frame.render === "condition" ? (
        <div className="eb-gate">
          <span>If / else</span>
          <strong>{frame.title}</strong>
          <em>Yes continues · No drops down</em>
        </div>
      ) : (
        <>
          <div className="eb-frame-head">
            <div className="eb-frame-copy">
              <div className="eb-frame-name">{frame.title}</div>
              <div className={`eb-frame-subject${frame.subject ? "" : " is-empty"}`}>
                {frame.subject || "No subject line"}
              </div>
            </div>
            <StatusBadge status={frame.status} approvedChannel={frame.approvedChannel} />
          </div>
          <div className="eb-frame-meta">
            <span>{frame.sendLabel}</span>
            {frame.laneLabel ? <span>{frame.laneLabel}</span> : null}
            {frame.kind !== "email" && frame.kind !== "cold_email" ? (
              <span>{frame.kindLabel}</span>
            ) : null}
            {frame.hasVariantB ? <span>A/B</span> : null}
            <span className="eb-frame-camp">{frame.groupTitle}</span>
          </div>
          <div className="eb-paper">
            {frame.render === "html" && live ? (
              <div className="eb-preview-clip">
                <HtmlPreview html={frame.previewHtml} title={frame.title} live />
              </div>
            ) : null}
            {frame.render === "html" && !live ? (
              <div className="eb-paper-fallback">
                <div className="eb-paper-kicker">{frame.groupTitle}</div>
                <div className="eb-paper-title">{frame.subject || frame.title}</div>
                <p>{frame.plain || "Email design"}</p>
              </div>
            ) : null}
            {frame.render === "image" && frame.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="eb-shot" src={frame.mediaUrl} alt="" />
            ) : null}
            {frame.render === "link" ? (
              <div className="eb-link">
                <span>Link</span>
                <strong>{frame.plain || "Open design"}</strong>
                <em>{frame.linkUrl ? hostOf(frame.linkUrl) : "No link stored"}</em>
              </div>
            ) : null}
            {frame.render === "text" ? (
              <div className="eb-sms">
                <div className="eb-sms-bubble">{frame.text}</div>
              </div>
            ) : null}
            {frame.render === "empty" ? (
              <div className="eb-empty">
                <strong>{frame.emptyReason === "logged_off" ? "Logged outside the app" : "No design yet"}</strong>
                <p>{frame.plain}</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
});

function Lightbox({
  frame,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  frame: EmailBoardFrame;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const [variant, setVariant] = useState<"a" | "b">("a");
  const html = variant === "b" && frame.previewHtmlB ? frame.previewHtmlB : frame.previewHtml;
  const srcDoc = useMemo(() => (html ? buildPreviewSrcDoc(html) : ""), [html]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrev) onPrev();
      if (event.key === "ArrowRight" && hasNext) onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div className="eb-lightbox" role="presentation" onMouseDown={onClose}>
      <div
        className="eb-lightbox-card"
        role="dialog"
        aria-modal="true"
        aria-label={frame.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="eb-lightbox-head">
          <div>
            <div className="eb-lightbox-kicker">
              {frame.groupTitle}
              {frame.presentation === "automation" ? " · Flow" : " · Campaign"}
            </div>
            <h2>{frame.title}</h2>
            <p className={frame.subject ? "" : "is-empty"}>
              {frame.subject || "No subject line"}
            </p>
          </div>
          <div className="eb-lightbox-actions">
            <StatusBadge status={frame.status} approvedChannel={frame.approvedChannel} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </header>
        <div className="eb-lightbox-meta">
          <span>{frame.sendLabel}</span>
          {frame.laneLabel ? <span>{frame.laneLabel} path</span> : null}
          {frame.previewText ? <span>{frame.previewText}</span> : null}
          {frame.kind !== "email" ? <span>{frame.kindLabel}</span> : null}
        </div>
        <div className="eb-lightbox-scroll">
          {frame.render === "html" && srcDoc ? (
            <iframe
              title={frame.title}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={srcDoc}
              style={{ width: 640, height: 3600 }}
            />
          ) : null}
          {frame.render === "image" && frame.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="eb-lightbox-shot" src={frame.mediaUrl} alt={frame.title} />
          ) : null}
          {frame.render === "link" && frame.linkUrl ? (
            <div className="eb-lightbox-link">
              <strong>{frame.plain || "Design link"}</strong>
              <p>This email is stored as a link, not as HTML, so the board does not embed it.</p>
              <a href={frame.linkUrl} target="_blank" rel="noreferrer noopener">
                {hostOf(frame.linkUrl)}
              </a>
            </div>
          ) : null}
          {frame.render === "text" ? (
            <div className="eb-sms eb-sms-large">
              <div className="eb-sms-bubble">{frame.text}</div>
            </div>
          ) : null}
          {frame.render === "empty" ? (
            <div className="eb-empty eb-empty-large">
              <strong>{frame.emptyReason === "logged_off" ? "Logged outside the app" : "No design yet"}</strong>
              <p>{frame.plain}</p>
            </div>
          ) : null}
        </div>
        <footer className="eb-lightbox-foot">
          <div className="eb-lightbox-nav">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onPrev} disabled={!hasPrev}>
              Previous
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onNext} disabled={!hasNext}>
              Next
            </button>
            {frame.hasVariantB ? (
              <div className="eb-chips" role="group" aria-label="Variant">
                <button type="button" className={`eb-chip${variant === "a" ? " is-on" : ""}`} onClick={() => setVariant("a")}>
                  A
                </button>
                <button type="button" className={`eb-chip${variant === "b" ? " is-on" : ""}`} onClick={() => setVariant("b")}>
                  B
                </button>
              </div>
            ) : null}
          </div>
          <div className="eb-lightbox-nav">
            <Link className="btn btn-secondary btn-sm" href={frame.campaignHref}>
              Open campaign
            </Link>
            {frame.reviewHref ? (
              <Link className="btn btn-sm" href={frame.reviewHref}>
                Open review
              </Link>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

export function EmailBoard() {
  const router = useRouter();
  const search = useSearchParams();
  const clientParam = search.get("client") || "";
  const flowParam = search.get("flow") || "all";
  const statusParam = search.get("status") || "all";

  const [payload, setPayload] = useState<EmailBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cam, setCam] = useState<Cam>({ x: 64, y: 48, zoom: 0.5 });
  const [override, setOverride] = useState<Record<string, { x: number; y: number }>>({});
  const [notes, setNotes] = useState<EmailBoardNote[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [hint, setHint] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [undo, setUndo] = useState<{ frameKey: string; x: number; y: number }[] | null>(null);

  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const miniViewRef = useRef<HTMLDivElement>(null);
  const camRef = useRef(cam);
  const spaceRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const noteDragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ id: number; px: number; py: number; x: number; y: number } | null>(null);
  const loadedFor = useRef("");
  const commitTimer = useRef<number | null>(null);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const groups = useMemo(() => payload?.groups ?? [], [payload]);
  const frames = useMemo(() => payload?.frames ?? [], [payload]);
  const flow = groups.some((group) => group.id === flowParam) ? flowParam : "all";
  const status =
    statusParam === "all" || isEmailBoardBucket(statusParam) ? statusParam : "all";

  const visible = useMemo(
    () =>
      frames.filter((frame) => {
        if (flow !== "all" && frame.groupId !== flow) return false;
        if (status !== "all" && frame.bucket !== status) return false;
        return true;
      }),
    [frames, flow, status]
  );

  const pos = useCallback(
    (frame: EmailBoardFrame) => override[frame.key] || { x: frame.x, y: frame.y },
    [override]
  );

  function applyCam(next: Cam, commit: boolean) {
    camRef.current = next;
    const world = worldRef.current;
    if (world) {
      world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
    }
    const view = viewRef.current;
    if (view) {
      view.style.backgroundSize = `${24 * next.zoom}px ${24 * next.zoom}px`;
      view.style.backgroundPosition = `${next.x}px ${next.y}px`;
    }
    const mini = miniViewRef.current;
    const geom = miniGeom.current;
    if (mini && geom && geom.scale > 0) {
      const vx = -next.x / next.zoom;
      const vy = -next.y / next.zoom;
      const vw = (view?.clientWidth || 1) / next.zoom;
      const vh = (view?.clientHeight || 1) / next.zoom;
      mini.style.left = `${geom.ox + (vx - geom.minX) * geom.scale}px`;
      mini.style.top = `${geom.oy + (vy - geom.minY) * geom.scale}px`;
      mini.style.width = `${Math.max(8, vw * geom.scale)}px`;
      mini.style.height = `${Math.max(8, vh * geom.scale)}px`;
    }
    if (commit) setCam(next);
  }

  function scheduleCommit() {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      setCam({ ...camRef.current });
    }, 90);
  }

  const miniGeom = useRef({ minX: 0, minY: 0, scale: 1, ox: 0, oy: 0 });

  const liveKeys = useMemo(() => {
    const view = viewRef.current;
    const width = view?.clientWidth || 1200;
    const height = view?.clientHeight || 800;
    const html = visible.filter((frame) => {
      if (frame.render !== "html") return false;
      const at = pos(frame);
      const sx = at.x * cam.zoom + cam.x;
      const sy = at.y * cam.zoom + cam.y;
      const sw = frame.w * cam.zoom;
      const sh = frame.h * cam.zoom;
      return sx + sw > -80 && sy + sh > -80 && sx < width + 80 && sy < height + 80;
    });
    const show = html.length <= HTML_CAP || cam.zoom >= 0.42;
    if (!show) return new Set<string>();
    const cx = (-cam.x + width / 2) / cam.zoom;
    const cy = (-cam.y + height / 2) / cam.zoom;
    const ranked = [...html].sort((a, b) => {
      const ap = pos(a);
      const bp = pos(b);
      const ad = (ap.x - cx) ** 2 + (ap.y - cy) ** 2;
      const bd = (bp.x - cx) ** 2 + (bp.y - cy) ** 2;
      return ad - bd;
    });
    return new Set(ranked.slice(0, HTML_CAP).map((frame) => frame.key));
  }, [visible, cam, pos]);

  function replaceQuery(next: { client?: string; flow?: string; status?: string }) {
    const params = new URLSearchParams(search.toString());
    if (next.client !== undefined) {
      if (next.client) params.set("client", next.client);
      else params.delete("client");
    }
    if (next.flow !== undefined) {
      if (next.flow && next.flow !== "all") params.set("flow", next.flow);
      else params.delete("flow");
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== "all") params.set("status", next.status);
      else params.delete("status");
    }
    const qs = params.toString();
    router.replace(qs ? `/admin/email-board?${qs}` : "/admin/email-board", { scroll: false });
  }

  const load = useCallback(async (clientId: string, force = false) => {
    const key = clientId || "__auto__";
    if (!force && loadedFor.current === key) return;
    setLoading(true);
    setError("");
    setPayload(null);
    setNotes([]);
    setOverride({});
    const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
    try {
      const res = await fetch(`/api/email-board${qs}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as EmailBoardPayload;
      loadedFor.current = data.client?.id || key;
      setPayload(data);
      setNotes(data.notes);
      setOverride({});
      setOpenKey(null);
      setLoading(false);
      if (!clientId && data.client) {
        const params = new URLSearchParams(window.location.search);
        params.set("client", data.client.id);
        router.replace(`/admin/email-board?${params.toString()}`, { scroll: false });
      }
    } catch {
      setLoading(false);
      setError("The board didn't load. Try again.");
    }
  }, [router]);

  useEffect(() => {
    void load(clientParam);
  }, [clientParam, load]);

  useEffect(() => {
    setHint(window.localStorage.getItem(HINT_KEY) !== "1");
  }, []);

  function fit(list: EmailBoardFrame[]) {
    const view = viewRef.current;
    if (!view) return;
    if (!list.length) {
      applyCam({ x: 72, y: 56, zoom: 0.6 }, true);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const frame of list) {
      const at = override[frame.key] || { x: frame.x, y: frame.y };
      minX = Math.min(minX, at.x);
      minY = Math.min(minY, at.y - 56);
      maxX = Math.max(maxX, at.x + frame.w);
      maxY = Math.max(maxY, at.y + frame.h);
    }
    const pad = 72;
    const zoom = clampZoom(
      Math.min(
        view.clientWidth / (maxX - minX + pad * 2),
        view.clientHeight / (maxY - minY + pad * 2),
        1
      )
    );
    applyCam(
      {
        zoom,
        x: (view.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
        y: (view.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
      },
      true
    );
  }

  const fitKey = `${payload?.client?.id || ""}|${flow}|${status}|${frames.length}`;
  const fitted = useRef("");
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    function present() {
      if (!view || view.clientWidth < 20 || loading || !payload) return;
      if (fitted.current === fitKey) return;
      fitted.current = fitKey;
      const list = visibleRef.current;
      if (!list.length) {
        fit(list);
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const frame of list) {
        const at = override[frame.key] || { x: frame.x, y: frame.y };
        minX = Math.min(minX, at.x);
        minY = Math.min(minY, at.y - 56);
        maxX = Math.max(maxX, at.x + frame.w);
        maxY = Math.max(maxY, at.y + frame.h);
      }
      const pad = 72;
      const fitZoom = Math.min(
        view.clientWidth / (maxX - minX + pad * 2),
        view.clientHeight / (maxY - minY + pad * 2),
        1
      );
      // A whole account can be taller than the screen. Fitting it would shrink
      // the emails until the designs disappear. Land on the top of the board
      // at a size you can read, and leave Fit for the overview.
      if (fitZoom >= 0.45) {
        fit(list);
        return;
      }
      const zoom = 0.72;
      const top = list.reduce(
        (best, frame) => {
          const at = override[frame.key] || { x: frame.x, y: frame.y };
          return at.y < best.y ? at : best;
        },
        { x: Infinity, y: Infinity }
      );
      applyCam(
        {
          zoom,
          x: 56 - top.x * zoom,
          y: 28 - (top.y - 64) * zoom,
        },
        true
      );
    }
    present();
    const observer = new ResizeObserver(() => present());
    observer.observe(view);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, loading, payload]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const current = camRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = view!.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const zoom = clampZoom(current.zoom * Math.exp(-event.deltaY * 0.0022));
        const wx = (cx - current.x) / current.zoom;
        const wy = (cy - current.y) / current.zoom;
        applyCam({ zoom, x: cx - wx * zoom, y: cy - wy * zoom }, false);
        scheduleCommit();
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view!.clientHeight : 1;
      applyCam(
        {
          zoom: current.zoom,
          x: current.x - event.deltaX * unit,
          y: current.y - event.deltaY * unit,
        },
        false
      );
      scheduleCommit();
    }
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [payload?.client?.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (event.key === "Escape") {
        setOpenKey(null);
        setSourceOpen(false);
        setConfirmReset(false);
        return;
      }
      if (typing) return;
      if (event.key === " ") {
        spaceRef.current = true;
        setSpace(true);
        event.preventDefault();
      }
      const view = viewRef.current;
      if (!view) return;
      const rect = view.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(camRef.current.zoom * 1.15, cx, cy);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAt(camRef.current.zoom / 1.15, cx, cy);
      } else if (event.key === "1" && !event.metaKey && !event.ctrlKey) {
        zoomAt(1, cx, cy);
      } else if ((event.key === "0" || event.key === "f") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        fit(visible);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === " ") {
        spaceRef.current = false;
        setSpace(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, override]);

  function zoomAt(nextZoom: number, clientX: number, clientY: number) {
    const view = viewRef.current;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const current = camRef.current;
    const zoom = clampZoom(nextZoom);
    const wx = (cx - current.x) / current.zoom;
    const wy = (cy - current.y) / current.zoom;
    applyCam({ zoom, x: cx - wx * zoom, y: cy - wy * zoom }, true);
  }

  async function savePositions(positions: { frameKey: string; x: number; y: number }[]) {
    const clientId = payload?.client?.id;
    if (!clientId || !positions.length) return;
    setSaveError("");
    const res = await fetch("/api/email-board/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, positions }),
    });
    if (!res.ok) {
      setSaveError("Couldn't save the arrangement.");
      setSaved(false);
      return;
    }
    setSaveError("");
  }

  function onFramePointerDown(event: React.PointerEvent<HTMLDivElement>, frame: EmailBoardFrame) {
    if (event.button !== 0 || spaceRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const node = event.currentTarget;
    const at = pos(frame);
    const drag: Drag = {
      key: frame.key,
      pointerId: event.pointerId,
      px: event.clientX,
      py: event.clientY,
      x: at.x,
      y: at.y,
      moved: false,
      xNow: at.x,
      yNow: at.y,
    };
    dragRef.current = drag;
    // Native listeners, not React's. setPointerCapture swallows the later
    // events before they reach React's root, so a drop never saved.
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      const zoom = camRef.current.zoom || 1;
      drag.xNow = Math.round((drag.x + dx / zoom) / 8) * 8;
      drag.yNow = Math.round((drag.y + dy / zoom) / 8) * 8;
      node.style.left = `${drag.xNow}px`;
      node.style.top = `${drag.yNow}px`;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRef.current !== drag) return;
      dragRef.current = null;
      if (!drag.moved) {
        if (frame.render !== "condition") setOpenKey(frame.key);
        return;
      }
      setOverride((prev) => ({ ...prev, [drag.key]: { x: drag.xNow, y: drag.yNow } }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
      void savePositions([{ frameKey: drag.key, x: drag.xNow, y: drag.yNow }]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const onItem = target.closest(".eb-frame, .eb-note");
    if (onItem && event.button === 0 && !spaceRef.current) return;
    if (event.button !== 0 && event.button !== 1) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) {
      const [a, b] = [...points.current.values()];
      pinchRef.current = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: camRef.current.zoom,
      };
      panRef.current = null;
      return;
    }
    panRef.current = {
      id: event.pointerId,
      px: event.clientX,
      py: event.clientY,
      x: camRef.current.x,
      y: camRef.current.y,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onViewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!points.current.has(event.pointerId) && !panRef.current) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...points.current.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const rect = event.currentTarget.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      const current = camRef.current;
      const zoom = clampZoom(pinchRef.current.zoom * (dist / pinchRef.current.dist));
      const wx = (cx - current.x) / current.zoom;
      const wy = (cy - current.y) / current.zoom;
      applyCam({ zoom, x: cx - wx * zoom, y: cy - wy * zoom }, false);
      scheduleCommit();
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.id !== event.pointerId) return;
    applyCam(
      {
        zoom: camRef.current.zoom,
        x: pan.x + (event.clientX - pan.px),
        y: pan.y + (event.clientY - pan.py),
      },
      false
    );
  }

  function onViewportPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    points.current.delete(event.pointerId);
    if (points.current.size < 2) pinchRef.current = null;
    if (panRef.current?.id === event.pointerId) {
      panRef.current = null;
      setPanning(false);
      setCam({ ...camRef.current });
    }
  }

  function onCanvasDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".eb-frame, .eb-note")) return;
    const view = viewRef.current;
    if (!view || !payload?.client) return;
    const rect = view.getBoundingClientRect();
    const current = camRef.current;
    const x = (event.clientX - rect.left - current.x) / current.zoom;
    const y = (event.clientY - rect.top - current.y) / current.zoom;
    void createNote(x, y);
  }

  async function createNote(x: number, y: number, color?: EmailBoardNoteColor) {
    const clientId = payload?.client?.id;
    if (!clientId) return;
    const res = await fetch("/api/email-board/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, x, y, body: "", color: color || "yellow" }),
    });
    if (!res.ok) {
      setSaveError("Couldn't add the note.");
      return;
    }
    const data = (await res.json()) as { note: EmailBoardNote };
    setNotes((prev) => [...prev, data.note]);
  }

  function onNotePointerDown(event: React.PointerEvent<HTMLDivElement>, note: EmailBoardNote) {
    if (event.button !== 0 || spaceRef.current) return;
    event.stopPropagation();
    noteDragRef.current = {
      key: note.id,
      pointerId: event.pointerId,
      px: event.clientX,
      py: event.clientY,
      x: note.x,
      y: note.y,
      moved: false,
      xNow: note.x,
      yNow: note.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onNotePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = noteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const zoom = camRef.current.zoom || 1;
    drag.xNow = Math.round((drag.x + dx / zoom) / 8) * 8;
    drag.yNow = Math.round((drag.y + dy / zoom) / 8) * 8;
    const card = event.currentTarget.parentElement as HTMLElement | null;
    if (card) {
      card.style.left = `${drag.xNow}px`;
      card.style.top = `${drag.yNow}px`;
    }
  }

  function onNotePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = noteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    noteDragRef.current = null;
    if (!drag.moved) return;
    setNotes((prev) =>
      prev.map((note) => (note.id === drag.key ? { ...note, x: drag.xNow, y: drag.yNow } : note))
    );
    void fetch(`/api/email-board/notes/${drag.key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: drag.xNow, y: drag.yNow }),
    });
  }

  async function saveNoteBody(note: EmailBoardNote, body: string) {
    setNotes((prev) => prev.map((item) => (item.id === note.id ? { ...item, body } : item)));
    await fetch(`/api/email-board/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }

  async function cycleNoteColor(note: EmailBoardNote) {
    const index = EMAIL_BOARD_NOTE_COLORS.indexOf(note.color);
    const color = EMAIL_BOARD_NOTE_COLORS[(index + 1) % EMAIL_BOARD_NOTE_COLORS.length];
    setNotes((prev) => prev.map((item) => (item.id === note.id ? { ...item, color } : item)));
    await fetch(`/api/email-board/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
  }

  async function removeNote(note: EmailBoardNote) {
    setNotes((prev) => prev.filter((item) => item.id !== note.id));
    await fetch(`/api/email-board/notes/${note.id}`, { method: "DELETE" });
  }

  async function resetLayout() {
    const clientId = payload?.client?.id;
    if (!clientId) return;
    const previous = frames.map((frame) => {
      const at = pos(frame);
      return { frameKey: frame.key, x: at.x, y: at.y };
    });
    const res = await fetch(
      `/api/email-board/layout?clientId=${encodeURIComponent(clientId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setSaveError("Couldn't reset the arrangement.");
      return;
    }
    setUndo(previous);
    setConfirmReset(false);
    setToast("Back to send order");
    loadedFor.current = "";
    await load(clientId, true);
  }

  async function undoReset() {
    if (!undo) return;
    setOverride(Object.fromEntries(undo.map((row) => [row.frameKey, { x: row.x, y: row.y }])));
    await savePositions(undo);
    setUndo(null);
    setToast("Arrangement restored");
  }

  const sections = useMemo(() => {
    const byId = new Map<string, EmailBoardFrame[]>();
    for (const frame of visible) {
      const list = byId.get(frame.groupId) || [];
      list.push(frame);
      byId.set(frame.groupId, list);
    }
    return [...byId.entries()].map(([id, list]) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let custom = false;
      for (const frame of list) {
        const at = pos(frame);
        if (frame.placed || override[frame.key]) custom = true;
        minX = Math.min(minX, at.x);
        minY = Math.min(minY, at.y);
        maxX = Math.max(maxX, at.x + frame.w);
        maxY = Math.max(maxY, at.y + frame.h);
      }
      const group = groups.find((item) => item.id === id);
      return {
        id,
        list,
        custom,
        group,
        minX: minX - 28,
        minY: minY - 48,
        width: maxX - minX + 56,
        height: maxY - minY + 72,
      };
    });
  }, [visible, pos, override, groups]);

  const lines = useMemo(() => {
    const paths: { d: string; key: string }[] = [];
    for (const section of sections) {
      if (section.custom) continue;
      const rows = new Map<number, EmailBoardFrame[]>();
      for (const frame of section.list) {
        const row = rows.get(frame.row) || [];
        row.push(frame);
        rows.set(frame.row, row);
      }
      for (const row of rows.values()) {
        row.sort((a, b) => a.col - b.col);
        for (let i = 0; i < row.length - 1; i++) {
          const a = row[i];
          const b = row[i + 1];
          const at = pos(a);
          const bt = pos(b);
          const y = at.y + Math.min(a.h, b.h) / 2;
          paths.push({
            key: `${a.key}-${b.key}`,
            d: `M ${at.x + a.w} ${y} L ${bt.x} ${bt.y + Math.min(48, b.h / 2)}`,
          });
        }
      }
      for (const gate of section.list) {
        if (gate.render !== "condition") continue;
        const below = section.list
          .filter((frame) => frame.row > gate.row && frame.col >= gate.col)
          .sort((a, b) => a.row - b.row || a.col - b.col)[0];
        if (!below) continue;
        const at = pos(gate);
        const bt = pos(below);
        const x1 = at.x + gate.w / 2;
        const y1 = at.y + gate.h;
        const y2 = bt.y + 24;
        paths.push({
          key: `${gate.key}-down`,
          d: `M ${x1} ${y1} L ${x1} ${y2} L ${bt.x} ${y2}`,
        });
      }
    }
    return paths;
  }, [sections, pos]);

  const reviewFrames = visible.filter((frame) => frame.render !== "condition");
  const openFrame = reviewFrames.find((frame) => frame.key === openKey) || null;
  const openIndex = openFrame ? reviewFrames.findIndex((frame) => frame.key === openFrame.key) : -1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of visible) {
    const at = pos(frame);
    minX = Math.min(minX, at.x);
    minY = Math.min(minY, at.y);
    maxX = Math.max(maxX, at.x + frame.w);
    maxY = Math.max(maxY, at.y + frame.h);
  }
  const miniW = 188;
  const miniH = 124;
  const boundsW = Number.isFinite(minX) ? Math.max(1, maxX - minX) : 1;
  const boundsH = Number.isFinite(minY) ? Math.max(1, maxY - minY) : 1;
  const miniScale = Math.min((miniW - 16) / boundsW, (miniH - 16) / boundsH);
  const miniOx = (miniW - boundsW * miniScale) / 2;
  const miniOy = (miniH - boundsH * miniScale) / 2;
  miniGeom.current = {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    scale: miniScale,
    ox: miniOx,
    oy: miniOy,
  };

  const emailCount = frames.filter((frame) => frame.render !== "condition").length;
  const shownCount = visible.filter((frame) => frame.render !== "condition").length;
  const client = payload?.client || null;

  function panMini(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const geom = miniGeom.current;
    const wx = geom.minX + (event.clientX - rect.left - geom.ox) / geom.scale;
    const wy = geom.minY + (event.clientY - rect.top - geom.oy) / geom.scale;
    const view = viewRef.current;
    if (!view) return;
    const current = camRef.current;
    applyCam(
      {
        zoom: current.zoom,
        x: view.clientWidth / 2 - wx * current.zoom,
        y: view.clientHeight / 2 - wy * current.zoom,
      },
      true
    );
  }

  const bucketCounts = EMAIL_BOARD_BUCKETS.map((bucket) => ({
    ...bucket,
    count:
      bucket.id === "all"
        ? emailCount
        : frames.filter((frame) => frame.render !== "condition" && frame.bucket === bucket.id)
            .length,
  }));

  return (
    <div className="eb-fill">
      <header className="eb-bar">
        <div className="eb-bar-left">
          <div className="eb-title">
            <h1>Email Board</h1>
            <p>{shownCount === emailCount ? `${emailCount} emails` : `${shownCount} of ${emailCount}`}</p>
          </div>
          <div className="eb-picker">
            <ClientCombobox
              clients={payload?.clients || []}
              value={client?.id || ""}
              onChange={(id) => replaceQuery({ client: id, flow: "all" })}
              placeholder="Choose a client"
              ariaLabel="Client"
            />
          </div>
          <label className="eb-select-wrap">
            <span className="eb-sr">Campaign or flow</span>
            <select
              className="eb-select"
              value={flow}
              aria-label="Campaign or flow"
              onChange={(event) => replaceQuery({ flow: event.target.value })}
            >
              <option value="all">All campaigns and flows</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                  {group.presentation === "automation" ? " · Flow" : " · Campaign"}
                </option>
              ))}
            </select>
          </label>
          <div className="eb-chips" role="group" aria-label="Status">
            {bucketCounts.map((bucket) => (
              <button
                key={bucket.id}
                type="button"
                className={`eb-chip${status === bucket.id ? " is-on" : ""}`}
                aria-pressed={status === bucket.id}
                onClick={() => replaceQuery({ status: bucket.id })}
              >
                {bucket.label}
                <span>{bucket.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="eb-bar-right">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const view = viewRef.current;
              if (!view || !client) return;
              const current = camRef.current;
              void createNote(
                (view.clientWidth / 2 - current.x) / current.zoom - 110,
                (view.clientHeight / 2 - current.y) / current.zoom - 90
              );
            }}
            disabled={!client}
          >
            Add note
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmReset((value) => !value)}
            disabled={!client || !frames.length}
          >
            Reset layout
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-sm${sourceOpen ? " is-on" : ""}`}
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen((value) => !value)}
          >
            Where this comes from
          </button>
        </div>
        {confirmReset ? (
          <div className="eb-confirm" role="group" aria-label="Reset layout">
            <p>Put every frame back in send order for {client?.name || "this client"}?</p>
            <button type="button" className="btn btn-sm" onClick={() => void resetLayout()}>
              Reset
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : null}
        {sourceOpen ? (
          <div className="eb-source" role="note">
            <strong>{EMAIL_BOARD_SOURCE.title}</strong>
            {EMAIL_BOARD_SOURCE.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
        ) : null}
      </header>

      <div className="eb-stage">
        {hint && client ? (
          <div className="eb-hint">
            <p>
              Drag empty space to pan. Drag a frame to rearrange it. Pinch, or hold ⌘ and scroll, to zoom. Click a frame to open it.
            </p>
            <button
              type="button"
              onClick={() => {
                setHint(false);
                window.localStorage.setItem(HINT_KEY, "1");
              }}
            >
              Got it
            </button>
          </div>
        ) : null}
        {toast ? (
          <div className="eb-toast" role="status">
            {toast}
            {undo ? (
              <button type="button" onClick={() => void undoReset()}>
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
        {saveError ? <div className="eb-toast is-error">{saveError}</div> : null}

        <div
          ref={viewRef}
          className={`eb-viewport${panning ? " is-panning" : ""}${space ? " is-space" : ""}`}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerCancel={onViewportPointerUp}
          onDoubleClick={onCanvasDoubleClick}
          style={{
            backgroundSize: `${24 * cam.zoom}px ${24 * cam.zoom}px`,
            backgroundPosition: `${cam.x}px ${cam.y}px`,
          }}
        >
          <div
            ref={worldRef}
            className="eb-world"
            style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}
          >
            <svg
              className="eb-lines"
              aria-hidden="true"
              width={Math.max(1, (Number.isFinite(maxX) ? maxX : 0) + 600)}
              height={Math.max(1, (Number.isFinite(maxY) ? maxY : 0) + 600)}
            >
              <defs>
                <marker id="eb-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 Z" />
                </marker>
              </defs>
              {lines.map((line) => (
                <path key={line.key} d={line.d} markerEnd="url(#eb-arrow)" />
              ))}
            </svg>
            {sections.map((section) => (
              <div
                key={section.id}
                className="eb-section"
                data-tone={toneOf(section.id)}
                style={{
                  left: section.minX,
                  top: section.minY,
                  width: section.width,
                  height: section.height,
                }}
              >
                <div className="eb-section-label">
                  {section.group?.title || "Campaign"}
                  <span>
                    {section.group?.presentation === "automation" ? "Flow" : "Campaign"}
                    {section.group?.triggerLabel ? ` · ${section.group.triggerLabel}` : ""}
                    {section.custom ? " · Custom layout" : ""}
                  </span>
                </div>
              </div>
            ))}
            {visible.map((frame) => {
              const at = pos(frame);
              return (
                <FrameCard
                  key={frame.key}
                  frame={frame}
                  x={at.x}
                  y={at.y}
                  live={liveKeys.has(frame.key)}
                  selected={openKey === frame.key}
                  onPointerDown={onFramePointerDown}
                  onOpen={(item) => {
                    if (item.render !== "condition") setOpenKey(item.key);
                  }}
                />
              );
            })}
            {notes.map((note) => (
              <article
                key={note.id}
                className="eb-note"
                data-color={note.color}
                style={{ left: note.x, top: note.y }}
              >
                <div
                  className="eb-note-bar"
                  onPointerDown={(event) => onNotePointerDown(event, note)}
                  onPointerMove={onNotePointerMove}
                  onPointerUp={onNotePointerUp}
                >
                  <span>{note.author || "Note"}</span>
                  <button type="button" onClick={() => void cycleNoteColor(note)} aria-label="Change note color">
                    Color
                  </button>
                  <button type="button" onClick={() => void removeNote(note)} aria-label="Delete note">
                    Delete
                  </button>
                </div>
                <textarea
                  defaultValue={note.body}
                  placeholder="Note for the team"
                  aria-label="Sticky note"
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    if (event.target.value !== note.body) void saveNoteBody(note, event.target.value);
                  }}
                />
              </article>
            ))}
          </div>
        </div>

        {!loading && client && !frames.length ? (
          <div className="eb-empty-state">
            <h2>Nothing stored for {client.name} yet</h2>
            <p>{EMAIL_BOARD_SOURCE.paragraphs[0]}</p>
            <p>{EMAIL_BOARD_SOURCE.paragraphs[2]}</p>
          </div>
        ) : null}
        {!loading && client && frames.length > 0 && !visible.length ? (
          <div className="eb-empty-state">
            <h2>Nothing in this filter</h2>
            <button type="button" className="btn btn-sm" onClick={() => replaceQuery({ flow: "all", status: "all" })}>
              Show everything
            </button>
          </div>
        ) : null}
        {!loading && payload?.missing ? (
          <div className="eb-empty-state">
            <h2>That client is not on the roster</h2>
            <p>Pick a client from the list.</p>
          </div>
        ) : null}
        {loading ? <div className="eb-empty-state"><p>Loading designs…</p></div> : null}
        {error ? (
          <div className="eb-empty-state">
            <h2>{error}</h2>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                loadedFor.current = "";
                void load(clientParam, true);
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="eb-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              const rect = view.getBoundingClientRect();
              zoomAt(cam.zoom / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
            }}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="eb-zoom-pct"
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              const rect = view.getBoundingClientRect();
              zoomAt(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
            }}
            aria-label="Zoom to 100 percent"
          >
            {Math.round(cam.zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              const rect = view.getBoundingClientRect();
              zoomAt(cam.zoom * 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
            }}
            aria-label="Zoom in"
          >
            +
          </button>
          <button type="button" onClick={() => fit(visible)} aria-label="Zoom to fit">
            Fit
          </button>
          {saved ? <span className="eb-saved">Saved</span> : null}
        </div>

        {visible.length ? (
          <div
            className="eb-mini"
            role="application"
            aria-label="Minimap"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              panMini(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons) panMini(event);
            }}
          >
            {visible.map((frame) => {
              const at = pos(frame);
              return (
                <span
                  key={frame.key}
                  className="eb-mini-frame"
                  data-tone={toneOf(frame.groupId)}
                  style={{
                    left: miniOx + (at.x - (Number.isFinite(minX) ? minX : 0)) * miniScale,
                    top: miniOy + (at.y - (Number.isFinite(minY) ? minY : 0)) * miniScale,
                    width: Math.max(3, frame.w * miniScale),
                    height: Math.max(2, frame.h * miniScale),
                  }}
                />
              );
            })}
            <span
              ref={miniViewRef}
              className="eb-mini-view"
              style={{
                left:
                  miniOx +
                  ((-cam.x / cam.zoom - (Number.isFinite(minX) ? minX : 0)) * miniScale),
                top:
                  miniOy +
                  ((-cam.y / cam.zoom - (Number.isFinite(minY) ? minY : 0)) * miniScale),
                width: Math.max(8, ((viewRef.current?.clientWidth || 800) / cam.zoom) * miniScale),
                height: Math.max(8, ((viewRef.current?.clientHeight || 600) / cam.zoom) * miniScale),
              }}
            />
          </div>
        ) : null}
      </div>

      {openFrame ? (
        <Lightbox
          frame={openFrame}
          onClose={() => setOpenKey(null)}
          hasPrev={openIndex > 0}
          hasNext={openIndex >= 0 && openIndex < reviewFrames.length - 1}
          onPrev={() => {
            const prev = reviewFrames[openIndex - 1];
            if (prev) setOpenKey(prev.key);
          }}
          onNext={() => {
            const next = reviewFrames[openIndex + 1];
            if (next) setOpenKey(next.key);
          }}
        />
      ) : null}
    </div>
  );
}
