"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";

type Task = {
  id: string;
  title: string;
  assignee: string;
  assigneeLabel: string;
  avatar: string | null;
  status: "open" | "done";
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  updatedAt: string;
};
type Floor = { key: string; department: string; active: number; done: number; tasks: Task[] };
export type Workboard = {
  floors: Floor[];
  activeTotal: number;
  doneRecent: number;
  peopleActive: number;
  recent: { department: string; title: string; status: "open" | "done"; assigneeLabel: string; at: string }[];
  updatedAt: string;
};

// A compact glyph per department, drawn inline so the floor plates stay crisp.
const DEPT_ICON: Record<string, React.ReactNode> = {
  strategy: <path d="M3 3v18h18M7 14l3-4 3 3 5-7" />,
  paid: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.2a2.5 2 0 0 1 2.5-1.2c1.5 0 2.5.8 2.5 2s-1 1.8-2.5 2-2.5.8-2.5 2 1 2 2.5 2a2.5 2 0 0 0 2.5-1.2" /></>,
  seo: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  content: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  social: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></>,
  email: <><path d="M3 5h18v14H3z" /><path d="M3 6l9 7 9-7" /></>,
  onboarding: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
};
function DeptIcon({ k }: { k: string }) {
  const key = k.split(":")[0];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {DEPT_ICON[key] || <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h6" /></>}
    </svg>
  );
}

function relTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Desks shown per floor before rolling into "+N". A real floor also shows a
// couple of empty workstations so it reads like an office, not a list.
const DESKS_SHOWN = 5;
const MIN_DESKS = 4;

// A single workstation: monitor, desk surface, chair, and the person at it.
// Occupied+open desks glow warm; done desks settle to a calm green; empty
// desks stay dark so a busy floor reads brighter than a quiet one.
function Desk({ task }: { task: Task | null }) {
  if (!task) {
    return (
      <div className="dk is-empty" aria-hidden="true">
        <span className="dk-monitor" />
        <span className="dk-surface" />
        <span className="dk-chair" />
      </div>
    );
  }
  const cls = `dk s-${task.status} ${task.priority === "urgent" && task.status === "open" ? "is-urgent" : ""}`;
  return (
    <div className={cls} title={`${task.title} · ${task.assigneeLabel}`}>
      <span className="dk-monitor">
        {task.status === "done" ? <span className="dk-check">✓</span> : <span className="dk-code" />}
      </span>
      <span className="dk-person">
        <Avatar label={task.assigneeLabel} src={task.avatar} size={30} />
      </span>
      <span className="dk-surface" />
      <span className="dk-chair" />
      <span className="dk-tip">
        <b>{task.title}</b>
        <i>{task.assigneeLabel}</i>
      </span>
    </div>
  );
}

