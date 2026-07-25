"use client";

import { Component, useCallback, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type {
  Editor,
  HistoryEntry,
  TLRecord,
  TLStoreSnapshot,
} from "tldraw";
import { loadSnapshot } from "tldraw";
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

// How often each viewer pulls remote changes, and how long local edits are
// batched before being pushed. Both are deliberately small so the board feels
// live without hammering the single Next process.
const POLL_MS = 2000;
const FLUSH_MS = 500;

// One record as it travels to/from our API: the tldraw record id plus the
// record itself.
type Wire = { id: string; data: TLRecord };

// Records that structure the document (the singleton document record and the
// pages). tldraw creates these at store init, before onMount attaches our
// change listener, so they'd never be pushed by the incremental listener alone.
// We push them explicitly on mount — otherwise the server ends up with shapes
// whose parent page is missing, and loading that crashes the canvas.
function isStructural(r: TLRecord): boolean {
  return r.typeName === "page" || r.typeName === "document";
}

// A render error inside tldraw (e.g. a shape referencing a missing page) would
// otherwise blank the whole route. Contain it and offer a reload instead.
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
  // Server clock cursor: the timestamp of the last changes we applied. The next
  // poll asks for everything newer than this.
  const sinceRef = useRef<string>("1970-01-01T00:00:00.000Z");
  // Local edits waiting to be pushed, deduped by record id.
  const pendingPut = useRef<Map<string, TLRecord>>(new Map());
  const pendingRemove = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const postSync = useCallback(
    async (put: Wire[], remove: string[]) => {
      if (!put.length && !remove.length) return;
      try {
        await fetch(`/api/whiteboard/${boardId}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ put, remove }),
        });
      } catch {
        // Network blips are fine: the next edit re-pushes, and pollers still
        // converge from whatever did land.
      }
    },
    [boardId]
  );

  const flush = useCallback(() => {
    flushTimer.current = null;
    const put = Array.from(pendingPut.current.values()).map(
      (data): Wire => ({ id: data.id, data })
    );
    const remove = Array.from(pendingRemove.current);
    pendingPut.current.clear();
    pendingRemove.current.clear();
    void postSync(put, remove);
  }, [postSync]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const poll = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    let data: { put: Wire[]; remove: string[]; now: string };
    try {
      const res = await fetch(
        `/api/whiteboard/${boardId}/changes?since=${encodeURIComponent(
          sinceRef.current
        )}`
      );
      if (!res.ok) return;
      data = await res.json();
    } catch {
      return;
    }
    if (data.put.length || data.remove.length) {
      try {
        // mergeRemoteChanges tags these as source "remote" so our own listener
        // (which only reacts to source "user") does not echo them back out.
        editor.store.mergeRemoteChanges(() => {
          // Put before remove so a shape and its page can arrive together.
          if (data.put.length) editor.store.put(data.put.map((r) => r.data));
          if (data.remove.length) {
            editor.store.remove(data.remove as TLRecord["id"][]);
          }
        });
      } catch (err) {
        // A malformed or orphaned record must not take the canvas down; skip
        // this batch and let the next poll try again.
        console.warn("whiteboard: skipped a bad remote change batch", err);
      }
    }
    sinceRef.current = data.now;
  }, [boardId]);

  const cleanupRef = useRef<(() => void) | null>(null);

  // onMount must be synchronous (it returns a cleanup fn, not a Promise), so the
  // async initial load runs in a fire-and-forget IIFE and wires up the listener
  // and poll loop once the board has loaded.
  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      (async () => {
        // Initial load: adopt the server's document wholesale so every viewer
        // converges on the same pages and shapes (rather than merging each
        // client's default empty page).
        try {
          const res = await fetch(`/api/whiteboard/${boardId}`);
          if (res.ok) {
            const { records, now } = (await res.json()) as {
              records: Wire[];
              now?: string;
            };
            // Only load if the saved document is self-consistent (has at least
            // one page). Legacy boards saved before the structural-push fix may
            // have shapes with no page; loading those would crash, so we skip
            // them and let the mount push below re-seed a clean page.
            const hasPage = records.some((r) => r.data?.typeName === "page");
            if (records.length && hasPage) {
              const store: Record<string, TLRecord> = {};
              for (const r of records) store[r.id] = r.data;
              const snapshot: TLStoreSnapshot = {
                store,
                schema: editor.store.schema.serialize(),
              };
              try {
                loadSnapshot(editor.store, snapshot);
              } catch (err) {
                console.warn("whiteboard: could not load saved board", err);
              }
            }
            if (now) sinceRef.current = now;
          }
        } catch {
          // Start from an empty board if the initial load fails; the poll loop
          // will still pull anything the server has.
        }

        // Persist the structural records (document + pages) that existed before
        // this listener attached, so other viewers never receive a shape whose
        // page is missing.
        try {
          const docRecords = Object.values(
            editor.store.serialize("document")
          ) as TLRecord[];
          const structural = docRecords
            .filter(isStructural)
            .map((data): Wire => ({ id: data.id, data }));
          void postSync(structural, []);
        } catch (err) {
          console.warn("whiteboard: could not seed structural records", err);
        }

        // Push local, user-driven document edits to the server.
        const unlisten = editor.store.listen(
          (entry: HistoryEntry<TLRecord>) => {
            const { added, updated, removed } = entry.changes;
            for (const rec of Object.values(added)) {
              pendingPut.current.set(rec.id, rec);
              pendingRemove.current.delete(rec.id);
            }
            for (const [, to] of Object.values(updated)) {
              pendingPut.current.set(to.id, to);
              pendingRemove.current.delete(to.id);
            }
            for (const rec of Object.values(removed)) {
              pendingRemove.current.add(rec.id);
              pendingPut.current.delete(rec.id);
            }
            scheduleFlush();
          },
          { source: "user", scope: "document" }
        );
        cleanupRef.current = unlisten;

        pollTimer.current = setInterval(poll, POLL_MS);
      })();

      // tldraw calls this on unmount.
      return () => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        cleanupRef.current?.();
        // Best-effort final push of anything still batched.
        flush();
      };
    },
    [boardId, poll, scheduleFlush, flush, postSync]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <BoardErrorBoundary>
        <Tldraw onMount={handleMount} />
      </BoardErrorBoundary>
    </div>
  );
}
