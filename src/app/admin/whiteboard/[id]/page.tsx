"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { WhiteboardCanvas } from "@/components/WhiteboardCanvas";
import { WhiteboardShare } from "@/components/WhiteboardShare";

type Role = "owner" | "editor" | "viewer";
type Viewer = { slug: string; label: string };

const AVATAR_COLORS = ["#0f766e", "#1d4ed8", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#3f6212"];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(slug: string): string {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function WhiteboardBoardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [elements, setElements] = useState<OrderedExcalidrawElement[]>([]);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [updatedAt, setUpdatedAt] = useState("");
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [sharing, setSharing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetch(`/api/whiteboard/${id}`)
      .then((res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (res.status === 404) {
          setState("missing");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!live || !data?.board) return;
        setTitle(data.board.title);
        setDraft(data.board.title);
        setRole(data.board.role);
        setElements(Array.isArray(data.scene?.elements) ? data.scene.elements : []);
        setFiles(data.scene?.files && typeof data.scene.files === "object" ? data.scene.files : {});
        setUpdatedAt(data.updatedAt || data.board.updatedAt || "");
        setViewers(Array.isArray(data.viewers) ? data.viewers : []);
        setState("ready");
      });
    return () => {
      live = false;
    };
  }, [id, router]);

  const onViewers = useCallback((next: Viewer[]) => {
    setViewers((current) => {
      const same =
        current.length === next.length && current.every((viewer, index) => viewer.slug === next[index]?.slug);
      return same ? current : next;
    });
  }, []);

  async function commitTitle() {
    const next = draft.trim();
    if (!next || next === title) {
      setDraft(title);
      return;
    }
    setTitle(next);
    await fetch(`/api/whiteboard/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
  }

  if (state === "missing") {
    return (
      <div className="wb-missing">
        <h1>This board isn’t available</h1>
        <Link href="/admin/whiteboard">Back to whiteboards</Link>
      </div>
    );
  }

  return (
    <div className="wb-board">
      <header className="wb-bar">
        <Link className="btn btn-ghost btn-sm" href="/admin/whiteboard">
          Boards
        </Link>
        {state === "ready" && role === "owner" ? (
          <input
            className="wb-title-input"
            aria-label="Board name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.target as HTMLInputElement).blur();
              }
            }}
          />
        ) : (
          <h1 className="wb-title">{title || "Whiteboard"}</h1>
        )}
        <div className="wb-bar-spacer" />
        {viewers.length > 0 ? (
          <div className="wb-avatars" aria-label="People viewing">
            {viewers.slice(0, 6).map((viewer) => (
              <span
                key={viewer.slug}
                className="wb-avatar"
                title={viewer.label}
                style={{ background: avatarColor(viewer.slug) }}
              >
                {initials(viewer.label)}
              </span>
            ))}
          </div>
        ) : null}
        {role === "viewer" ? (
          <span className="wb-view-only" data-testid="wb-view-only">
            View only
          </span>
        ) : null}
        {role === "owner" ? (
          <button type="button" className="btn btn-sm" onClick={() => setSharing(true)} data-testid="wb-share">
            Share
          </button>
        ) : null}
      </header>
      {state === "ready" ? (
        <WhiteboardCanvas
          boardId={id}
          canEdit={role !== "viewer"}
          initialElements={elements}
          initialFiles={files}
          initialUpdatedAt={updatedAt}
          onViewers={onViewers}
          onAccessLost={() => setState("missing")}
        />
      ) : (
        <div className="wb-loading">Loading board…</div>
      )}
      {sharing ? <WhiteboardShare boardId={id} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
