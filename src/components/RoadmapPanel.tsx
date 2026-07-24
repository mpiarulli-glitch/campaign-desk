"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------------------------------------------------------------- types */

type KeyResult = { id: string; description: string; target: number; current: number; unit: string };
type OkrStatus = "on_track" | "at_risk" | "off_track" | "achieved";
type Okr = {
  id: string;
  objective: string;
  keyResults: KeyResult[];
  target_date: string | null;
  status: OkrStatus;
};

type Plan = {
  phases?: { name: string; months?: string; revenue?: string }[];
  rollout?: { phase: string; name: string; desc: string }[];
};
type Strategy = { plan: Plan };

type Phase = { when: string; name: string; desc: string };

const STATUS_LABEL: Record<OkrStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};
// Neon-at-dusk status colors, reused for beacons and the verdict chip.
const STATUS_COLOR: Record<OkrStatus, string> = {
  on_track: "#34d399",
  at_risk: "#fbbf24",
  off_track: "#f87171",
  achieved: "#38bdf8",
};
// Fallback progress when a goal has no measurable key results.
const STATUS_PROGRESS: Record<OkrStatus, number> = {
  on_track: 0.6,
  at_risk: 0.35,
  off_track: 0.12,
  achieved: 1,
};

/* --------------------------------------------------------- deterministic rng */
// Seeded so a client's skyline is stable across renders (no hydration drift).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- geometry */
const VW = 1200;
const VH = 470;
const PAD = 44;
const GROUND = 360; // city baseline
const PLOT = VW - PAD * 2;

function okrProgress(o: Okr): number {
  const measured = o.keyResults.filter((k) => k.target > 0);
  if (measured.length === 0) return STATUS_PROGRESS[o.status];
  const avg =
    measured.reduce((s, k) => s + Math.min(1, Math.max(0, k.current / k.target)), 0) / measured.length;
  return o.status === "achieved" ? 1 : avg;
}

