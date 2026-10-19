"use client";

import { useState } from "react";
import type { CombinedSnapshot } from "@/lib/klaviyo-revenue/types";
import { formatCount, formatDay, formatMoney } from "./format";

type Point = CombinedSnapshot["series"][number];

type Row = {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
  format: (value: number) => string;
};

export function TrendChart({
  series,
  currency,
}: {
  series: Point[];
  currency: string | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const rows: Row[] = [
    {
      key: "forms",
      label: "Form fills",
      color: "var(--text)",
      values: series.map((point) => point.formFills),
      format: formatCount,
    },
    {
      key: "bookings",
      label: "Booked",
      color: "var(--accent-ink)",
      values: series.map((point) => point.bookings),
      format: formatCount,
    },
    {
      key: "email",
      label: "Email revenue",
      color: "var(--accent)",
      values: series.map((point) => point.emailRevenue),
      format: (value) => formatMoney(value, currency),
    },
    {
      key: "sms",
      label: "SMS recovered",
      color: "var(--warning)",
      values: series.map((point) => point.smsRecovered),
      format: formatCount,
    },
  ];
  const tracked = rows.filter((row) => row.values.some((value) => value != null));
  if (!series.length || !tracked.length) {
    return <p className="kr-empty-copy">Nothing to chart in this window yet.</p>;
  }

  const hover = active != null ? series[active] : null;

  return (
    <div className="kr-trends">
      <div className="kr-trends-head">
        <h2>Trend</h2>
        {hover ? (
          <p>
            <strong>{formatDay(hover.date)}</strong>
            {tracked.map((row) => {
              const value = row.values[active ?? 0];
              return (
                <span key={row.key}>
                  {row.label} {value == null ? "not tracked" : row.format(value)}
                </span>
              );
            })}
          </p>
        ) : (
          <p>Each row has its own scale. Move across a row to read a day.</p>
        )}
      </div>
      <div
        className="kr-trend-rows"
        onMouseLeave={() => setActive(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          const index = Math.round(ratio * (series.length - 1));
          setActive(Math.max(0, Math.min(series.length - 1, index)));
        }}
      >
        {tracked.map((row) => (
          <Spark key={row.key} row={row} active={active} />
        ))}
      </div>
      <div className="kr-trend-axis">
        <span>{formatDay(series[0].date)}</span>
        {series.length > 2 ? <span>{formatDay(series[Math.floor(series.length / 2)].date)}</span> : <span />}
        <span>{formatDay(series[series.length - 1].date)}</span>
      </div>
      <details className="kr-daily">
        <summary>Daily numbers</summary>
        <div className="kr-table-wrap">
          <table className="kr-table">
            <caption className="sr-only">Daily form fills, bookings, email revenue, and SMS recoveries</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {tracked.map((row) => (
                  <th key={row.key} scope="col">{row.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((point, index) => (
                <tr key={point.date}>
                  <th scope="row">{formatDay(point.date)}</th>
                  {tracked.map((row) => {
                    const value = row.values[index];
                    return <td key={row.key}>{value == null ? "Not tracked" : row.format(value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Spark({ row, active }: { row: Row; active: number | null }) {
  const nums = row.values.map((value) => value ?? 0);
  const max = Math.max(...nums, 1);
  const width = 640;
  const height = 48;
  const step = nums.length > 1 ? width / (nums.length - 1) : 0;
  const coords = nums.map((value, index) => {
    const x = nums.length === 1 ? width / 2 : index * step;
    const y = height - 4 - ((height - 8) * value) / max;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const total = row.values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const allMissing = row.values.every((value) => value == null);
  return (
    <div className="kr-spark">
      <div className="kr-spark-label">
        <span style={{ background: row.color }} />
        {row.label}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${row.label} over the selected dates`}>
        <path d={line} fill="none" stroke={row.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {active != null && nums.length > 0 ? (
          <circle
            cx={nums.length === 1 ? width / 2 : active * step}
            cy={height - 4 - ((height - 8) * nums[active]) / max}
            r="4.5"
            fill={row.color}
          />
        ) : null}
      </svg>
      <strong>{allMissing ? "—" : row.format(total)}</strong>
    </div>
  );
}
