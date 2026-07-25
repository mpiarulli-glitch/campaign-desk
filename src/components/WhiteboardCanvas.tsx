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
// are batched before being saved. Small enough to feel live without hammering
// the single Next process.
const POLL_MS = 2000;
const SAVE_MS = 700;

type DocSnapshot = TLEditorSnapshot["document"];

// A render error inside tldraw would otherwise blank the whole route. Contain
// it and offer a reload instead of a white screen.
class BoardErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
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
  // Revision we currently hold. The poll pulls a fresh snapshot when the server
  // revision moves past this.
  const localRevRef = useRef(0);
  // Local edits made since our last save. While dirty we push, never pull, so a
  // remote snapshot can't wipe work-in-progress.
  const dirtyRef = useRef(false);
  // True while we're applying a remote snapshot, so that store churn from the
  // load can't be mistaken for a local edit.
  const applyingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const save = useCallback(async () => {
    saveTimer.current = null;
    const editor = editorRef.current;
    if (!editor || applyingRef.current) return;
    dirtyRef.current = false;
    let snapshot: string;
    try {
      snapshot = JSON.stringify(editor.getSnapshot().document);
    } catch {
      return;
    }
    try {
      const res = await fetch(`/api/whiteboard/${boardId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      if (res.ok) {
        const { rev } = (await res.json()) as { rev: number };
        // Only advance our revision if nothing changed while the save was in
        // flight; otherwise the next save handles it.
        if (!dirtyRef.current) localRevRef.current = rev;
      }
    } catch {
      // Network blip: the board is still dirty-free locally, but the next edit
      // re-saves and pollers converge from whatever landed.
    }
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(save, SAVE_MS);
  }, [save]);

  const applySnapshot = useCallback((editor: Editor, snapshot: string) => {
    if (!snapshot) return;
    let doc: DocSnapshot;
    try {
      doc = JSON.parse(snapshot) as DocSnapshot;
    } catch {
      return;
    }
    applyingRef.current = true;
    try {
      // editor.loadSnapshot reconciles the current page/camera against the
      // loaded document, so we never end up pointing at a page that no longer
      // exists. Passing only { document } keeps this viewer's camera put.
      editor.loadSnapshot({ document: doc });
    } catch (err) {
      console.warn("whiteboard: could not apply snapshot", err);
    } finally {
      applyingRef.current = false;
    }
  }, []);

  const poll = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    // Don't pull while the user is mid-action or has unsaved edits — that's when
    // a remote overwrite would be disruptive or lose work.
    if (dirtyRef.current || editor.inputs.isPointing || editor.getEditingShapeId()) {
      return;
    }
    try {
      const res = await fetch(`/api/whiteboard/${boardId}/changes`);
      if (!res.ok) return;
      const { rev } = (await res.json()) as { rev: number };
      if (rev <= localRevRef.current) return;
      // A newer revision exists: pull the full snapshot and adopt it.
      const full = await fetch(`/api/whiteboard/${boardId}`);
      if (!full.ok) return;
      const data = (await full.json()) as { rev: number; snapshot: string };
      // Re-check we're still idle before clobbering the canvas.
      if (dirtyRef.current || editor.inputs.isPointing || editor.getEditingShapeId()) {
        return;
      }
      applySnapshot(editor, data.snapshot);
      localRevRef.current = data.rev;
    } catch {
      // ignore; try again next tick
    }
  }, [boardId, applySnapshot]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      (async () => {
        // Initial load.
        try {
          const res = await fetch(`/api/whiteboard/${boardId}`);
          if (res.ok) {
            const data = (await res.json()) as {
              rev: number;
              snapshot: string;
            };
            applySnapshot(editor, data.snapshot);
            localRevRef.current = data.rev;
          }
        } catch {
          // Empty board is fine; the first edit seeds it.
        }

        // Mark the board dirty on any user-driven document change and schedule a
        // save. Remote applies use source "remote", so they don't trip this.
        const unlisten = editor.store.listen(
          () => {
            if (applyingRef.current) return;
            dirtyRef.current = true;
            scheduleSave();
          },
          { source: "user", scope: "document" }
        );
        cleanupRef.current = unlisten;

        pollTimer.current = setInterval(poll, POLL_MS);
      })();

      // tldraw calls this on unmount.
      return () => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        cleanupRef.current?.();
        // Best-effort final save of anything unsaved.
        if (dirtyRef.current) void save();
      };
    },
    [boardId, applySnapshot, scheduleSave, poll, save]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <BoardErrorBoundary>
        <Tldraw onMount={handleMount} />
      </BoardErrorBoundary>
    </div>
  );
}
