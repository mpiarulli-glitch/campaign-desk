"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";

type Model = "ecomm" | "b2b" | "home_service";
type Status = "planned" | "scheduled" | "sent";

type Send = {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  send_date: string;
  status: Status;
  platform: string;
  note: string;
  business_model: Model | null;
};

type Client = { id: string; name: string; business_model: Model };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MODEL_COLOR: Record<Model, string> = {
  ecomm: "#6d28d9",
  b2b: "#2563eb",
  home_service: "#1f9d63",
};
function colorFor(model: Model | null): string {
  return model ? MODEL_COLOR[model] : "#6b7280";
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const EMPTY = {
  id: "",
  clientId: "",
  clientName: "",
  title: "",
  sendDate: "",
  status: "planned" as Status,
  note: "",
};

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
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  }

  function openNew(date: string) {
    setEditing({ ...EMPTY, sendDate: date });
  }
  function openEdit(s: Send) {
    setEditing({
      id: s.id,
      clientId: s.client_id || "",
      clientName: s.client_name,
      title: s.title,
      sendDate: s.send_date,
      status: s.status,
      note: s.note,
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      clientId: editing.clientId || null,
      clientName: editing.clientName,
      title: editing.title,
      sendDate: editing.sendDate,
      status: editing.status,
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
    if (!res.ok) {
      setError("Could not save.");
      return;
    }
    setEditing(null);
    load();
  }

  async function remove() {
    if (!editing?.id) return;
    if (!confirm("Delete this send?")) return;
    const res = await fetch(`/api/calendar/${editing.id}`, { method: "DELETE" });
    if (res.ok) {
      setEditing(null);
      load();
    }
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
          <Link className="btn btn-ghost btn-sm" href="/admin">Campaigns</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/revenue">Revenue</Link>
          <button className="btn btn-sm" onClick={() => openNew(ymd(year, month, 1))}>
            Add send
          </button>
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow">Email department</p>
            <h1 className="h1">Campaign calendar</h1>
          </div>
          <div className="row">
            <select
              className="select-clean"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={prevMonth}>‹</button>
            <strong style={{ minWidth: 150, textAlign: "center" }}>
              {MONTHS[month]} {year}
            </strong>
            <button className="btn btn-secondary btn-sm" onClick={nextMonth}>›</button>
          </div>
        </div>

        <div className="row" style={{ gap: 16 }}>
          {(["home_service", "b2b", "ecomm"] as Model[]).map((m) => (
            <span key={m} className="cal-legend">
              <span className="cal-dot" style={{ background: MODEL_COLOR[m] }} />
              {m === "home_service" ? "Home service" : m === "b2b" ? "B2B" : "Ecommerce"}
            </span>
          ))}
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="cal-grid card">
          {DOW.map((d) => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} className="cal-cell cal-empty" />;
            const date = ymd(year, month, d);
            const items = byDay.get(date) || [];
            return (
              <div
                key={date}
                className={`cal-cell ${date === todayYmd ? "cal-today" : ""}`}
                onClick={() => openNew(date)}
              >
                <div className="cal-daynum">{d}</div>
                <div className="cal-events">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={`cal-event status-${s.status}`}
                      style={{ borderLeftColor: colorFor(s.business_model) }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(s);
                      }}
                      title={`${s.client_name || "No client"} — ${s.title} (${s.status})`}
                    >
                      <span className="cal-event-title">{s.title}</span>
                      {s.client_name ? (
                        <span className="cal-event-client">{s.client_name}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal card card-pad stack" onClick={(e) => e.stopPropagation()}>
            <strong>{editing.id ? "Edit send" : "New send"}</strong>
            <form className="stack" onSubmit={save}>
              <div className="field">
                <label>Title</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="e.g. July promo blast"
                  autoFocus
                />
              </div>
              <div className="rev-form-grid">
                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={editing.sendDate}
                    onChange={(e) => setEditing({ ...editing, sendDate: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Client</label>
                  <select
                    className="select-clean"
                    value={editing.clientId}
                    onChange={(e) => setEditing({ ...editing, clientId: e.target.value })}
                  >
                    <option value="">No client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    className="select-clean"
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as Status })}
                  >
                    <option value="planned">Planned</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="sent">Sent</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Note</label>
                <input
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
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