/* ------------------------------------------------------------ one building */
function Building({ x, slotW, index, total, lit }: { x: number; slotW: number; index: number; total: number; lit: boolean }) {
  const rng = mulberry32(index * 2654435761 + 7);
  const bw = Math.min(slotW * 0.66, 128);
  const cx = x + slotW / 2;
  const bx = cx - bw / 2;
  // Height trends upward across the timeline (growth "up and to the right").
  const trend = total > 1 ? index / (total - 1) : 0.6;
  const hFrac = Math.min(1, Math.max(0.34, 0.5 + trend * 0.42 + (rng() - 0.5) * 0.16));
  const maxH = 252;
  const bodyH = 92 + hFrac * (maxH - 92);
  const topY = GROUND - bodyH;
  const style = index % 5;

  const body = `${bx.toFixed(1)},${GROUND} ${bx.toFixed(1)},${topY.toFixed(1)}`;
  const bodyFill = `url(#bldg${lit ? "Lit" : "Dim"})`;
  const els: React.ReactNode[] = [];

  // window grid
  const cols = Math.max(2, Math.floor(bw / 15));
  const marginX = 6;
  const winW = (bw - marginX * 2) / cols - 3;
  const rowH = 13;
  const rows = Math.max(3, Math.floor((bodyH - 22) / rowH));
  const litWarm = ["#ffd27a", "#ffc25c", "#ffb347"];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rng() < (lit ? 0.56 : 0.1);
      const cool = on && rng() < 0.12;
      els.push(
        <rect
          key={`w${r}-${c}`}
          x={bx + marginX + c * (winW + 3)}
          y={topY + 12 + r * rowH}
          width={winW}
          height={7}
          rx={1}
          fill={on ? (cool ? "#a9d5ff" : litWarm[Math.floor(rng() * 3)]) : "rgba(255,255,255,0.05)"}
          opacity={on ? (lit ? 0.95 : 0.6) : 1}
        />
      );
    }
  }

  // roof treatments — a varied, recognizably-Manhattan set
  const roof: React.ReactNode[] = [];
  if (style === 1) {
    // spire (Empire State / Chrysler)
    roof.push(<polygon key="sp" points={`${cx - bw * 0.18},${topY} ${cx + bw * 0.18},${topY} ${cx},${topY - 34}`} fill="#151b2e" />);
    roof.push(<line key="mast" x1={cx} y1={topY - 34} x2={cx} y2={topY - 58} stroke="#2b3552" strokeWidth={2} />);
    roof.push(<circle key="beacon" cx={cx} cy={topY - 60} r={2.6} fill="#ff5a5a" filter="url(#glow)" />);
  } else if (style === 2) {
    // stepped setbacks
    roof.push(<rect key="s1" x={bx + bw * 0.16} y={topY - 16} width={bw * 0.68} height={16} fill={bodyFill} />);
    roof.push(<rect key="s2" x={bx + bw * 0.32} y={topY - 30} width={bw * 0.36} height={16} fill={bodyFill} />);
    roof.push(<line key="ant" x1={cx} y1={topY - 30} x2={cx} y2={topY - 48} stroke="#2b3552" strokeWidth={1.5} />);
  } else if (style === 3) {
    // water tower on a flat roof
    roof.push(<rect key="wt-leg" x={bx + bw * 0.5 - 9} y={topY - 8} width={18} height={8} fill="#0d1220" />);
    roof.push(<rect key="wt" x={bx + bw * 0.5 - 11} y={topY - 22} width={22} height={14} rx={1} fill="#1a1310" />);
    roof.push(<polygon key="wt-top" points={`${cx - 12},${topY - 22} ${cx + 12},${topY - 22} ${cx},${topY - 30}`} fill="#241a14" />);
  } else if (style === 4) {
    // tapered modern crown (One WTC-ish)
    roof.push(<polygon key="tp" points={`${bx},${topY} ${bx + bw},${topY} ${cx + bw * 0.22},${topY - 26} ${cx - bw * 0.22},${topY - 26}`} fill={bodyFill} />);
    roof.push(<line key="tp-m" x1={cx} y1={topY - 26} x2={cx} y2={topY - 52} stroke="#2b3552" strokeWidth={2} />);
    roof.push(<circle key="tp-b" cx={cx} cy={topY - 53} r={2.2} fill="#ff5a5a" filter="url(#glow)" />);
  } else {
    // flat parapet + antenna
    roof.push(<rect key="par" x={bx} y={topY - 4} width={bw} height={4} fill="#0d1220" />);
    roof.push(<line key="a1" x1={bx + bw * 0.3} y1={topY} x2={bx + bw * 0.3} y2={topY - 14} stroke="#2b3552" strokeWidth={1.2} />);
  }

  // reflection in the water: mirrored, fading, with warm shimmer streaks
  const reflH = Math.min(74, bodyH * 0.4);
  const refl: React.ReactNode[] = [
    <rect key="refl" x={bx} y={GROUND} width={bw} height={reflH} fill="url(#reflFade)" opacity={0.5} />,
  ];
  if (lit) {
    for (let i = 0; i < 3; i++) {
      const sx = bx + marginX + Math.floor(rng() * cols) * (winW + 3) + winW / 2;
      refl.push(<rect key={`rs${i}`} x={sx - 1} y={GROUND} width={2} height={reflH * (0.5 + rng() * 0.5)} fill="#ffc25c" opacity={0.16} />);
    }
  }

  return (
    <g>
      {refl}
      <rect x={bx} y={topY} width={bw} height={bodyH} fill={bodyFill} />
      {/* rim light on the sky-facing edge */}
      <line x1={bx} y1={topY} x2={bx} y2={GROUND} stroke="rgba(150,180,255,0.18)" strokeWidth={1} />
      <polyline points={body} fill="none" />
      {roof}
      {els}
    </g>
  );
}

