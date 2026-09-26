"use client";

import { useEffect, useRef, useState } from "react";

export type LoggedDateRange = { from: string; to: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fmt(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function loggedRangeLabel(from: string, to: string): string {
  if (!from) return "";
  if (!to || to === from) return fmt(from);
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (a && b && a.getFullYear() === b.getFullYear()) {
    const start = a.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${start} – ${fmt(to)}`;
  }
  return `${fmt(from)} – ${fmt(to)}`;
}

function monthGrid(year: number, month: number): Array<{ ymd: string; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  const cells: Array<{ ymd: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ ymd: toYmd(d), inMonth: d.getMonth() === month });
  }
  return cells;
}

function order(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Optional logged date. Click one day for a single date, or drag across days
 * for a range. Clearing it leaves the week’s default filing date alone.
 */
export function LoggedForRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: LoggedDateRange | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ anchor: string; current: string } | null>(null);
  const anchorMonth = parseYmd(from) || new Date();
  const [cursor, setCursor] = useState(() => new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const start = parseYmd(from) || new Date();
    setCursor(new Date(start.getFullYear(), start.getMonth(), 1));
  }, [open, from]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const preview = drag ? order(drag.anchor, drag.current) : from ? order(from, to || from) : null;
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const buttonLabel = from ? loggedRangeLabel(from, to) : "Add dates";

  function dayFromPoint(e: React.PointerEvent): string | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.closest("[data-day]")?.getAttribute("data-day") || null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const day = dayFromPoint(e);
    if (!day) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ anchor: day, current: day });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const day = dayFromPoint(e);
    if (!day || day === drag.current) return;
    setDrag({ anchor: drag.anchor, current: day });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const day = dayFromPoint(e) || drag.current;
    const [start, end] = order(drag.anchor, day);
    setDrag(null);
    onChange({ from: start, to: start === end ? "" : end });
    setOpen(false);
  }

  return (
    <div className="snap-logged-range" ref={wrapRef}>
      <div className="snap-logged-range-bar">
        <button
          type="button"
          className={`snap-logged-range-btn ${from ? "is-set" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={from ? `Logged for ${buttonLabel}` : "Logged for date"}
          onClick={() => setOpen((v) => !v)}
        >
          {buttonLabel}
        </button>
        {from ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm snap-logged-range-clear"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="snap-logged-cal" role="dialog" aria-label="Logged for dates">
          <div className="snap-logged-cal-nav">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Previous month"
              onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <span>{monthLabel}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Next month"
              onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            >
              ›
            </button>
          </div>
          <div className="snap-logged-cal-dow" aria-hidden="true">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
          </div>
          <div
            className="snap-logged-cal-grid"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {cells.map((cell) => {
              const inRange = preview ? cell.ymd >= preview[0] && cell.ymd <= preview[1] : false;
              const edge = preview ? cell.ymd === preview[0] || cell.ymd === preview[1] : false;
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  data-day={cell.ymd}
                  className={`snap-logged-day ${cell.inMonth ? "" : "is-out"} ${inRange ? "is-in" : ""} ${edge ? "is-edge" : ""}`}
                  tabIndex={-1}
                >
                  {Number(cell.ymd.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="snap-logged-cal-hint">Click a day, or drag across days for a range.</p>
        </div>
      ) : null}
    </div>
  );
}
