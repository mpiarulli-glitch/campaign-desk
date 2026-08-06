"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";

type Data = { name: string; contactName: string; strategyMeetingAt: string | null };

const TIME_SLOTS = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

function slotLabel(hhmm: string): string {
  const h = Number(hhmm.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StrategyMeetingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/strategy-meeting/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setData(d);
        if (d.strategyMeetingAt) setBooked(d.strategyMeetingAt);
      })
      .catch(() => setNotFound(true));
  }, [token]);

  async function submit() {
    if (!date || !time) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/strategy-meeting/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not book that slot.");
      return;
    }
    const d = await res.json();
    setBooked(d.strategyMeetingAt);
  }

  return (
    <div className="app-shell client-light">
      <header className="topbar">
        <Brand href="/" />
      </header>
      <main className="container stack sched-main">
        {notFound ? (
          <div className="sched-notice">
            <h1 className="h1">Link not found</h1>
            <p className="muted">This scheduling link isn&apos;t valid anymore.</p>
          </div>
        ) : !data ? (
          <p className="muted">Loading...</p>
        ) : booked ? (
          <div className="sched-confirmed">
            <div className="sched-confirmed-check">✓</div>
            <h1 className="h1">You&apos;re booked</h1>
            <p className="sched-confirmed-when">{booked}</p>
            <p className="muted">We&apos;ll see you then.</p>
          </div>
        ) : (
          <div className="stack" style={{ maxWidth: 420 }}>
            <div className="sched-hero">
              <p className="eyebrow">{data.name}</p>
              <h1 className="h1">Let&apos;s schedule your strategy review</h1>
              <p className="sched-sub">
                Pick a day and time that works. We&apos;ll confirm right away.
              </p>
            </div>
            <div className="rev-form-grid">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  min={today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Time</label>
                <select
                  className="select-clean"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                >
                  <option value="">Select one</option>
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabel(slot)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error ? <p className="error">{error}</p> : null}
            <button className="btn" disabled={saving || !date || !time} onClick={submit}>
              {saving ? "Booking..." : "Book my meeting"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
