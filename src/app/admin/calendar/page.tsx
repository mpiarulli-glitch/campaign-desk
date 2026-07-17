"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/Brand";

type Status = "requested" | "planned" | "scheduled" | "sent";

type Send = {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  send_date: string;
  send_time: string;
  status: Status;
  note: string;
  audience: string;
  purpose: string;
  offer: string;
  subject: string;
  preview_text: string;
  production_brief: string;
};

type Client = { id: string; name: string };

// Ordered [key, label] pairs for rendering a submitted production brief.
const BRIEF_LABELS: [string, string][] = [
  ["locations", "Location(s)"],
  ["onsiteContactName", "On-site contact"],
  ["onsiteContactPhone", "Contact phone"],
  ["locationState", "Location on shoot day"],
  ["powerAccess", "Power access"],
  ["timeRestrictions", "Time restrictions"],
  ["parking", "Parking"],
  ["onCameraPeople", "On camera / on site"],
  ["participantsConsent", "Consent to film"],
  ["mediaRelease", "Customers on camera"],
  ["propertyApproval", "Private property"],
  ["safetyCompliance", "Safety gear / OSHA"],
  ["captureRequests", "Shots they'd like"],
  ["offersPromotions", "Offers / promotions"],
  ["avoidRequests", "Avoid capturing"],
  ["additionalNotes", "Notes"],
];

