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

// A compact glyph per department, drawn inline so the floor signs stay crisp.
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

const DESKS_PER_FLOOR = 6;

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

  return (
    <div className="tower-wrap">
      {/* Hero */}
      <div className="tower-hero">
        <span className="tower-live"><span className="dot" />LIVE</span>
        <p className="tower-eyebrow">The MEG floor</p>
        <h1 className="tower-title">We&apos;re working on {clientName} right now</h1>
        <div className="tower-stats">
          <div className="tower-stat"><span className="n">{wb.peopleActive}</span><span className="l">teammates on your account</span></div>
          <div className="tower-stat"><span className="n">{wb.activeTotal}</span><span className="l">tasks in progress</span></div>
          <div className="tower-stat"><span className="n">{wb.doneRecent}</span><span className="l">shipped in the last 24h</span></div>
        </div>
      </div>

      {/* The building */}
      <div className="tower-stage">
        <svg className="tower-sky" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="tw-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#070b24" />
              <stop offset="45%" stopColor="#231a4a" />
              <stop offset="78%" stopColor="#6b3654" />
              <stop offset="100%" stopColor="#c56a3c" />
            </linearGradient>
            <radialGradient id="tw-moon" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fdf4d6" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#fdf4d6" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="1200" height="600" fill="url(#tw-sky)" />
          <circle cx="980" cy="120" r="90" fill="url(#tw-moon)" />
          <circle cx="980" cy="120" r="30" fill="#fdf4d6" opacity="0.95" />
          {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#eaf0ff" opacity={s.o} />)}
          {SKYLINE.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={600 - b.h} width={b.w} height={b.h} fill="#0d1230" opacity="0.85" />
              {b.lit ? <rect x={b.x + b.w * 0.35} y={600 - b.h + 8} width="3" height="3" fill="#ffcf6e" opacity="0.6" /> : null}
            </g>
          ))}
        </svg>

        {floors.length === 0 ? (
          <div className="tower-empty">
            <p>The team hasn&apos;t opened any tasks on your account yet. As soon as work begins, you&apos;ll see it light up here.</p>
          </div>
        ) : (
          <div className="tower">
            <div className="tower-roof">
              <span className="tower-roof-beacon" />
              <span className="tower-roof-sign">MEG</span>
            </div>

            <div className="tower-body">
              <div className="tower-elevator" aria-hidden="true"><span className="tower-car" /></div>

              {floors.map((f) => {
                const shown = f.tasks.slice(0, DESKS_PER_FLOOR);
                const extra = f.tasks.length - shown.length;
                const glow = Math.min(0.42, 0.12 + f.active * 0.08);
                return (
                  <div key={f.key} className={`tf ${f.active > 0 ? "is-busy" : "is-quiet"}`}>
                    <div className="tf-sign">
                      <span className="tf-ico"><DeptIcon k={f.key} /></span>
                      <span className="tf-name">{f.department}</span>
                      <span className="tf-count">{f.active > 0 ? `${f.active} active` : f.done ? "done" : "idle"}</span>
                    </div>
                    <div className="tf-office" style={{ ["--glow" as string]: glow }}>
                      <div className="tf-desks">
                        {shown.map((t) => (
                          <div
                            key={t.id}
                            className={`tf-desk s-${t.status} ${t.priority === "urgent" ? "is-urgent" : ""}`}
                            title={`${t.title} · ${t.assigneeLabel}`}
                          >
                            <span className="tf-screen" />
                            <Avatar label={t.assigneeLabel} src={t.avatar} size={26} />
                            <span className="tf-task">{t.title}</span>
                            <span className="tf-status" aria-label={t.status === "done" ? "Done" : "In progress"}>
                              {t.status === "done" ? "✓" : ""}
                            </span>
                          </div>
                        ))}
                        {extra > 0 ? <div className="tf-more">+{extra} more</div> : null}
                        {shown.length === 0 ? <div className="tf-idle">No open tasks here right now</div> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="tower-lobby">
              <span className="tower-marquee">NOW BUILDING · {clientName.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Live ticker */}
      {wb.recent.length ? (
        <div className="tower-ticker" aria-label="Recent activity">
          <span className="tower-ticker-label">Latest</span>
          <div className="tower-ticker-track">
            {wb.recent.map((r, i) => (
              <span key={i} className="tower-ticker-item">
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
  return Array.from({ length: 60 }, () => ({ x: rnd() * 1200, y: rnd() * 340, r: 0.4 + rnd() * 1.3, o: 0.2 + rnd() * 0.6 }));
})();
const SKYLINE = (() => {
  let a = 991;
  const rnd = () => {
    a = (a * 1103515245 + 12345) >>> 0;
    return a / 4294967296;
  };
  const out: { x: number; w: number; h: number; lit: boolean }[] = [];
  let x = -20;
  while (x < 1200) {
    const w = 40 + rnd() * 70;
    out.push({ x, w, h: 60 + rnd() * 150, lit: rnd() < 0.5 });
    x += w + 6;
  }
  return out;
})();
