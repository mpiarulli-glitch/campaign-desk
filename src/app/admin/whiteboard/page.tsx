"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Board = {
  id: string;
  title: string;
  created_by: string;
  updated_at: string;
};

export default function WhiteboardListPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    fetch("/api/whiteboard")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) setBoards(d.boards);
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

  return (
    <div>
      <div className="page-actions">
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

      <div className="page-hero">
        <p className="eyebrow">Team workspace</p>
        <h1 className="h1">Whiteboards</h1>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
          Shared, live canvases for sketching campaigns, mapping flows, and
          planning together. Everyone on a board sees changes within a couple of
          seconds.
        </p>
      </div>

      {loading ? (
        <p className="muted">Loading boards…</p>
      ) : boards.length === 0 ? (
        <p className="muted">No boards yet. Name one above to get started.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/admin/whiteboard/${b.id}`}
              className="campaign-item"
            >
              <span style={{ fontWeight: 600 }}>{b.title}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {b.created_by ? `by ${b.created_by}` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
