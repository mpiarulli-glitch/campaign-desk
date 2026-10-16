"use client";

import {
  useLayoutEffect,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

export type CountKind = "int" | "pct" | "money" | "net";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function formatCount(kind: CountKind, n: number): string {
  if (kind === "pct") return `${n.toFixed(1)}%`;
  if (kind === "money") {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  const rounded = Math.round(n);
  if (kind === "net") {
    const abs = Math.abs(rounded).toLocaleString("en-US");
    if (rounded > 0) return `+${abs}`;
    if (rounded < 0) return `−${abs}`;
    return "0";
  }
  return rounded.toLocaleString("en-US");
}

/**
 * Counts a readout from zero up to `value`. Reduced-motion users get the
 * final figure immediately. The visible glyphs are hidden from assistive
 * tech so the accessible name is the settled number.
 */
export function CountUp({
  value,
  kind,
  replayKey,
}: {
  value: number | null;
  kind: CountKind;
  replayKey: string;
}): ReactNode {
  const settled = value == null ? "—" : formatCount(kind, value);
  const [text, setText] = useState(settled);
  const [counting, setCounting] = useState(false);

  useLayoutEffect(() => {
    if (value == null) {
      setText("—");
      setCounting(false);
      return;
    }
    if (prefersReducedMotion()) {
      setText(formatCount(kind, value));
      setCounting(false);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const duration = 1080;
    setCounting(true);
    setText(formatCount(kind, 0));

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setText(formatCount(kind, value * eased));
        raf = requestAnimationFrame(tick);
        return;
      }
      setText(formatCount(kind, value));
      setCounting(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, kind, replayKey]);

  return (
    <span className={`lh-hud-count${counting ? " is-counting" : ""}`} aria-label={settled}>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

/** Arc-reactor ring. The arc length is the real rate; the outer ticks spin. */
export function RateRing({ value }: { value: number | null }): ReactNode {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  return (
    <svg className="lh-hud-ring" viewBox="0 0 52 52" aria-hidden="true">
      <circle className="lh-hud-ring-orbit" cx="26" cy="26" r="23" />
      <circle className="lh-hud-ring-spin" cx="26" cy="26" r="23" />
      <circle className="lh-hud-ring-track" cx="26" cy="26" r={radius} />
      <circle
        className="lh-hud-ring-value"
        cx="26"
        cy="26"
        r={radius}
        strokeDasharray={`${dash} ${circumference}`}
        style={{ ["--ring-len" as string]: String(circumference) }}
      />
      <circle className="lh-hud-ring-core" cx="26" cy="26" r="2.2" />
    </svg>
  );
}

export function hudTiltHandlers(reduced: boolean): {
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
} {
  if (reduced) return {};
  return {
    onPointerMove(event) {
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty("--tilt-x", `${(-py * 4.5).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(px * 6).toFixed(2)}deg`);
    },
    onPointerLeave(event) {
      event.currentTarget.style.removeProperty("--tilt-x");
      event.currentTarget.style.removeProperty("--tilt-y");
    },
  };
}

export function useHudTilt(): {
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
} {
  const [reduced, setReduced] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return hudTiltHandlers(reduced);
}
