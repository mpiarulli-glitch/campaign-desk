"use client";

import { useCallback, useRef } from "react";
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

  const flush = useCallback(async () => {
    flushTimer.current = null;
    const put = Array.from(pendingPut.current.values()).map(
      (data): Wire => ({ id: data.id, data })
    );
    const remove = Array.from(pendingRemove.current);
    pendingPut.current.clear();
    pendingRemove.current.clear();
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
  }, [boardId]);

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
      // mergeRemoteChanges tags these as source "remote" so our own listener
      // (which only reacts to source "user") does not echo them back out.
      editor.store.mergeRemoteChanges(() => {
        if (data.put.length) editor.store.put(data.put.map((r) => r.data));
        if (data.remove.length) {
          editor.store.remove(data.remove as TLRecord["id"][]);
        }
      });
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
            if (records.length) {
              const store: Record<string, TLRecord> = {};
              for (const r of records) store[r.id] = r.data;
              const snapshot: TLStoreSnapshot = {
                store,
                schema: editor.store.schema.serialize(),
              };
              loadSnapshot(editor.store, snapshot);
            }
            if (now) sinceRef.current = now;
          }
        } catch {
          // Start from an empty board if the initial load fails; the poll loop
          // will still pull anything the server has.
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
    [boardId, poll, scheduleFlush, flush]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Tldraw onMount={handleMount} />
    </div>
  );
}
