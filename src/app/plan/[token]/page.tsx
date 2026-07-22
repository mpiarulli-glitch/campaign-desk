"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";

type Send = {
  id: string;
  title: string;
  send_date: string;
  send_time: string;
  status: string;
  audience: string;
  purpose: string;
  offer: string;
  subject: string;
  preview_text: string;
  duration: string;
  production_brief: string;
};
type Feedback = { send_id: string; body: string };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Production shoots always carry a non-empty intake brief; editorial content
// (blog/social/email) never does. That's the only signal telling them apart.
function isProduction(s: Pick<Send, "production_brief">): boolean {
  return !!s.production_brief?.trim();
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function monthKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function fmtTime(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  if (Number.isNaN(h)) return "";
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12} ${period}`;
}
function fmtApproved(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function PlanClientPage() {
  const { token } = useParams<{ token: string }>();
  const [name, setName] = useState("");
  const [range, setRange] = useState({ start: "", end: "" });
  const [sends, setSends] = useState<Send[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approving, setApproving] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [detail, setDetail] = useState<Send | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/plan/${token}`);
    if (res.status === 404) { setNotFound(true); setLoading(false); return; }
    if (res.ok) {
      const data = await res.json();
      setName(data.client.name);
      setRange({ start: data.start, end: data.end });
      setSends(data.sends || []);
      setApprovedAt(data.approvedAt || null);
      setApprovedBy(data.approvedBy || null);
      const map: Record<string, string> = {};
      for (const f of (data.feedback || []) as Feedback[]) map[f.send_id] = f.body;
      setNotes(map);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of sends) {
      const key = monthKey(s.send_date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries());
  }, [sends]);

  // Distinct year/month pairs that actually have sends, in date order, so the
  // calendar view can be paged across only the months there's data for.
  const monthsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const s of sends) set.add(s.send_date.slice(0, 7));
    return Array.from(set).sort();
  }, [sends]);

  const [calMonth, setCalMonth] = useState<string>("");
  useEffect(() => {
    if (monthsPresent.length && !monthsPresent.includes(calMonth)) {
      setCalMonth(monthsPresent[0]);
    }
  }, [monthsPresent, calMonth]);

  const calMonthIdx = monthsPresent.indexOf(calMonth);
  const [calYear, calMonthNum] = calMonth
    ? calMonth.split("-").map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of sends) {
      const arr = map.get(s.send_date) || [];
      arr.push(s);
      map.set(s.send_date, arr);
    }
    return map;
  }, [sends]);

  const cells = useMemo(() => {
    if (!calMonth) return [];
    const daysInMonth = new Date(calYear, calMonthNum, 0).getDate();
    const startWeekday = new Date(calYear, calMonthNum - 1, 1).getDay();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [calMonth, calYear, calMonthNum]);

  async function saveNote(sendId: string, body: string) {
    setSavingId(sendId);
    await fetch(`/api/plan/${token}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendId, body }),
    });
    setSavingId(null);
  }

  async function approve() {
    if (!nameInput.trim()) return;
    setApproving(true);
    const res = await fetch(`/api/plan/${token}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput }),
    });
    setApproving(false);
    if (res.ok) {
      const data = await res.json();
      setApprovedAt(data.approvedAt);
      setApprovedBy(data.approvedBy);
      setNameInput("");
    }
  }

  if (notFound) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">This plan link is invalid or has been reset.</p>
        </div>
      </div>
    );
  }

  const noteCount = Object.values(notes).filter((v) => v.trim()).length;
  const today = new Date();
  const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="app-shell snap-client">
      <header className="topbar">
        <Brand />
        <span className="snap-topbar-tag">Editorial calendar</span>
      </header>

      <section className="snap-hero">
        <div className="snap-hero-inner">
          <div className="snap-hero-top">
            <div>
              <p className="snap-hero-eyebrow">Editorial plan for approval</p>
              <h1 className="snap-hero-title">{name || "Editorial calendar"}</h1>
              <p className="snap-hero-sub">
                {range.start && range.end
                  ? `${fmtDate(range.start)} – ${fmtDate(range.end)} · prepared by Marketing Empire Group`
                  : "Prepared by Marketing Empire Group"}
              </p>
            </div>
            {approvedAt ? (
              <div className="plan-approved-badge">
                ✓ Approved{approvedBy ? ` by ${approvedBy}` : ""}
                <span>{fmtApproved(approvedAt)}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <main className="container stack" style={{ gap: 26 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : sends.length === 0 ? (
          <div className="empty"><p>No campaigns planned in this window yet. Check back soon.</p></div>
        ) : (
          <>
            <div className="plan-intro card card-pad">
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                Here is the email plan we have mapped out. Look it over, leave a note on
                anything you want changed, then approve it at the bottom when it looks good.
              </p>
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <div className="view-toggle">
                <button
                  className={`view-toggle-btn ${view === "calendar" ? "is-on" : ""}`}
                  onClick={() => setView("calendar")}
                >
                  Calendar
                </button>
                <button
                  className={`view-toggle-btn ${view === "list" ? "is-on" : ""}`}
                  onClick={() => setView("list")}
                >
                  List
                </button>
              </div>
            </div>

            {view === "calendar" ? (
              <div className="stack" style={{ gap: 12 }}>
                <div className="row" style={{ justifyContent: "center" }}>
                  <div className="cal-nav">
                    <button
                      className="cal-nav-btn"
                      disabled={calMonthIdx <= 0}
                      onClick={() => setCalMonth(monthsPresent[calMonthIdx - 1])}
                      aria-label="Previous month"
                    >
                      ‹
                    </button>
                    <span className="cal-month">
                      {calMonth ? `${MONTHS[calMonthNum - 1]} ${calYear}` : ""}
                    </span>
                    <button
                      className="cal-nav-btn"
                      disabled={calMonthIdx < 0 || calMonthIdx >= monthsPresent.length - 1}
                      onClick={() => setCalMonth(monthsPresent[calMonthIdx + 1])}
                      aria-label="Next month"
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div className="cal-grid-wrap">
                  <div className="cal-grid">
                    {DOW.map((d) => (
                      <div key={d} className="cal-dow">{d}</div>
                    ))}
                    {cells.map((d, i) => {
                      if (d === null) return <div key={`b${i}`} className="cal-cell cal-empty" />;
                      const date = ymd(calYear, calMonthNum - 1, d);
                      const items = byDay.get(date) || [];
                      return (
                        <div
                          key={date}
                          className={`cal-cell ${date === todayYmd ? "cal-today" : ""}`}
                        >
                          <div className="cal-daynum">{d}</div>
                          <div className="cal-events">
                            {items.map((s) => (
                              <button
                                key={s.id}
                                className={`cal-chip chip-${s.status} ${isProduction(s) ? "is-production" : ""} ${notes[s.id]?.trim() ? "has-note" : ""}`}
                                onClick={() => setDetail(s)}
                              >
                                <span className="cal-chip-dot" />
                                <span className="cal-chip-name">
                                  {s.send_time ? `${fmtTime(s.send_time)} · ` : ""}
                                  {isProduction(s) ? "🎥 " : ""}{s.title}
                                </span>
                                {notes[s.id]?.trim() ? (
                                  <span className="cal-chip-note" title="You left a note">💬</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              groups.map(([month, items]) => (
                <section key={month} className="stack" style={{ gap: 12 }}>
                  <h2 className="snap-section-title">{month}</h2>
                  <div className="stack" style={{ gap: 12 }}>
                    {items.map((s) => (
                      <div key={s.id} className={`plan-card ${isProduction(s) ? "is-production" : ""}`}>
                        <div className="plan-card-date">
                          <span className="plan-card-dow">{fmtDate(s.send_date)}</span>
                          {s.send_time ? <span className="plan-card-time">{fmtTime(s.send_time)}</span> : null}
                        </div>
                        <div className="plan-card-body">
                          <div className="plan-card-title">
                            {isProduction(s) ? <span className="cal-pop-kind">Production</span> : null}
                            {s.title}
                          </div>
                          <dl className="plan-meta">
                            {isProduction(s) ? (
                              <PlanRow
                                label="Length"
                                value={
                                  s.duration === "full"
                                    ? "Full day (9 AM – 5:30 PM)"
                                    : "4 hours (ends 5:30 PM)"
                                }
                              />
                            ) : (
                              <>
                                <PlanRow label="Purpose" value={s.purpose} />
                                <PlanRow label="Audience" value={s.audience} />
                                <PlanRow label="Offer" value={s.offer} />
                                <PlanRow label="Subject line" value={s.subject} />
                                <PlanRow label="Preview text" value={s.preview_text} />
                              </>
                            )}
                          </dl>
                          <label className="plan-note">
                            <span>
                              Your note or change request
                              {savingId === s.id ? " · saving…" : notes[s.id]?.trim() ? " · saved" : ""}
                            </span>
                            <textarea
                              value={notes[s.id] || ""}
                              placeholder="Leave this blank if it looks good"
                              onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                              onBlur={(e) => saveNote(s.id, e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}

            <section className="plan-approve card card-pad stack" style={{ gap: 12 }}>
              {approvedAt ? (
                <>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Plan approved</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    Approved{approvedBy ? ` by ${approvedBy}` : ""} on {fmtApproved(approvedAt)}.
                    {noteCount > 0 ? " Your notes have been shared with the team." : ""}
                    {" "}Need another change? Leave a note above and re-approve.
                  </p>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="plan-name-input"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="Your name"
                    />
                    <button className="btn" onClick={approve} disabled={approving || !nameInput.trim()}>
                      {approving ? "Saving…" : "Approve again"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Approve this plan</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    {noteCount > 0
                      ? `You have left ${noteCount} note${noteCount === 1 ? "" : "s"}. Approving tells us the plan is good to build, notes included.`
                      : "Approving tells us the plan is good to go and we will start building."}
                  </p>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="plan-name-input"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="Your name"
                    />
                    <button className="btn" onClick={approve} disabled={approving || !nameInput.trim()}>
                      {approving ? "Saving…" : "Approve calendar"}
                    </button>
                  </div>
                </>
              )}
            </section>

            <footer className="snap-footer">
              Prepared by Marketing Empire Group
            </footer>
          </>
        )}
      </main>

      {detail ? (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="card card-pad plan-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="plan-card-title" style={{ marginBottom: 10 }}>
              {isProduction(detail) ? <span className="cal-pop-kind">Production</span> : null}
              {detail.title}
            </div>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              {fmtDate(detail.send_date)}
              {detail.send_time ? ` · ${fmtTime(detail.send_time)}` : ""}
            </p>
            <dl className="plan-meta">
              {isProduction(detail) ? (
                <PlanRow
                  label="Length"
                  value={
                    detail.duration === "full"
                      ? "Full day (9 AM – 5:30 PM)"
                      : "4 hours (ends 5:30 PM)"
                  }
                />
              ) : (
                <>
                  <PlanRow label="Purpose" value={detail.purpose} />
                  <PlanRow label="Audience" value={detail.audience} />
                  <PlanRow label="Offer" value={detail.offer} />
                  <PlanRow label="Subject line" value={detail.subject} />
                  <PlanRow label="Preview text" value={detail.preview_text} />
                </>
              )}
            </dl>
            <label className="plan-note" style={{ marginTop: 12 }}>
              <span>
                Your note or change request
                {savingId === detail.id ? " · saving…" : notes[detail.id]?.trim() ? " · saved" : ""}
              </span>
              <textarea
                value={notes[detail.id] || ""}
                placeholder="Leave this blank if it looks good"
                onChange={(e) => {
                  const body = e.target.value;
                  setNotes((n) => ({ ...n, [detail.id]: body }));
                }}
                onBlur={(e) => saveNote(detail.id, e.target.value)}
              />
            </label>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="plan-meta-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
