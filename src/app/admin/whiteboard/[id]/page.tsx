"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WhiteboardCanvas } from "@/components/WhiteboardCanvas";

export default function WhiteboardBoardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [title, setTitle] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading"
  );

  useEffect(() => {
    if (!id) return;
    fetch(`/api/whiteboard/${id}`)
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        if (r.status === 404) {
          setState("missing");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d?.board) {
          setTitle(d.board.title);
          setState("ready");
        }
      });
  }, [id, router]);

  if (state === "missing") {
    return (
      <div className="page-hero">
        <h1 className="h1">Board not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          <Link href="/admin/whiteboard">Back to whiteboards</Link>
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="page-actions"
        style={{ display: "flex", alignItems: "center", gap: 12 }}
      >
        <Link className="btn btn-ghost btn-sm" href="/admin/whiteboard">
          ← Boards
        </Link>
        <span style={{ fontWeight: 600 }}>{title || "Whiteboard"}</span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {state === "ready" ? <WhiteboardCanvas boardId={id} /> : null}
      </div>
    </div>
  );
}
