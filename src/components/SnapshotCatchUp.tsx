"use client";

import { useMemo, useState } from "react";
import {
  CATCH_UP_MONTH_CHOICES,
  catchUpFromDate,
  catchUpPeriodLabel,
  catchUpPeriods,
} from "@/lib/snapshot-catchup";
import type { CadenceUnit, DeliverableKind } from "@/lib/db";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function launchLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type Span = "launch" | (typeof CATCH_UP_MONTH_CHOICES)[number];

export function SnapshotCatchUp({
  deliverableId,
  kind,
  cadenceUnit,
  launchDate,
  onDone,
}: {
  deliverableId: string;
  kind: DeliverableKind;
  cadenceUnit: CadenceUnit;
  launchDate: string | null;
  onDone: () => void;
}) {
  const [span, setSpan] = useState<Span>(launchDate ? "launch" : 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ marked: number; skipped: number } | null>(null);

  const today = todayYmd();
  const from = catchUpFromDate(span, today, launchDate);
  const periods = useMemo(
    () =>
      catchUpPeriods({
        kind,
        unit: cadenceUnit,
        fromYmd: from,
        toYmd: today,
        today,
        launchYmd: launchDate,
      }),
    [kind, cadenceUnit, from, today, launchDate]
  );

  if (kind === "one_time") return null;

  const firstLabel = periods[0]
    ? catchUpPeriodLabel(cadenceUnit, periods[0].periodStart)
    : "";
  const lastLabel = periods.length
    ? catchUpPeriodLabel(cadenceUnit, periods[periods.length - 1].periodStart)
    : "";
  const rangeLabel =
    !periods.length ? "" : firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`;
  const noun =
    cadenceUnit === "weekly" ? "weeks" : cadenceUnit === "quarterly" ? "quarters" : "months";

  async function run() {
    if (periods.length === 0) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/snapshot/entry/catch-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverableId, from, to: today }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        marked?: number;
        skipped?: number;
      };
      if (!res.ok) {
        setError(data.error || "Could not catch up.");
        return;
      }
      setResult({ marked: data.marked ?? 0, skipped: data.skipped ?? 0 });
      onDone();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="snap-catchup-panel">
      {!launchDate ? (
        <p className="snap-catchup-need-launch">
          Set the launch date at the top of this page so catch-up starts when the
          account actually went live.
        </p>
      ) : (
        <p className="snap-catchup-need-launch">Won&apos;t go before launch · {launchLabel(launchDate)}</p>
      )}
      <p className="snap-catchup-label">How far back?</p>
      <div className="snap-chip-row" role="radiogroup" aria-label="Months to catch up">
        {launchDate ? (
          <button
            type="button"
            role="radio"
            aria-checked={span === "launch"}
            className={`snap-chip snap-chip-wide ${span === "launch" ? "is-on" : ""}`}
            onClick={() => {
              setSpan("launch");
              setResult(null);
            }}
          >
            Since launch
          </button>
        ) : null}
        {CATCH_UP_MONTH_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={span === n}
            className={`snap-chip ${span === n ? "is-on" : ""}`}
            onClick={() => {
              setSpan(n);
              setResult(null);
            }}
          >
            {n}
          </button>
        ))}
        <span className="snap-chip-unit">months</span>
      </div>
      {periods.length > 0 && periods.length <= 8 ? (
        <div className="snap-catchup-periods">
          {periods.map((p) => (
            <span key={p.periodStart} className="snap-period-chip">
              {catchUpPeriodLabel(cadenceUnit, p.periodStart)}
            </span>
          ))}
        </div>
      ) : periods.length > 8 ? (
        <p className="snap-catchup-range">
          {rangeLabel} · {periods.length} {noun}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Nothing in that range.
        </p>
      )}
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <p className="snap-catchup-ok">
          {result.marked ? `Marked ${result.marked} ${noun} done.` : "Already caught up."}
          {result.skipped ? ` ${result.skipped} were already logged.` : ""}
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || periods.length === 0}
          onClick={() => void run()}
        >
          {busy ? "Saving…" : `Mark ${rangeLabel} done`}
        </button>
      )}
    </div>
  );
}
