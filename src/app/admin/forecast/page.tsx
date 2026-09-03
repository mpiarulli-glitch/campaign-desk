"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MoodAvatar, MOOD_LABEL, moodForPct } from "@/components/MoodAvatar";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type PersonSummary = {
  person: string;
  label: string;
  hours: number;
  capacity: number;
  allocationPct: number;
  // Priority is gone from Forecast, so the second bar reports progress instead:
  // how much of the planned week is already ticked off.
  donePct: number;
  taskCount: number;
  doneCount: number;
};

function allocationColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct >= 80) return "var(--success)";
  return "var(--warning)";
}

function allocationLabel(pct: number): string {
  if (pct > 100) return "Over-allocated";
  if (pct >= 80) return "On target";
  return "Under-allocated";
}

type StatusBucket = "over" | "target" | "under";

function bucketFor(pct: number): StatusBucket {
  if (pct > 100) return "over";
  if (pct >= 80) return "target";
  return "under";
}

export default function ForecastDashboardPage() {
  const router = useRouter();
  const [week, setWeek] = useState(currentWeek());
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(w: string) {
    setLoading(true);
    const auth = await fetch("/api/auth");
    if (auth.ok) {
      const session = await auth.json();
      // Only bounce a user-role login to their own week when that is the only
      // forecast they may open. Someone granted a teammate (or everyone) stays
      // on this board so they can click into the other weeks.
      const subjects = session.forecastSubjects;
      const onlyOwn =
        session.role === "forecast" &&
        session.person &&
        Array.isArray(subjects) &&
        subjects.length === 1 &&
        subjects[0]?.slug === session.person;
      if (onlyOwn) {
        router.push(`/admin/forecast/${session.person}?week=${w}`);
        return;
      }
    }
    const res = await fetch(`/api/forecast?week=${w}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPeople(data.people || []);
    setLoading(false);
  }

  useEffect(() => {
    load(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  const totalHours = people.reduce((sum, p) => sum + p.hours, 0);
  const totalCapacity = people.reduce((sum, p) => sum + p.capacity, 0);
  const teamPct = totalCapacity ? Math.round((totalHours / totalCapacity) * 100) : 0;

  const buckets = { over: 0, target: 0, under: 0 };
  for (const p of people) buckets[bucketFor(p.allocationPct)] += 1;
  const teamSize = people.length || 1;
  const bucketPct = (n: number) => Math.round((n / teamSize) * 100);

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow empire-mark">Time to build empires</p>
            <h1 className="ops-title">Weekly forecast</h1>
            <p className="ops-sub">
              What everyone expects to work on this week, against a 40-hour week.
              Click into a name to add or edit tasks.
            </p>
          </div>
          <div className="ops-weeknav">
            <button onClick={() => setWeek((w) => addWeeks(w, -1))} aria-label="Previous week">‹</button>
            <strong>{weekLabel(week)}</strong>
            {loading && people.length > 0 ? <span className="ops-weeknav-busy">Updating…</span> : null}
            <button onClick={() => setWeek((w) => addWeeks(w, 1))} aria-label="Next week">›</button>
            {!isCurrentWeek(week) ? (
              <button className="ops-weeknav-reset" onClick={() => setWeek(currentWeek())}>
                This week
              </button>
            ) : null}
          </div>
        </div>

        {people.length > 0 ? (
          <div className="mood-summary">
            <div className="mood-summary-total">
              <span className="mood-summary-total-pct" style={{ color: allocationColor(teamPct) }}>
                {teamPct}%
              </span>
              <span className="mood-summary-total-label">
                Team forecasted
                <br />
                {totalHours}h / {totalCapacity}h
              </span>
            </div>
            <div className="mood-summary-bar">
              <div
                className="mood-summary-seg"
                style={{ width: `${bucketPct(buckets.target)}%`, background: "var(--success)" }}
              />
              <div
                className="mood-summary-seg"
                style={{ width: `${bucketPct(buckets.under)}%`, background: "var(--warning)" }}
              />
              <div
                className="mood-summary-seg"
                style={{ width: `${bucketPct(buckets.over)}%`, background: "var(--danger)" }}
              />
            </div>
            <div className="mood-summary-legend">
              <span>
                <i style={{ background: "var(--success)" }} /> On target <em>80–100%</em> · {buckets.target} (
                {bucketPct(buckets.target)}%)
              </span>
              <span>
                <i style={{ background: "var(--warning)" }} /> Under-allocated <em>&lt;80%</em> · {buckets.under} (
                {bucketPct(buckets.under)}%)
              </span>
              <span>
                <i style={{ background: "var(--danger)" }} /> Over-allocated <em>&gt;100%</em> · {buckets.over} (
                {bucketPct(buckets.over)}%)
              </span>
            </div>
          </div>
        ) : null}

        <div className="color-legend">
          <div className="color-legend-group">
            <span className="color-legend-group-label">Progress</span>
            <span className="color-legend-item">
              <i className="color-legend-dot" style={{ background: "var(--success)" }} /> Hours done
            </span>
            <span className="color-legend-item">
              <i className="color-legend-dot" style={{ background: "var(--border-strong)" }} /> Still to do
            </span>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading && people.length === 0 ? (
          <p className="muted">Loading...</p>
        ) : !loading && people.length === 0 ? (
          <div className="empty"><p>No forecasted hours for this week yet.</p></div>
        ) : (
          <div className="mood-grid">
            {people.map((p) => {
              const mood = moodForPct(p.allocationPct);
              return (
                <Link
                  key={p.person}
                  href={`/admin/forecast/${p.person}?week=${week}`}
                  className={`mood-card mood-card--${mood}`}
                >
                  <MoodAvatar pct={p.allocationPct} size={64} />
                  <div className="mood-card-body">
                    <div className="mood-card-name">{p.label}</div>
                    <div className="mood-card-mood">{MOOD_LABEL[mood]}</div>
                    <div className="ops-cap-track">
                      <div
                        className="ops-cap-fill"
                        style={{
                          width: `${Math.min(100, p.allocationPct)}%`,
                          background: allocationColor(p.allocationPct),
                        }}
                      />
                    </div>
                    <div className="mood-card-foot">
                      <span style={{ color: allocationColor(p.allocationPct), fontWeight: 700 }}>
                        {p.allocationPct}%
                      </span>
                      <span className="muted">
                        {p.hours}h · {allocationLabel(p.allocationPct)}
                      </span>
                    </div>
                    {p.hours > 0 ? (
                      <div className="mood-card-priority">
                        <div className="mood-card-priority-bar">
                          <span style={{ width: `${p.donePct}%`, background: "var(--success)" }} />
                          <span
                            style={{
                              width: `${100 - p.donePct}%`,
                              background: "var(--border-strong)",
                            }}
                          />
                        </div>
                        <div className="mood-card-priority-legend">
                          <span style={{ color: "var(--success)" }}>{p.donePct}% done</span>
                          <span className="muted">
                            {p.doneCount}/{p.taskCount} tasks
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
