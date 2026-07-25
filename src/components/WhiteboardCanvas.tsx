"use client";

import { Component, useCallback, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Editor, TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";

// tldraw touches the DOM/window at import time, so it must never render on the
// server. Load the editor client-side only.
const Tldraw = dynamic(() => import("tldraw").then((m) => m.Tldraw), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, color: "var(--muted, #888)" }}>
      Loading board…
    </div>
  ),
});

// How often each viewer checks for a newer revision, and how long local edits
// are batched before being saved.
const POLL_MS = 2000;
const SAVE_MS = 700;

type DocSnapshot = TLEditorSnapshot["document"];

// Report a client-side crash to the server so it lands in the logs even when we
// can't get a console from the person hitting it.
function reportError(boardId: string, where: string, err: unknown) {
  try {
    const msg =
      err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
    void fetch(`/api/whiteboard/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId, where, message: msg.slice(0, 4000) }),
      keepalive: true,
    });
  } catch {
    /* never let logging throw */
  }
}

// A render error inside tldraw would otherwise blank the whole route. Contain it
// and offer a reload instead of a white screen — and report it.
class BoardErrorBoundary extends Component<
  { boardId: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    reportError(this.props.boardId, "render", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24 }}>
          <p style={{ marginBottom: 12 }}>
            The board hit a snag rendering. Reloading usually clears it.
          </p>
          <button
            className="btn btn-sm"
            onClick={() => window.location.reload()}
          >
            Reload board
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function WhiteboardCanvas({ boardId }: { boardId: string }) {
  const editorRef = useRef<Editor | null>(null);
  // The revision we are known to be consistent with. Our own saves advance this,
  // so we never mistake our own work for a remote change and reload over it.
  const localRevRef = useRef(0);
  // Unsaved local edits exist.
  const dirtyRef = useRef(false);
  // A save request is in flight (the server may already be ahead of localRev).
  const savingRef = useRef(false);
  // We're applying a remote snapshot; ignore the store churn it causes.
  const applyingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const save = useCallback(async () => {
    saveTimer.current = null;
    const editor = editorRef.current;
    if (!editor || applyingRef.current || savingRef.current) return;
    dirtyRef.current = false;
    let snapshot: string;
    try {
      snapshot = JSON.stringify(editor.getSnapshot().document);
    } catch (err) {
      reportError(boardId, "getSnapshot", err);
      return;
    }
    savingRef.current = true;
    try {
      const res = await fetch(`/api/whiteboard/${boardId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      if (res.ok) {
        const { rev } = (await res.json()) as { rev: number };
        // Our save IS this revision, so we're consistent up to it — even if more
        // edits piled up while the request was in flight. This is the key guard
        // against reloading our own work on a slow connection.
        if (typeof rev === "number") {
          localRevRef.current = Math.max(localRevRef.current, rev);
        }
      }
    } catch {
      // Network blip: the next edit re-saves; pollers converge from what landed.
    } finally {
      savingRef.current = false;
      // If edits arrived during the save, make sure they get flushed.
      if (dirtyRef.current && !saveTimer.current) {
        saveTimer.current = setTimeout(save, SAVE_MS);
      }
    }
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(save, SAVE_MS);
  }, [save]);

  const busy = (editor: Editor) =>
    dirtyRef.current ||
    savingRef.current ||
    editor.inputs.isPointing ||
    !!editor.getEditingShapeId();

  const applySnapshot = useCallback(
    (editor: Editor, snapshot: string) => {
      if (!snapshot) return;
      let doc: DocSnapshot;
      try {
        doc = JSON.parse(snapshot) as DocSnapshot;
      } catch (err) {
        reportError(boardId, "parseSnapshot", err);
        return;
      }
      applyingRef.current = true;
      try {
        // editor.loadSnapshot reconciles the current page/camera against the
        // loaded document. Passing only { document } keeps this viewer's camera.
        editor.loadSnapshot({ document: doc });
      } catch (err) {
        reportError(boardId, "loadSnapshot", err);
      } finally {
        applyingRef.current = false;
      }
    },
    [boardId]
  );

  const poll = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || busy(editor)) return;
    try {
      const res = await fetch(`/api/whiteboard/${boardId}/changes`);
      if (!res.ok) return;
      const { rev } = (await res.json()) as { rev: number };
      if (typeof rev !== "number" || rev <= localRevRef.current) return;
      // A genuinely newer revision from someone else: pull the full snapshot.
      const full = await fetch(`/api/whiteboard/${boardId}`);
      if (!full.ok) return;
      const data = (await full.json()) as { rev: number; snapshot: string };
      // Re-check we're still idle before clobbering the canvas — the user may
      // have started drawing while these requests were in flight.
      if (busy(editor)) return;
      applySnapshot(editor, data.snapshot);
      localRevRef.current = Math.max(localRevRef.current, data.rev);
    } catch {
      // ignore; try again next tick
    }
  }, [boardId, applySnapshot]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      // Report uncaught errors/rejections while this board is mounted.
      const onErr = (e: ErrorEvent) => reportError(boardId, "window", e.error || e.message);
      const onRej = (e: PromiseRejectionEvent) =>
        reportError(boardId, "unhandledrejection", e.reason);
      window.addEventListener("error", onErr);
      window.addEventListener("unhandledrejection", onRej);

      (async () => {
        try {
          const res = await fetch(`/api/whiteboard/${boardId}`);
          if (res.ok) {
            const data = (await res.json()) as { rev: number; snapshot: string };
            applySnapshot(editor, data.snapshot);
            localRevRef.current = Math.max(localRevRef.current, data.rev || 0);
          }
        } catch {
          // Empty board is fine; the first edit seeds it.
        }

        const unlisten = editor.store.listen(
          () => {
            if (applyingRef.current) return;
            dirtyRef.current = true;
            scheduleSave();
          },
          { source: "user", scope: "document" }
        );
        cleanupRef.current = () => {
          unlisten();
          window.removeEventListener("error", onErr);
          window.removeEventListener("unhandledrejection", onRej);
        };

        pollTimer.current = setInterval(poll, POLL_MS);
      })();

      return () => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        cleanupRef.current?.();
        if (dirtyRef.current) void save();
      };
    },
    [boardId, applySnapshot, scheduleSave, poll, save]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <BoardErrorBoundary boardId={boardId}>
        <Tldraw onMount={handleMount} />
      </BoardErrorBoundary>
    </div>
  );
}
