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
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return v.toLocaleString("en-US");
}

function Chart({ s }: { s: MetricSeries }) {
  const pts = s.points;
  const max = Math.max(...pts.map((p) => p.value), 1);
  const latest = pts.length ? pts[pts.length - 1].value : 0;
  const prev = pts.length > 1 ? pts[pts.length - 2].value : null;
  const delta = prev !== null && prev !== 0 ? ((latest - prev) / Math.abs(prev)) * 100 : null;
  const H = 96;

  return (
    <div className="perf-card">
      <div className="perf-head">
        <span className="perf-metric">{s.metric}</span>
        <span className="perf-latest">{fmt(latest, s.unit)}</span>
      </div>
      {delta !== null ? (
        <span className={`perf-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs prior
        </span>
      ) : (
        <span className="perf-delta neutral">&nbsp;</span>
      )}
      <div className="perf-bars" style={{ height: H }}>
        {pts.map((p, i) => {
          const h = Math.max(3, (p.value / max) * (H - 18));
          const isLast = i === pts.length - 1;
          return (
            <div key={p.period} className="perf-bar-col" title={`${periodLabel(p.period)}: ${fmt(p.value, s.unit)}`}>
              <div className={`perf-bar ${isLast ? "is-last" : ""}`} style={{ height: h }} />
              <span className="perf-bar-label">{periodLabel(p.period)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PerfCharts({ series }: { series: MetricSeries[] }) {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) return null;
  return (
    <div className="perf-grid">
      {withData.map((s) => (
        <Chart key={s.metric} s={s} />
      ))}
    </div>
  );
}