/* --------------------------------------------------------- progress ring */
function Ring({ value, color, size = 40 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="rmap-ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="rmap-ring-num">
        {Math.round(value * 100)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ panel */
export function RoadmapPanel({
  clientId,
  okrs,
  onManageGoals,
  onOpenStrategy,
  previewPlan,
}: {
  clientId: string;
  okrs: Okr[];
  onManageGoals?: () => void;
  onOpenStrategy?: () => void;
  previewPlan?: Plan; // bypasses the fetch — used for previews and tests
}) {
  const [plan, setPlan] = useState<Plan | null>(previewPlan ?? null);

  const load = useCallback(async () => {
    if (previewPlan) return;
    const res = await fetch(`/api/clients/${clientId}/strategy`);
    if (res.ok) setPlan(((await res.json()).strategy as Strategy).plan || {});
  }, [clientId, previewPlan]);
  useEffect(() => { load(); }, [load]);

  const phases: Phase[] = useMemo(() => {
    if (!plan) return [];
    if (plan.rollout?.length) return plan.rollout.map((r) => ({ when: r.phase, name: r.name, desc: r.desc }));
    if (plan.phases?.length) return plan.phases.map((p) => ({ when: p.months || "", name: p.name, desc: p.revenue ? `${p.revenue}/mo` : "" }));
    return [];
  }, [plan]);

  const overall = useMemo(
    () => (okrs.length ? okrs.reduce((s, o) => s + okrProgress(o), 0) / okrs.length : 0),
    [okrs]
  );

  const verdict: { status: OkrStatus; label: string } = useMemo(() => {
    if (!okrs.length) return { status: "on_track", label: "No goals yet" };
    if (okrs.some((o) => o.status === "off_track")) return { status: "off_track", label: "Off track" };
    if (okrs.some((o) => o.status === "at_risk")) return { status: "at_risk", label: "At risk" };
    if (okrs.every((o) => o.status === "achieved")) return { status: "achieved", label: "Goals achieved" };
    return { status: "on_track", label: "On track" };
  }, [okrs]);

  // seeded backdrop
  const rng = useMemo(() => mulberry32(97), []);
  const stars = useMemo(() => {
    const r = mulberry32(31);
    return Array.from({ length: 52 }, () => ({ x: r() * VW, y: r() * 250, s: 0.4 + r() * 1.2, o: 0.25 + r() * 0.6 }));
  }, []);
  const distant = useMemo(() => {
    const r = mulberry32(53);
    const out: { x: number; w: number; h: number }[] = [];
    let x = 0;
    while (x < VW) {
      const w = 26 + r() * 40;
      out.push({ x, w, h: 26 + r() * 66 });
      x += w + 2;
    }
    return out;
  }, []);

  if (!plan) return <p className="muted">Loading…</p>;

  if (phases.length === 0) {
    return (
      <div className="rmap-empty">
        <div className="rmap-empty-city" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <h3>No roadmap to build yet</h3>
        <p>The roadmap turns this client&apos;s strategy rollout into a timeline. Add a rollout in the strategy first.</p>
        {onOpenStrategy ? <button className="btn btn-sm" onClick={onOpenStrategy}>Open strategy</button> : null}
      </div>
    );
  }

  const n = phases.length;
  const slotW = PLOT / n;
  const nowX = PAD + overall * PLOT;
  const nowSlot = Math.min(n - 1, Math.floor(overall * n));

  return (
    <div className="rmap">
      {/* Hero */}
      <div className="rmap-hero">
        <p className="rmap-eyebrow">Roadmap</p>
        <div className="rmap-hero-row">
          <h1 className="rmap-title">The road ahead</h1>
          <span className={`rmap-verdict s-${verdict.status}`}>
            <span className="dot" />{verdict.label}
          </span>
        </div>
        <p className="rmap-lead">
          <b>{n}</b> phase{n === 1 ? "" : "s"} mapped across the build.
          {okrs.length ? <> You&apos;re <b>{Math.round(overall * 100)}%</b> of the way to <b>{okrs.length}</b> goal{okrs.length === 1 ? "" : "s"}.</> : <> Add goals to track progress against the plan.</>}
        </p>
      </div>

      {/* The skyline */}
      <div className="rmap-scene">
        <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" role="img" aria-label={`Growth roadmap skyline with ${n} phases`}>
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#070b24" />
              <stop offset="32%" stopColor="#1b1f4a" />
              <stop offset="56%" stopColor="#472e63" />
              <stop offset="76%" stopColor="#9c4f5e" />
              <stop offset="90%" stopColor="#d9713f" />
              <stop offset="100%" stopColor="#f3a95e" />
            </linearGradient>
            <radialGradient id="horizon" cx="76%" cy="100%" r="70%">
              <stop offset="0%" stopColor="#ffb15a" stopOpacity="0.7" />
              <stop offset="45%" stopColor="#ff9d4d" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#ff9d4d" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fdf4d6" stopOpacity="0.9" />
              <stop offset="35%" stopColor="#fdf4d6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#fdf4d6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bldgLit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#26304d" />
              <stop offset="55%" stopColor="#161d31" />
              <stop offset="100%" stopColor="#0b1120" />
            </linearGradient>
            <linearGradient id="bldgDim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#141a2c" />
              <stop offset="100%" stopColor="#0a0f1b" />
            </linearGradient>
            <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a1836" />
              <stop offset="100%" stopColor="#0a0a1c" />
            </linearGradient>
            <linearGradient id="reflFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#26304d" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#26304d" stopOpacity="0" />
            </linearGradient>
            <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* sky + atmosphere */}
          <rect x="0" y="0" width={VW} height={GROUND} fill="url(#sky)" />
          <rect x="0" y="0" width={VW} height={GROUND} fill="url(#horizon)" />
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#eef2ff" opacity={s.o} />
          ))}
          <circle cx={VW * 0.16} cy={74} r={70} fill="url(#moonGlow)" />
          <circle cx={VW * 0.16} cy={74} r={24} fill="#fdf4d6" />
          <ellipse cx={VW * 0.4} cy={120} rx={110} ry={12} fill="#2a2550" opacity={0.35} />
          <ellipse cx={VW * 0.7} cy={90} rx={80} ry={9} fill="#7a4258" opacity={0.28} />

          {/* distant skyline for depth */}
          <g opacity={0.55}>
            {distant.map((d, i) => (
              <g key={i}>
                <rect x={d.x} y={GROUND - d.h} width={d.w} height={d.h} fill="#0f1436" />
                {rng() < 0.6 ? <rect x={d.x + d.w * 0.4} y={GROUND - d.h + 6} width={2} height={2} fill="#ffcf6e" opacity={0.5} /> : null}
              </g>
            ))}
          </g>

          {/* water */}
          <rect x="0" y={GROUND} width={VW} height={VH - GROUND} fill="url(#water)" />

          {/* foreground buildings = phases */}
          {phases.map((_, i) => (
            <Building key={i} x={PAD + slotW * i} slotW={slotW} index={i} total={n} lit={i <= nowSlot || okrs.length === 0} />
          ))}

          {/* promenade line */}
          <line x1="0" y1={GROUND} x2={VW} y2={GROUND} stroke="rgba(180,200,255,0.14)" strokeWidth={1} />
          {/* water ripples */}
          {[12, 26, 42, 60, 82].map((dy, i) => (
            <line key={i} x1="0" y1={GROUND + dy} x2={VW} y2={GROUND + dy} stroke="rgba(120,140,200,0.06)" strokeWidth={1} />
          ))}

          {/* NOW beam — driven by goal progress */}
          {okrs.length ? (
            <g>
              <line x1={nowX} y1={92} x2={nowX} y2={GROUND} stroke="#fff3d6" strokeWidth={6} opacity={0.12} filter="url(#glow)" />
              <line x1={nowX} y1={92} x2={nowX} y2={GROUND} stroke="#ffe9b0" strokeWidth={1.5} opacity={0.8} strokeDasharray="4 5" />
              <circle cx={nowX} cy={GROUND} r={4} fill="#ffe9b0" filter="url(#glow)" />
              <g transform={`translate(${Math.max(48, Math.min(nowX, VW - 48))}, 80)`}>
                <rect x={-46} y={-15} width={92} height={21} rx={6} fill="#ffe9b0" />
                <polygon points="-6,6 6,6 0,12" fill="#ffe9b0" />
                <text x={0} y={-1} textAnchor="middle" className="rmap-now-tag">YOU ARE HERE</text>
              </g>
            </g>
          ) : null}
        </svg>

        {/* timeline axis aligned to building slots */}
        <div className="rmap-axis" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {phases.map((p, i) => (
            <div key={i} className={`rmap-axis-col ${okrs.length && i === nowSlot ? "is-now" : ""}`}>
              <span className="rmap-tick" />
              {p.when ? <span className="rmap-when">{p.when}</span> : null}
              <span className="rmap-phase">{p.name}</span>
              {p.desc ? <span className="rmap-phase-desc">{p.desc}</span> : null}
            </div>
          ))}
        </div>
      </div>

      {/* OKR tracker */}
      <div className="rmap-okr-head">
        <h2 className="rmap-sec-title">Are we tracking?</h2>
        {onManageGoals ? <button className="btn btn-ghost btn-sm" onClick={onManageGoals}>Manage goals</button> : null}
      </div>
      {okrs.length === 0 ? (
        <div className="empty"><p>No goals set yet. Add OKRs so the roadmap can tell you if you&apos;re on pace.</p></div>
      ) : (
        <div className="rmap-okr-grid">
          {okrs.map((o) => {
            const p = okrProgress(o);
            const color = STATUS_COLOR[o.status];
            return (
              <div key={o.id} className="rmap-okr-card" style={{ ["--s" as string]: color }}>
                <div className="rmap-okr-top">
                  <Ring value={p} color={color} />
                  <div className="rmap-okr-meta">
                    <p className="rmap-okr-obj">{o.objective}</p>
                    <span className="rmap-okr-status"><span className="d" />{STATUS_LABEL[o.status]}
                      {o.target_date ? <span className="rmap-okr-date"> · by {o.target_date}</span> : null}
                    </span>
                  </div>
                </div>
                {o.keyResults.length ? (
                  <div className="rmap-kr-list">
                    {o.keyResults.map((kr) => {
                      const kp = kr.target ? Math.min(1, kr.current / kr.target) : 0;
                      return (
                        <div key={kr.id} className="rmap-kr">
                          <span className="rmap-kr-desc">{kr.description}</span>
                          <div className="rmap-kr-track"><div className="rmap-kr-fill" style={{ width: `${kp * 100}%`, background: color }} /></div>
                          <span className="rmap-kr-num">{kr.current}{kr.unit} / {kr.target}{kr.unit}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rmap-okr-nokr">No key results yet.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
