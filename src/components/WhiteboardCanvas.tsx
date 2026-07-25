"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import type {
  Editor,
  HistoryEntry,
  TLRecord,
  TLStoreSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";

// Bump on every whiteboard client change. Logged on mount so the deploy logs
// show which build a viewer is running.
const SYNC_VERSION = "v6-per-record";

const Tldraw = dynamic(() => import("tldraw").then((m) => m.Tldraw), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, color: "var(--muted, #888)" }}>
      Loading board…
    </div>
  ),
});

// How often each viewer pulls remote changes, and how long local edits are
// batched before being pushed.
const POLL_MS = 2000;
const SAVE_MS = 500;

type Wire = { id: string; data: TLRecord };

function report(boardId: string, where: string, err: unknown) {
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
// and offer a reload instead of a white screen.
class BoardErrorBoundary extends Component<
  { boardId: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    report(this.props.boardId, "render", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24 }}>
          <p style={{ marginBottom: 12 }}>
            The board hit a snag rendering. Reloading usually clears it.
          </p>
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
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
  // Server-time cursor: the timestamp of the last change we applied.
  const sinceRef = useRef<string>("1970-01-01T00:00:00.000Z");
  // Local, unsaved record changes, deduped by id.
  const pendingPut = useRef<Map<string, TLRecord>>(new Map());
  const pendingRemove = useRef<Set<string>>(new Set());
  // We're applying remote changes; ignore the store churn they cause.
  const applyingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const save = useCallback(async () => {
    saveTimer.current = null;
    if (!pendingPut.current.size && !pendingRemove.current.size) return;
    const put: Wire[] = Array.from(pendingPut.current.values()).map((data) => ({
      id: data.id,
      data,
    }));
    const remove = Array.from(pendingRemove.current);
    pendingPut.current.clear();
    pendingRemove.current.clear();
    try {
      await fetch(`/api/whiteboard/${boardId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ put, remove }),
      });
    } catch {
      // Network blip: subsequent edits re-push; pollers converge from what landed.
    }
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(save, SAVE_MS);
  }, [save]);

  // Apply remote record changes, but never touch a record the local user is
  // currently editing (still pending), so incoming updates can't revert
  // work-in-progress. Everyone only ever writes their own records, so this is
  // conflict-free in practice.
  const applyRemote = useCallback(
    (editor: Editor, put: Wire[], remove: string[]) => {
      const puts = put
        .filter(
          (r) =>
            r &&
            typeof r.id === "string" &&
            !pendingPut.current.has(r.id) &&
            !pendingRemove.current.has(r.id)
        )
        .map((r) => r.data);
      const removes = remove.filter(
        (id) => !pendingPut.current.has(id) && !pendingRemove.current.has(id)
      ) as TLRecord["id"][];
      if (!puts.length && !removes.length) return;
      applyingRef.current = true;
      try {
        editor.store.mergeRemoteChanges(() => {
          if (puts.length) editor.store.put(puts);
          if (removes.length) editor.store.remove(removes);
        });
      } catch (err) {
        report(boardId, "applyRemote", err);
      } finally {
        applyingRef.current = false;
      }
    },
    [boardId]
  );

  const poll = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const res = await fetch(
        `/api/whiteboard/${boardId}/changes?since=${encodeURIComponent(
          sinceRef.current
        )}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        put: Wire[];
        remove: string[];
        now: string;
      };
      applyRemote(editor, data.put || [], data.remove || []);
      if (data.now) sinceRef.current = data.now;
    } catch {
      // try again next tick
    }
  }, [boardId, applyRemote]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      report(boardId, "mount", SYNC_VERSION);

      const onErr = (e: ErrorEvent) => report(boardId, "window", e.error || e.message);
      const onRej = (e: PromiseRejectionEvent) =>
        report(boardId, "unhandledrejection", e.reason);
      window.addEventListener("error", onErr);
      window.addEventListener("unhandledrejection", onRej);

      (async () => {
        // Initial load: adopt the server's document so all viewers share the
        // same pages/shapes.
        try {
          const res = await fetch(`/api/whiteboard/${boardId}`);
          if (res.ok) {
            const { records, now } = (await res.json()) as {
              records: Wire[];
              now?: string;
            };
            if (records?.length) {
              const store: Record<string, TLRecord> = {};
              for (const r of records) store[r.id] = r.data;
              const snapshot: TLStoreSnapshot = {
                store,
                schema: editor.store.schema.serialize(),
              };
              applyingRef.current = true;
              try {
                editor.loadSnapshot(snapshot);
              } catch (err) {
                report(boardId, "loadInitial", err);
              } finally {
                applyingRef.current = false;
              }
            }
            if (now) sinceRef.current = now;
          }
        } catch {
          /* empty board is fine */
        }

        // Persist the structural records (document + pages) that existed before
        // this listener attached, so other viewers never get a shape whose page
        // is missing.
        try {
          const docRecords = Object.values(
            editor.store.serialize("document")
          ) as TLRecord[];
          const structural = docRecords
            .filter((r) => r.typeName === "page" || r.typeName === "document")
            .map((data) => ({ id: data.id, data }));
          if (structural.length) {
            void fetch(`/api/whiteboard/${boardId}/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ put: structural, remove: [] }),
            });
          }
        } catch (err) {
          report(boardId, "seedStructural", err);
        }

        // Push local, user-driven changes.
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
        void save();
      };
    },
    [boardId, poll, scheduleSave, save]
  );

  const components = useMemo(
    () => ({
      ErrorFallback: ({ error }: { error: unknown }) => {
        useEffect(() => {
          report(boardId, "tldraw-error", error);
        }, [error]);
        return (
          <div style={{ padding: 24 }}>
            <p style={{ marginBottom: 12 }}>
              The board hit a snag. Reloading usually clears it.
            </p>
            <button
              className="btn btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload board
            </button>
          </div>
        );
      },
      ShapeErrorFallback: ({ error }: { error: unknown }) => {
        useEffect(() => {
          report(boardId, "tldraw-shape-error", error);
        }, [error]);
        return null;
      },
    }),
    [boardId]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <BoardErrorBoundary boardId={boardId}>
        <Tldraw onMount={handleMount} components={components} />
      </BoardErrorBoundary>
    </div>
  );
}
