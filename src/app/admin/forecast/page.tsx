"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type PersonSummary = {
  person: string;
  label: string;
  hours: number;
  capacity: number;
  allocationPct: number;
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

function initials(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || "?";
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
      if (session.role === "forecast" && session.person) {
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

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/forecast" />
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Team capacity</p>
            <h1 className="ops-title">Weekly forecast</h1>
            <p className="ops-sub">
              What everyone expects to work on this week, against a 40-hour week.
              Click into a name to add or edit tasks.
            </p>
          </div>
          <div className="ops-weeknav">
            <button onClick={() => setWeek((w) => addWeeks(w, -1))} aria-label="Previous week">‹</button>
            <strong>{weekLabel(week)}</strong>
            <button onClick={() => setWeek((w) => addWeeks(w, 1))} aria-label="Next week">›</button>
            {!isCurrentWeek(week) ? (
              <button
                style={{ width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 600 }}
                onClick={() => setWeek(currentWeek())}
              >
                This week
              </button>
            ) : null}
          </div>
        </div>

        <p className="muted" style={{ marginTop: -14, marginBottom: 20, fontSize: 13 }}>
          Team: {totalHours}h / {totalCapacity}h forecasted (
          <strong style={{ color: allocationColor(teamPct) }}>{teamPct}%</strong>)
          {loading ? " · Updating…" : ""}
        </p>

        {error ? <p className="error">{error}</p> : null}

        {loading && people.length === 0 ? (
          <p className="muted">Loading...</p>
        ) : !loading && people.length === 0 ? (
          <div className="empty"><p>No forecasted hours for this week yet.</p></div>
        ) : (
          <div className="ops-panel">
            <div className="ops-cap-list">
              {people.map((p) => (
                <div key={p.person} className="ops-cap-row">
                  <div className="ops-cap-person">
                    <span className="ops-avatar">{initials(p.label)}</span>
                    <span className="ops-cap-name">{p.label}</span>
                  </div>
                  <div className="ops-cap-track">
                    <div
                      className="ops-cap-fill"
                      style={{ width: `${Math.min(100, p.allocationPct)}%`, background: allocationColor(p.allocationPct) }}
                    />
                  </div>
                  <div>
                    <div className="ops-cap-pct" style={{ color: allocationColor(p.allocationPct) }}>
                      {p.allocationPct}%
                    </div>
                    <div className="ops-cap-hrs">{allocationLabel(p.allocationPct)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Link className="btn btn-ghost btn-sm" href={`/admin/forecast/${p.person}?week=${week}`}>
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
