"use client";

import { useEffect, useState } from "react";
import type { Sequence, SequenceStep } from "./types";

/** Skylead stores delays in ms. Show them the way a human would say them. */
function delayLabel(ms: number): string {
  if (!ms) return "immediately";
  const hours = ms / 3_600_000;
  if (hours < 1) return `after ${Math.round(ms / 60_000)} min`;
  if (hours < 48) return `after ${Math.round(hours)}h`;
  return `after ${Math.round(hours / 24)}d`;
}

const ACTION_LABEL: Record<string, string> = {
  view: "View profile",
  connect: "Connect request",
  message: "Message",
  condition: "Wait for condition",
  email: "Email",
  inmail: "InMail",
  follow: "Follow",
  like: "Like post",
  endorse: "Endorse",
};

/**
 * A step's own conversion. Connect steps convert on acceptance, message steps
 * on reply, and structural steps (view, condition) don't convert at all.
 */
function stepOutcome(s: SequenceStep): { rate: number; sent: number; got: number; label: string } | null {
  if (s.requestsSent > 0) {
    return { rate: s.acceptanceRate, sent: s.requestsSent, got: s.accepted, label: "accepted" };
  }
  if (s.messagesSent > 0) {
    return { rate: s.responseRate, sent: s.messagesSent, got: s.replies, label: "replied" };
  }
  return null;
}

export function SequenceView({ campaignId }: { campaignId: number }) {
  const [seq, setSeq] = useState<Sequence | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/lifecycle/campaigns/${campaignId}/sequence`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) setError(body.error || "Could not load the sequence.");
        else setSeq(body.sequence);
      })
      .catch(() => live && setError("Could not load the sequence."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (loading) return <p className="hud-empty">Reading sequence…</p>;
  if (error) return <p className="hud-err">{error}</p>;
  if (!seq || seq.steps.length === 0) return <p className="hud-empty">No steps on this campaign.</p>;

  // The weakest converting step is the one worth rewriting. Only steps with
  // real volume behind them are eligible, so a step that sent twice doesn't
  // win on a 0% rate.
  const scored = seq.steps
    .map((s) => ({ s, o: stepOutcome(s) }))
    .filter((x) => x.o && x.o.sent >= 20);
  const weakest = scored.length
    ? scored.reduce((lo, x) => (x.o!.rate < lo.o!.rate ? x : lo)).s.id
    : null;

  return (
    <div className="hud-seq">
      {seq.steps.map((s) => {
        const o = stepOutcome(s);
        const isWeak = s.id === weakest;
        return (
          <div key={s.id} className={`hud-step ${isWeak ? "weak" : ""}`}>
            <div className="hud-step-rail">
              <span className="hud-step-num hud-num">{String(s.step).padStart(2, "0")}</span>
            </div>

            <div className="hud-step-body">
              <div className="hud-step-head">
                <span className="hud-step-action">
                  {ACTION_LABEL[s.action] ?? s.action}
                </span>
                <span className="hud-step-delay">{delayLabel(s.delayMs)}</span>
                {o ? (
                  <span
                    className={`hud-chip ${
                      isWeak ? "hud-chip-crit" : o.rate >= 20 ? "hud-chip-ok" : "hud-chip-warn"
                    }`}
                  >
                    {o.rate.toFixed(1)}% {o.label}
                  </span>
                ) : null}
              </div>

              {o ? (
                <div className="hud-step-meta">
                  {o.sent.toLocaleString()} sent · {o.got.toLocaleString()} {o.label}
                  {isWeak ? " · weakest step in this sequence" : ""}
                </div>
              ) : null}

              {s.subject ? <div className="hud-step-subject">{s.subject}</div> : null}
              {s.copy ? <p className="hud-step-copy">{s.copy}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