function parseBrief(raw: string): [string, string][] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    return BRIEF_LABELS.filter(([k]) => obj[k]).map(([k, label]) => [label, obj[k]]);
  } catch {
    return [];
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 24h HH:MM -> "10 AM"; blank stays blank.
function fmtTime(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  if (Number.isNaN(h)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

const STATUS_LABEL: Record<Status, string> = {
  requested: "Requested",
  planned: "Planned",
  scheduled: "Scheduled",
  sent: "Sent",
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const EMPTY = {
  id: "",
  clientId: "",
  title: "",
  sendDate: "",
  sendTime: "",
  status: "planned" as Status,
  audience: "",
  purpose: "",
  offer: "",
  subject: "",
  previewText: "",
  note: "",
};

type Hover = { send: Send; top: number; left: number } | null;

export default function CalendarPage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [sends, setSends] = useState<Send[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState("");

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  const load = useCallback(async () => {
    setError("");
    const start = ymd(year, month, 1);
    const end = ymd(year, month, daysInMonth);
    const [sr, cr] = await Promise.all([
      fetch(`/api/calendar?start=${start}&end=${end}`),
      fetch(`/api/revenue/clients`),
    ]);
    if (sr.status === 401 || cr.status === 401) {
      router.push("/login");
      return;
    }
    if (sr.ok) setSends((await sr.json()).sends || []);
    if (cr.ok) setClients((await cr.json()).clients || []);
  }, [year, month, daysInMonth, router]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of sends) {
      if (filter !== "all" && s.client_id !== filter) continue;
      const arr = map.get(s.send_date) || [];
      arr.push(s);
      map.set(s.send_date, arr);
    }
    return map;
  }, [sends, filter]);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }
  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  function openNew(date: string) {
    setEditing({ ...EMPTY, sendDate: date });
  }
  function openEdit(s: Send) {
    setHover(null);
    setEditing({
      id: s.id,
      clientId: s.client_id || "",
      title: s.title,
      sendDate: s.send_date,
      sendTime: s.send_time || "",
      status: s.status,
      audience: s.audience,
      purpose: s.purpose,
      offer: s.offer,
      subject: s.subject,
      previewText: s.preview_text,
      note: s.note,
    });
  }

  function showHover(e: React.MouseEvent, s: Send) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 320;
    let left = rect.right + 10;
    if (left + W > window.innerWidth - 12) left = rect.left - W - 10;
    if (left < 12) left = 12;
    const top = Math.min(rect.top, window.innerHeight - 340);
    setHover({ send: s, top: Math.max(12, top), left });
  }
  function hideHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(null), 60);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.title.trim()) { setError("Email name is required."); return; }
    setSaving(true);
    setError("");
    const payload = {
      clientId: editing.clientId || null,
      title: editing.title,
      sendDate: editing.sendDate,
      sendTime: editing.sendTime,
      status: editing.status,
      audience: editing.audience,
      purpose: editing.purpose,
      offer: editing.offer,
      subject: editing.subject,
      previewText: editing.previewText,
      note: editing.note,
    };
    const res = editing.id
      ? await fetch(`/api/calendar/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/calendar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!res.ok) { setError("Could not save."); return; }
    setEditing(null);
    load();
  }

  async function createClient() {
    const name = newClient.trim();
    if (!name) return;
    const res = await fetch("/api/revenue/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, businessModel: "home_service" }),
    });
    if (!res.ok) { setError("Could not add client."); return; }
    const data = await res.json();
    setNewClient("");
    setAddingClient(false);
    await load();
    setEditing((ed) => (ed ? { ...ed, clientId: data.client.id } : ed));
  }

  async function remove() {
    if (!editing?.id) return;
    if (!confirm("Delete this send?")) return;
    const res = await fetch(`/api/calendar/${editing.id}`, { method: "DELETE" });
    if (res.ok) { setEditing(null); load(); }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayYmd = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">Campaigns</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/production">Production</Link>
          <button className="btn btn-sm" onClick={() => openNew(todayYmd)}>Add send</button>
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="cal-header">
          <div>
            <p className="eyebrow">Email department</p>
            <h1 className="h1">Campaign calendar</h1>
          </div>
          <div className="row">
            <select className="select-clean" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="cal-nav">
              <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
              <span className="cal-month">{MONTHS[month]} {year}</span>
              <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="cal-grid">
          {DOW.map((d) => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} className="cal-cell cal-empty" />;
            const date = ymd(year, month, d);
            const items = byDay.get(date) || [];
            const isToday = date === todayYmd;
            return (
              <div
                key={date}
                className={`cal-cell ${isToday ? "cal-today" : ""}`}
                onClick={() => openNew(date)}
              >
                <div className="cal-daynum">{d}</div>
                <div className="cal-events">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={`cal-chip chip-${s.status}`}
                      onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                      onMouseEnter={(e) => showHover(e, s)}
                      onMouseLeave={hideHover}
                    >
                      <span className="cal-chip-dot" />
                      <span className="cal-chip-name">
                        {s.send_time ? `${fmtTime(s.send_time)} · ` : ""}{s.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {hover ? (
        <div
          className="cal-pop"
          style={{ top: hover.top, left: hover.left }}
        >
          <div className="cal-pop-head">
            <span className="cal-pop-title">{hover.send.title}</span>
            <span className={`cal-pop-status chip-${hover.send.status}`}>
              {STATUS_LABEL[hover.send.status]}
            </span>
          </div>
          {hover.send.client_name ? (
            <div className="cal-pop-client">{hover.send.client_name}</div>
          ) : null}
          <dl className="cal-pop-list">
            <PopRow label="Start time" value={fmtTime(hover.send.send_time)} />
            <PopRow label="Audience" value={hover.send.audience} />
            <PopRow label="Purpose" value={hover.send.purpose} />
            <PopRow label="Offers being tested" value={hover.send.offer} />
            <PopRow label="Subject line" value={hover.send.subject} />
            <PopRow label="Preview text" value={hover.send.preview_text} />
          </dl>
        </div>
      ) : null}

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal card card-pad stack" onClick={(e) => e.stopPropagation()}>
            <strong>{editing.id ? "Edit send" : "New send"}</strong>
            <form className="stack" onSubmit={save}>
              <div className="field">
                <label>Email name</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="e.g. Summer maintenance offer"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Client</label>
                {addingClient ? (
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <input
                      value={newClient}
                      onChange={(e) => setNewClient(e.target.value)}
                      placeholder="New client name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); createClient(); }
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-sm" onClick={createClient}>Add</button>
                    <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => { setAddingClient(false); setNewClient(""); }}>Cancel</button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <select className="select-clean" style={{ flex: 1 }} value={editing.clientId}
                      onChange={(e) => setEditing({ ...editing, clientId: e.target.value })}>
                      <option value="">No client</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => setAddingClient(true)}>+ New</button>
                  </div>
                )}
              </div>
              <div className="rev-form-grid">
                <div className="field">
                  <label>Send date</label>
                  <input type="date" value={editing.sendDate}
                    onChange={(e) => setEditing({ ...editing, sendDate: e.target.value })} />
                </div>
                <div className="field">
                  <label>Start time</label>
                  <select className="select-clean" value={editing.sendTime}
                    onChange={(e) => setEditing({ ...editing, sendTime: e.target.value })}>
                    <option value="">No time</option>
                    {["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"].map((t) => (
                      <option key={t} value={t}>{fmtTime(t)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select className="select-clean" value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as Status })}>
                    <option value="requested">Requested</option>
                    <option value="planned">Planned</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="sent">Sent</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Audience</label>
                <input value={editing.audience}
                  onChange={(e) => setEditing({ ...editing, audience: e.target.value })}
                  placeholder="Who this is going to" />
              </div>
              <div className="field">
                <label>Purpose of email</label>
                <input value={editing.purpose}
                  onChange={(e) => setEditing({ ...editing, purpose: e.target.value })}
                  placeholder="What this email is trying to do" />
              </div>
              <div className="field">
                <label>Offers being tested</label>
                <input value={editing.offer}
                  onChange={(e) => setEditing({ ...editing, offer: e.target.value })}
                  placeholder="e.g. 15% off vs free install" />
              </div>
              <div className="field">
                <label>Subject line</label>
                <input value={editing.subject}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              </div>
              <div className="field">
                <label>Preview text</label>
                <input value={editing.previewText}
                  onChange={(e) => setEditing({ ...editing, previewText: e.target.value })} />
              </div>
              <div className="field">
                <label>Internal note</label>
                <input value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              </div>
              {(() => {
                const src = sends.find((s) => s.id === editing.id);
                const rows = parseBrief(src?.production_brief || "");
                if (!rows.length) return null;
                return (
                  <div className="cal-brief">
                    <div className="cal-brief-head">Production brief (from client)</div>
                    <dl className="cal-pop-list">
                      {rows.map(([label, value]) => (
                        <PopRow key={label} label={label} value={value} />
                      ))}
                    </dl>
                  </div>
                );
              })()}
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <button className="btn" type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
                {editing.id ? (
                  <button className="btn btn-danger btn-sm" type="button" onClick={remove}>
                    Delete
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PopRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="cal-pop-row">
      <dt>{label}</dt>
      <dd>{value?.trim() ? value : <span className="cal-pop-empty">Not set</span>}</dd>
    </div>
  );
}
