"use client";

import { useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";

// Excalidraw is MIT-licensed with no production gate, and touches the DOM at
// import time, so load it client-side only.
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((m) => m.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div style={{ padding: 24, color: "var(--muted, #888)" }}>
        Loading board…
      </div>
    ),
  }
);

const POLL_MS = 2000;
const SAVE_MS: number = 500;

type Wire = { id: string; data: OrderedExcalidrawElement };

export function WhiteboardCanvas({ boardId }: { boardId: string }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // ISO cursor: timestamp of the last change we pulled.
  const sinceRef = useRef<string>("1970-01-01T00:00:00.000Z");
  // Highest element version we've already sent to the server, per element id.
  const sentVersions = useRef<Map<string, number>>(new Map());
  // Elements changed locally and waiting to be pushed.
  const outgoing = useRef<Map<string, OrderedExcalidrawElement>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const save = useCallback(async () => {
    saveTimer.current = null;
    if (!outgoing.current.size) return;
    const put: Wire[] = Array.from(outgoing.current.values()).map((e) => ({
      id: e.id,
      data: e,
    }));
    outgoing.current.clear();
    try {
      await fetch(`/api/whiteboard/${boardId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ put, remove: [] }),
      });
    } catch {
      // Network blip: later edits re-push; pollers converge from what landed.
    }
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(save, SAVE_MS);
  }, [save]);

  // Fired by Excalidraw on every change. Deletions arrive as elements flagged
  // isDeleted with a bumped version, so version-tracking captures them too.
  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      let changed = false;
      for (const e of elements) {
        const sent = sentVersions.current.get(e.id);
        if (sent === undefined || e.version > sent) {
          outgoing.current.set(e.id, e);
          sentVersions.current.set(e.id, e.version);
          changed = true;
        }
      }
      if (changed) scheduleSave();
    },
    [scheduleSave]
  );

  const applyRemote = useCallback(
    async (api: ExcalidrawImperativeAPI, remote: OrderedExcalidrawElement[]) => {
      if (!remote.length) return;
      const { reconcileElements } = await import("@excalidraw/excalidraw");
      const local = api.getSceneElements();
      // reconcileElements does version-aware merging and respects whatever the
      // local user is actively editing — Excalidraw's own collab logic.
      const reconciled = reconcileElements(
        local,
        remote as never,
        api.getAppState()
      );
      // Mark these versions as already-known so onChange doesn't rebroadcast them.
      for (const e of reconciled) sentVersions.current.set(e.id, e.version);
      api.updateScene({ elements: reconciled });
    },
    []
  );

  const poll = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const res = await fetch(
        `/api/whiteboard/${boardId}/changes?since=${encodeURIComponent(
          sinceRef.current
        )}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { put: Wire[]; now: string };
      const remote = (data.put || [])
        .map((r) => r.data)
        .filter((e): e is OrderedExcalidrawElement => !!e && !!e.id);
      await applyRemote(api, remote);
      if (data.now) sinceRef.current = data.now;
    } catch {
      // try again next tick
    }
  }, [boardId, applyRemote]);

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;

      (async () => {
        // Initial load: restore the server's elements into the scene.
        try {
          const res = await fetch(`/api/whiteboard/${boardId}`);
          if (res.ok) {
            const { records, now } = (await res.json()) as {
              records: Wire[];
              now?: string;
            };
            const raw = (records || []).map((r) => r.data);
            if (raw.length) {
              const { restoreElements } = await import("@excalidraw/excalidraw");
              const elements = restoreElements(
                raw as ExcalidrawElement[],
                null
              );
              for (const e of elements) {
                sentVersions.current.set(
                  e.id,
                  (e as OrderedExcalidrawElement).version
                );
              }
              api.updateScene({ elements });
            }
            if (now) sinceRef.current = now;
          }
        } catch {
          // empty board is fine
        }

        pollTimer.current = setInterval(poll, POLL_MS);
      })();
    },
    [boardId, poll]
  );

  // Clean up timers when the board unmounts.
  const cleanup = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const props: ExcalidrawProps = {
    excalidrawAPI: handleApi,
    onChange: onChange as ExcalidrawProps["onChange"],
  };

  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      ref={(node) => {
        if (!node) cleanup();
      }}
    >
      <Excalidraw {...props} />
    </div>
  );
}
