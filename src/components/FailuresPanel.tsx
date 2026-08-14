"use client";

import { useCallback, useEffect, useState } from "react";

// What the app tried and could not do.
//
// This panel exists because every integration in Campaign Desk fails quietly on
// purpose. A Campfire outage should not cost a client their booking, so the code
// logs and carries on, and for months nobody saw the log. Four scheduling cards
// were rejected by Basecamp, a production notification reached nobody, and the
// app looked healthy throughout.
//
// It hides itself when there is nothing wrong, so it reads as a real alert
// rather than a widget everybody learns to skip.

type Failure = {
  id: string;
  kind: string;
  subject: string;
  detail: string;
  hint: string;
  last_seen_at: string;
  seen_count: number;
};

const KIND_LABEL: Record<string, string> = {
  email: "Email not sent",
  basecamp_card: "Card not created",
  basecamp_card_move: "Card not moved",
  basecamp_comment: "Follow-up not posted",
  basecamp_campfire: "Chat message not posted",
  basecamp_approval: "Approval not posted",
  contact_unresolved: "Nobody to tag",
};

function whenText(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function FailuresPanel() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/failures");
      if (!res.ok) return;
      const body = (await res.json()) as { failures: Failure[] };
      setFailures(body.failures || []);
    } catch {
      // A panel about failures failing to load is not worth a second alert.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function dismiss(id: string) {
    setBusy(id);
    await fetch("/api/failures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy("");
    setFailures((prev) => prev.filter((f) => f.id !== id));
  }

  if (!failures.length) return null;

  return (
    <div className="ops-panel fail-panel">
      <div className="ops-panel-head">
        <h2>
          Didn&apos;t go through
          <span className="fail-count">{failures.length}</span>
        </h2>
      </div>
      <div className="ops-panel-body">
        {failures.map((f) => (
          <div key={f.id} className="fail-item">
            <div className="fail-item-main">
              <p className="ops-item-title">
                {KIND_LABEL[f.kind] || f.kind}
                {f.subject ? `: ${f.subject}` : ""}
                {f.seen_count > 1 ? (
                  <span className="fail-times">{f.seen_count}x</span>
                ) : null}
              </p>
              <p className="ops-item-sub">{f.detail}</p>
              {f.hint ? <p className="fail-hint">{f.hint}</p> : null}
            </div>
            <div className="fail-item-side">
              <span className="fail-when">{whenText(f.last_seen_at)}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => dismiss(f.id)}
                disabled={busy === f.id}
              >
                {busy === f.id ? "…" : "Handled"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
