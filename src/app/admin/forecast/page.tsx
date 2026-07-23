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

export default function ForecastDashboardPage() {
  const router = useRouter();
  const [week, setWeek] = useState(currentWeek());
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(w: string) {
    setLoading(true);
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
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <NavMenu current="/admin/forecast" />
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Team capacity</p>
          <h1 className="h1">Weekly forecast</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            What everyone expects to work on this week, and how allocated the team
            is against a {40}-hour week. Click into a name to add or edit tasks.
          </p>
        </div>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek((w) => addWeeks(w, -1))}>
              ← Prev
            </button>
            <strong>{weekLabel(week)}</strong>
            {!isCurrentWeek(week) ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setWeek(currentWeek())}>
                This week
              </button>
            ) : null}
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek((w) => addWeeks(w, 1))}>
              Next →
            </button>
          </div>
          <span className="muted">
            Team: {totalHours}h / {totalCapacity}h forecasted (
            <strong style={{ color: allocationColor(teamPct) }}>{teamPct}%</strong>)
            {loading ? " · Updating…" : ""}
          </span>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading && people.length === 0 ? (
          <p className="muted">Loading...</p>
        ) : !loading && people.length === 0 ? (
          <div className="empty"><p>No forecasted hours for this week yet.</p></div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Forecasted hours</th>
                  <th>Capacity</th>
                  <th>Allocation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.person}>
                    <td><strong>{p.label}</strong></td>
                    <td>{p.hours}h</td>
                    <td>{p.capacity}h</td>
                    <td>
                      <span style={{ color: allocationColor(p.allocationPct), fontWeight: 600 }}>
                        {p.allocationPct}%
                      </span>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        {allocationLabel(p.allocationPct)}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="btn btn-ghost btn-sm"
                        href={`/admin/forecast/${p.person}?week=${week}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
