"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Board = {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer";
  ownerLabel: string;
  updatedAt: string;
  unseen: boolean;
};

export default function WhiteboardListPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  function load() {
    return fetch("/api/whiteboard").then((res) => {
      if (res.status === 401) {
        router.push("/login");
        return null;
      }
      return res.ok ? res.json() : null;
    });
  }

  useEffect(() => {
    let live = true;
    load().then((data) => {
      if (!live) return;
      if (data?.boards) setBoards(data.boards);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // load closes over router; the list is fetched once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function createBoard() {
    if (creating) return;
    setCreating(true);
    const res = await fetch("/api/whiteboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    setCreating(false);
    if (res.ok) {
      const { board } = await res.json();
      router.push(`/admin/whiteboard/${board.id}`);
    }
  }

  function startRename(board: Board) {
    setConfirming(null);
    setRenaming(board.id);
    setDraft(board.title);
  }

  async function commitRename(board: Board) {
    const title = draft.trim();
    setRenaming(null);
    if (!title || title === board.title) return;
    setBoards((current) =>
      current.map((item) => (item.id === board.id ? { ...item, title } : item))
    );
    await fetch(`/api/whiteboard/${board.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async function remove(board: Board) {
    const res = await fetch(`/api/whiteboard/${board.id}`, { method: "DELETE" });
    if (res.ok) {
      setBoards((current) => current.filter((item) => item.id !== board.id));
      setConfirming(null);
    }
  }

  const mine = boards.filter((board) => board.role === "owner");
  const shared = boards.filter((board) => board.role !== "owner");

  function Row({ board }: { board: Board }) {
    const owner = board.role === "owner";
    return (
      <div className="wb-row" data-testid="wb-row">
        {renaming === board.id ? (
          <input
            className="wb-rename"
            value={draft}
            autoFocus
            aria-label="Board name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitRename(board)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename(board);
              }
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <Link className="wb-row-main" href={`/admin/whiteboard/${board.id}`}>
            <span className="wb-row-title">
              <span>{board.title}</span>
              {board.unseen ? <span className="wb-new">New</span> : null}
              <span className="wb-role">{owner ? "Owner" : board.role === "editor" ? "Editor" : "Viewer"}</span>
            </span>
            {!owner ? <span className="wb-row-meta">From {board.ownerLabel}</span> : null}
          </Link>
        )}
        {owner ? (
          <div className="wb-row-actions">
            {confirming === board.id ? (
              <>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(board)}>
                  Delete board
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => startRename(board)}>
                  Rename
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(board.id)}>
                  Delete
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wb-list">
      <div className="wb-list-bar">
        <div>
          <h1>Whiteboards</h1>
          <p className="wb-note">Private until you share them.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={createBoard} disabled={creating} data-testid="wb-new">
          {creating ? "Creating…" : "New board"}
        </button>
      </div>

      {loading ? (
        <p className="wb-empty">Loading boards…</p>
      ) : (
        <>
          <section className="wb-section" aria-label="Your boards">
            <h2>Yours</h2>
            {mine.length === 0 ? (
              <p className="wb-empty">No boards yet.</p>
            ) : (
              mine.map((board) => <Row key={board.id} board={board} />)
            )}
          </section>
          {shared.length > 0 ? (
            <section className="wb-section" aria-label="Boards shared with you">
              <h2>Shared with you</h2>
              {shared.map((board) => (
                <Row key={board.id} board={board} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
