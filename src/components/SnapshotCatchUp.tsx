"use client";

import { useMemo, useState } from "react";
import {
  CATCH_UP_MONTH_CHOICES,
  catchUpPeriodLabel,
  catchUpPeriods,
  firstDayMonthsBack,
} from "@/lib/snapshot-catchup";
import type { CadenceUnit, DeliverableKind } from "@/lib/db";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SnapshotCatchUp({
  deliverableId,
  kind,
  cadenceUnit,
  onDone,
}: {
  deliverableId: string;
  kind: DeliverableKind;
  cadenceUnit: CadenceUnit;
  onDone: () => void;
}) {
  const [months, setMonths] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ marked: number; skipped: number } | null>(null);

  const today = todayYmd();
  const from = firstDayMonthsBack(months, today);
  const periods = useMemo(
    () =>
      catchUpPeriods({
        kind,
        unit: cadenceUnit,
        fromYmd: from,
        toYmd: today,
        today,
      }),
    [kind, cadenceUnit, from, today]
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
      <p className="snap-catchup-label">How far back?</p>
      <div className="snap-chip-row" role="radiogroup" aria-label="Months to catch up">
        {CATCH_UP_MONTH_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={months === n}
            className={`snap-chip ${months === n ? "is-on" : ""}`}
            onClick={() => {
              setMonths(n);
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
