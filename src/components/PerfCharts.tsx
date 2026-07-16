"use client";

export type MetricSeries = {
  metric: string;
  unit: string;
  points: { period: string; value: number }[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function periodLabel(p: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return MONTHS[Number(m[2]) - 1] || p;
  return p;
}

function fmt(v: number, unit: string): string {
  if (unit === "$") {
    if (Math.abs(v) >= 1000) return "$" + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + "k";
  return v.toLocaleString("en-US");
}

// Build smooth-ish area + line paths from values across a fixed viewBox.
function paths(values: number[], W: number, H: number, pad: number) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return { line, area, last: pts[pts.length - 1] };
}

function Chart({ s, idx }: { s: MetricSeries; idx: number }) {
  const values = s.points.map((p) => p.value);
  const latest = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const delta = first !== 0 ? ((latest - first) / Math.abs(first)) * 100 : null;
  const W = 260, H = 68, pad = 6;
  const { line, area, last } = paths(values, W, H, pad);
  const gid = `perfgrad-${idx}`;

  return (
    <div className="perf-card">
      <div className="perf-head">
        <span className="perf-metric">{s.metric}</span>
        {delta !== null ? (
          <span className={`perf-delta ${delta >= 0 ? "up" : "down"}`}>
            {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}%
          </span>
        ) : null}
      </div>
      <div className="perf-value">{fmt(latest, s.unit)}</div>
      <svg className="perf-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--accent-ink)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {last ? <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--accent-ink)" /> : null}
      </svg>
      <div className="perf-range">
        <span>{periodLabel(s.points[0]?.period ?? "")}</span>
        <span>{periodLabel(s.points[s.points.length - 1]?.period ?? "")}</span>
      </div>
    </div>
  );
}

export function PerfCharts({ series }: { series: MetricSeries[] }) {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) return null;
  return (
    <div className="perf-grid">
      {withData.map((s, i) => (
        <Chart key={s.metric} s={s} idx={i} />
      ))}
    </div>
  );
}
