"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Board = {
  id: string;
  title: string;
  folder_id: string | null;
  created_by: string;
  updated_at: string;
};

type Folder = {
  id: string;
  title: string;
};

export default function WhiteboardListPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [folderTitle, setFolderTitle] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/whiteboard").then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.ok ? r.json() : null;
      }),
      fetch("/api/whiteboard/folders").then((r) => (r.ok ? r.json() : null)),
    ]).then(([boardData, folderData]) => {
      if (boardData) setBoards(boardData.boards);
      if (folderData) setFolders(folderData.folders);
      setLoading(false);
    });
  }, [router]);

  async function createBoard() {
    if (creating) return;
    setCreating(true);
    const res = await fetch("/api/whiteboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setCreating(false);
    if (res.ok) {
      const { board } = await res.json();
      router.push(`/admin/whiteboard/${board.id}`);
    }
  }

  async function createFolder() {
    if (creatingFolder || !folderTitle.trim()) return;
    setCreatingFolder(true);
    const res = await fetch("/api/whiteboard/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: folderTitle.trim() }),
    });
    setCreatingFolder(false);
    if (res.ok) {
      const { folder } = await res.json();
      setFolders((prev) => [...prev, folder]);
      setFolderTitle("");
    }
  }

  async function deleteBoard(board: Board) {
    if (!confirm(`Delete "${board.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/whiteboard/${board.id}`, { method: "DELETE" });
    if (res.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
    }
  }

  async function moveBoard(board: Board, folderId: string) {
    const nextFolderId = folderId || null;
    setBoards((prev) =>
      prev.map((b) => (b.id === board.id ? { ...b, folder_id: nextFolderId } : b))
    );
    await fetch(`/api/whiteboard/${board.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: nextFolderId }),
    });
  }

  async function deleteFolder(folder: Folder) {
    if (
      !confirm(
        `Delete the "${folder.title}" folder? Its boards will move back to Unfiled.`
      )
    )
      return;
    const res = await fetch(`/api/whiteboard/folders/${folder.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      setBoards((prev) =>
        prev.map((b) => (b.folder_id === folder.id ? { ...b, folder_id: null } : b))
      );
    }
  }

  function BoardRow({ board }: { board: Board }) {
    return (
      <div className="campaign-item" style={{ color: "inherit" }}>
        <Link
          href={`/admin/whiteboard/${board.id}`}
          style={{ display: "flex", flexDirection: "column", flex: 1, color: "inherit" }}
        >
          <span style={{ fontWeight: 600 }}>{board.title}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {board.created_by ? `by ${board.created_by}` : ""}
          </span>
        </Link>
        <select
          className="select-clean"
          value={board.folder_id || ""}
          onChange={(e) => moveBoard(board, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 12, padding: "6px 8px" }}
        >
          <option value="">Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={(e) => {
            e.preventDefault();
            deleteBoard(board);
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  const boardsByFolder = new Map<string, Board[]>();
  const unfiled: Board[] = [];
  for (const b of boards) {
    if (b.folder_id) {
      const list = boardsByFolder.get(b.folder_id) || [];
      list.push(b);
      boardsByFolder.set(b.folder_id, list);
    } else {
      unfiled.push(b);
    }
  }

  return (
    <div>
      <div className="page-actions">
        <input
          type="text"
          placeholder="New folder name"
          value={folderTitle}
          onChange={(e) => setFolderTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createFolder();
          }}
          className="input"
          style={{ maxWidth: 180 }}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={createFolder}
          disabled={creatingFolder || !folderTitle.trim()}
        >
          {creatingFolder ? "Creating…" : "New folder"}
        </button>
        <input
          type="text"
          placeholder="New board name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createBoard();
          }}
          className="input"
          style={{ maxWidth: 220 }}
        />
        <button
          className="btn btn-sm"
          onClick={createBoard}
          disabled={creating}
        >
          {creating ? "Creating…" : "New board"}
        </button>
      </div>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Team workspace</p>
          <h1 className="h1">Whiteboards</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Shared, live canvases for sketching campaigns, mapping flows, and
            planning together. Everyone on a board sees changes within a couple
            of seconds.
          </p>
        </div>

        {loading ? (
          <p className="muted">Loading boards…</p>
        ) : boards.length === 0 && folders.length === 0 ? (
          <p className="muted">No boards yet. Name one above to get started.</p>
        ) : (
          <div className="stack" style={{ gap: 28 }}>
            {folders.map((folder) => {
              const list = boardsByFolder.get(folder.id) || [];
              return (
                <div key={folder.id} className="stack" style={{ gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <h2 className="h2" style={{ margin: 0, fontSize: 15 }}>
                      {folder.title}
                    </h2>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => deleteFolder(folder)}
                    >
                      Delete folder
                    </button>
                  </div>
                  {list.length === 0 ? (
                    <p className="muted" style={{ fontSize: 13 }}>
                      No boards in this folder yet.
                    </p>
                  ) : (
                    list.map((b) => <BoardRow key={b.id} board={b} />)
                  )}
                </div>
              );
            })}

            {(unfiled.length > 0 || folders.length === 0) && (
              <div className="stack" style={{ gap: 8 }}>
                {folders.length > 0 && (
                  <h2 className="h2" style={{ margin: 0, fontSize: 15 }}>
                    Unfiled
                  </h2>
                )}
                {unfiled.map((b) => (
                  <BoardRow key={b.id} board={b} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
