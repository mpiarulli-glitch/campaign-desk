"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => <div className="wb-loading">Loading board…</div>,
  }
);

const POLL_MS = 3000;
const SAVE_MS = 700;

type SceneElement = OrderedExcalidrawElement;
type Viewer = { slug: string; label: string };

type Props = {
  boardId: string;
  canEdit: boolean;
  initialElements: readonly SceneElement[];
  initialFiles: BinaryFiles;
  initialUpdatedAt: string;
  onViewers?: (viewers: Viewer[]) => void;
  onAccessLost?: () => void;
};

function useAppTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function WhiteboardCanvas({
  boardId,
  canEdit,
  initialElements,
  initialFiles,
  initialUpdatedAt,
  onViewers,
  onAccessLost,
}: Props) {
  const theme = useAppTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sinceRef = useRef(initialUpdatedAt);
  const sentVersions = useRef<Map<string, number>>(new Map());
  const sentFiles = useRef<Map<string, string>>(new Map());
  const outgoing = useRef<Map<string, SceneElement>>(new Map());
  const outgoingFiles = useRef<Map<string, BinaryFileData>>(new Map());
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const onViewersRef = useRef(onViewers);
  const onAccessLostRef = useRef(onAccessLost);
  onViewersRef.current = onViewers;
  onAccessLostRef.current = onAccessLost;

  const remember = useCallback((elements: readonly SceneElement[]) => {
    for (const element of elements) sentVersions.current.set(element.id, element.version);
  }, []);

  const applyRemote = useCallback(
    async (api: ExcalidrawImperativeAPI, remote: SceneElement[], files?: BinaryFiles) => {
      if (files && Object.keys(files).length) {
        const list: BinaryFileData[] = [];
        for (const file of Object.values(files)) {
          if (!file?.dataURL) continue;
          list.push(file);
          sentFiles.current.set(file.id, file.dataURL);
        }
        if (list.length) api.addFiles(list);
      }
      if (!remote.length) return;
      const local = api.getSceneElementsIncludingDeleted();
      const localVersion = new Map(local.map((element) => [element.id, element.version]));
      const differs = remote.some((element) => localVersion.get(element.id) !== element.version);
      if (!differs) {
        remember(remote);
        return;
      }
      const { reconcileElements } = await import("@excalidraw/excalidraw");
      const reconciled = reconcileElements(local, remote as never, api.getAppState());
      remember(reconciled);
      api.updateScene({ elements: reconciled });
    },
    [remember]
  );

  const saveOnce = useCallback(async () => {
    if (!canEdit) return;
    if (!outgoing.current.size && !outgoingFiles.current.size) return;
    const elements = Array.from(outgoing.current.values());
    const files: Record<string, BinaryFileData> = {};
    for (const [id, file] of outgoingFiles.current) files[id] = file;
    outgoing.current.clear();
    outgoingFiles.current.clear();
    for (const [id, file] of Object.entries(files)) sentFiles.current.set(id, file.dataURL);

    try {
      const res = await fetch(`/api/whiteboard/${boardId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements, files }),
      });
      if (res.status === 404 || res.status === 403) {
        onAccessLostRef.current?.();
        return;
      }
      if (!res.ok) {
        for (const element of elements) outgoing.current.set(element.id, element);
        for (const [id, file] of Object.entries(files)) outgoingFiles.current.set(id, file);
        return;
      }
      const data = (await res.json()) as {
        elements?: SceneElement[];
        files?: BinaryFiles;
        updatedAt?: string;
        viewers?: Viewer[];
      };
      const api = apiRef.current;
      if (api && data.elements) await applyRemote(api, data.elements, data.files);
      if (data.updatedAt) sinceRef.current = data.updatedAt;
      if (data.viewers) onViewersRef.current?.(data.viewers);
    } catch {
      for (const element of elements) outgoing.current.set(element.id, element);
      for (const [id, file] of Object.entries(files)) outgoingFiles.current.set(id, file);
    }
  }, [applyRemote, boardId, canEdit]);

  const enqueueSave = useCallback(() => {
    chain.current = chain.current.then(() => saveOnce()).catch(() => undefined);
    return chain.current;
  }, [saveOnce]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void enqueueSave();
    }, SAVE_MS);
  }, [enqueueSave]);

  const onChange = useCallback(
    (elements: readonly SceneElement[], _appState: unknown, files: BinaryFiles) => {
      if (!hydrated.current || !canEdit) return;
      let changed = false;
      for (const element of elements) {
        const sent = sentVersions.current.get(element.id);
        if (sent === undefined || element.version > sent) {
          outgoing.current.set(element.id, element);
          sentVersions.current.set(element.id, element.version);
          changed = true;
        }
      }
      for (const file of Object.values(files)) {
        if (!file?.id || !file.dataURL) continue;
        if (sentFiles.current.get(file.id) !== file.dataURL) {
          outgoingFiles.current.set(file.id, file);
          changed = true;
        }
      }
      if (changed) scheduleSave();
    },
    [canEdit, scheduleSave]
  );

  const poll = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    if (outgoing.current.size || outgoingFiles.current.size) await enqueueSave();
    try {
      const res = await fetch(
        `/api/whiteboard/${boardId}/changes?since=${encodeURIComponent(sinceRef.current)}`
      );
      if (res.status === 404) {
        onAccessLostRef.current?.();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        elements?: SceneElement[];
        files?: BinaryFiles;
        updatedAt?: string;
        viewers?: Viewer[];
      };
      if (data.elements?.length || (data.files && Object.keys(data.files).length)) {
        await applyRemote(api, data.elements || [], data.files);
      }
      if (data.updatedAt) sinceRef.current = data.updatedAt;
      if (data.viewers) onViewersRef.current?.(data.viewers);
    } catch {
      // The next poll retries.
    }
  }, [applyRemote, boardId, enqueueSave]);

  useEffect(() => {
    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void enqueueSave();
    };
  }, [enqueueSave, poll]);

  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    // Seed from the scene we were given, not from the still-empty editor.
    // Excalidraw calls this during construction, before initialData is restored,
    // and the restore that follows must not look like a brand-new edit.
    for (const element of initialElements) {
      if (element?.id && typeof element.version === "number") {
        sentVersions.current.set(element.id, element.version);
      }
    }
    for (const file of Object.values(initialFiles)) {
      if (file?.id && file.dataURL) sentFiles.current.set(file.id, file.dataURL);
    }
    hydrated.current = true;
  }, [initialElements, initialFiles]);

  const background = theme === "dark" ? "#141416" : "#ffffff";
  const filesForEditor: BinaryFiles = {};
  for (const file of Object.values(initialFiles)) {
    if (!file?.id || !file.dataURL) continue;
    filesForEditor[file.id] = { ...file, created: file.created || 1 };
  }

  return (
    <div className="wb-stage" data-testid="wb-canvas" data-view-only={canEdit ? "false" : "true"}>
      <Excalidraw
        excalidrawAPI={handleApi}
        onChange={onChange}
        theme={theme}
        viewModeEnabled={!canEdit}
        initialData={{
          elements: initialElements as SceneElement[],
          files: filesForEditor,
          appState: {
            viewBackgroundColor: background,
            theme,
          },
        }}
      />
    </div>
  );
}