export function WorkTower({
  token,
  clientName,
  initial,
}: {
  token: string;
  clientName: string;
  initial: Workboard;
}) {
  const [wb, setWb] = useState<Workboard>(initial);
  const [, force] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`/api/dashboard/${token}/workboard`, { cache: "no-store" });
      if (res.ok) setWb((await res.json()).workboard);
    } catch {
      /* keep last good state */
    }
  }, [token]);

  useEffect(() => {
    timer.current = setInterval(poll, 10000);
    const tick = setInterval(() => force((n) => n + 1), 30000); // refresh "x ago" labels
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(tick);
    };
  }, [poll]);

  const floors = wb.floors;
  const stamp = new Date(wb.updatedAt || Date.now()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="floor-wrap">
      {/* Header */}
      <div className="floor-head">
        <div className="floor-head-main">
          <span className="floor-live"><span className="dot" />LIVE</span>
          <p className="floor-eyebrow">The MEG floor</p>
          <h1 className="floor-title">Working on {clientName} right now</h1>
          <p className="floor-sub">A live look at your account team at their desks. Updated {stamp}.</p>
        </div>
        <div className="floor-stats">
          <div className="floor-stat">
            <span className="n">{wb.peopleActive}</span>
            <span className="l">on your account</span>
          </div>
          <div className="floor-stat">
            <span className="n">{wb.activeTotal}</span>
            <span className="l">tasks in motion</span>
          </div>
          <div className="floor-stat">
            <span className="n">{wb.doneRecent}</span>
            <span className="l">shipped today</span>
          </div>
        </div>
      </div>

      {/* The building */}
      <div className="bld-scene">
        <svg className="bld-sky" viewBox="0 0 1200 640" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="bld-sky-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0a1030" />
              <stop offset="42%" stopColor="#1c1f4d" />
              <stop offset="74%" stopColor="#4a2f5e" />
              <stop offset="100%" stopColor="#b8623f" />
            </linearGradient>
            <radialGradient id="bld-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe9c2" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#ffe9c2" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bld-haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c8794f" stopOpacity="0" />
              <stop offset="100%" stopColor="#e0946a" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1200" height="640" fill="url(#bld-sky-g)" />
          <circle cx="250" cy="150" r="120" fill="url(#bld-glow)" />
          <circle cx="250" cy="150" r="34" fill="#fff3d8" opacity="0.95" />
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#eef3ff" opacity={s.o} />
          ))}
          {/* distant skyline with lit windows */}
          {SKYLINE.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={640 - b.h} width={b.w} height={b.h} fill="#0b1030" opacity="0.9" />
              {b.win.map((w, j) => (
                <rect key={j} x={b.x + w.dx} y={640 - b.h + w.dy} width="3.5" height="3.5" fill="#ffcf7e" opacity={w.o} />
              ))}
            </g>
          ))}
          <rect x="0" y="470" width="1200" height="170" fill="url(#bld-haze)" />
        </svg>

        {floors.length === 0 ? (
          <div className="bld-empty">
            <div className="bld-empty-mark">M</div>
            <p>The lights are on and the desks are ready. The moment your team opens work on this account, you&apos;ll watch it happen here.</p>
          </div>
        ) : (
          <div className="bld-frame">
            <div className="bld">
              <div className="bld-crown">
                <span className="bld-beacon" />
                <span className="bld-logo">MEG</span>
                <span className="bld-crown-glass" />
              </div>

              <div className="bld-body">
                <div className="bld-lift" aria-hidden="true">
                  <span className="bld-car" />
                </div>

                {floors.map((f) => {
                  const shown = f.tasks.slice(0, DESKS_SHOWN);
                  const extra = f.tasks.length - shown.length;
                  const pad = Math.max(0, MIN_DESKS - shown.length);
                  const glow = Math.min(0.5, 0.14 + f.active * 0.09);
                  return (
                    <div key={f.key} className={`flr ${f.active > 0 ? "is-busy" : "is-quiet"}`}>
                      <div className="flr-plate">
                        <span className="flr-ico"><DeptIcon k={f.key} /></span>
                        <span className="flr-name">{f.department}</span>
                        <span className="flr-count">
                          {f.active > 0 ? `${f.active} active` : f.done ? "wrapped" : "standing by"}
                        </span>
                      </div>
                      <div className="flr-office" style={{ ["--glow" as string]: glow }}>
                        <span className="flr-ceiling" aria-hidden="true" />
                        <div className="flr-desks">
                          {shown.map((t) => (
                            <Desk key={t.id} task={t} />
                          ))}
                          {Array.from({ length: pad }, (_, i) => (
                            <Desk key={`e${i}`} task={null} />
                          ))}
                        </div>
                        {extra > 0 ? <span className="flr-more">+{extra}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bld-lobby">
                <span className="bld-door" aria-hidden="true" />
                <span className="bld-marquee">NOW BUILDING · {clientName.toUpperCase()}</span>
                <span className="bld-door" aria-hidden="true" />
              </div>
            </div>

            {/* wet-plaza reflection */}
            <div className="bld-reflection" aria-hidden="true">
              <div className="bld bld-mirror">
                <div className="bld-body">
                  {floors.map((f) => {
                    const glow = Math.min(0.5, 0.14 + f.active * 0.09);
                    return (
                      <div key={f.key} className={`flr ${f.active > 0 ? "is-busy" : "is-quiet"}`}>
                        <div className="flr-plate" />
                        <div className="flr-office" style={{ ["--glow" as string]: glow }}>
                          <span className="flr-ceiling" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live ticker */}
      {wb.recent.length ? (
        <div className="floor-ticker" aria-label="Recent activity">
          <span className="floor-ticker-label">Latest</span>
          <div className="floor-ticker-track">
            {wb.recent.map((r, i) => (
              <span key={i} className="floor-ticker-item">
                <span className={`d s-${r.status}`} />
                <b>{r.department}</b> · {r.title}
                <span className="who">{r.assigneeLabel}</span>
                <span className="ago">{relTime(r.at)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* deterministic backdrop (module scope so it never re-rolls on re-render) */
const STARS = (() => {
  let a = 20240724;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  return Array.from({ length: 70 }, () => ({ x: rnd() * 1200, y: rnd() * 360, r: 0.4 + rnd() * 1.2, o: 0.18 + rnd() * 0.55 }));
})();
const SKYLINE = (() => {
  let a = 991;
  const rnd = () => {
    a = (a * 1103515245 + 12345) >>> 0;
    return a / 4294967296;
  };
  const out: { x: number; w: number; h: number; win: { dx: number; dy: number; o: number }[] }[] = [];
  let x = -20;
  while (x < 1200) {
    const w = 42 + rnd() * 74;
    const h = 70 + rnd() * 170;
    const win: { dx: number; dy: number; o: number }[] = [];
    for (let dy = 10; dy < h - 8; dy += 12) {
      for (let dx = 6; dx < w - 6; dx += 11) {
        if (rnd() < 0.45) win.push({ dx, dy, o: 0.3 + rnd() * 0.5 });
      }
    }
    out.push({ x, w, h, win });
    x += w + 7;
  }
  return out;
})();
