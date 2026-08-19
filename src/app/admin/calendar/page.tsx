"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarImportModal } from "@/components/CalendarImportModal";
import { CalendarTypeFilter, CalendarViewToggle } from "@/components/CalendarTypeFilter";
import { sendMatchesTypeFilter, type CalendarTypeKey } from "@/lib/calendar-type-filter";
import { isProductionBrief, parseProductionBrief } from "@/lib/production-brief";

type Status = "requested" | "planned" | "scheduled" | "sent";

type AssetType =
  | ""
  | "social_post"
  | "social_video_carousel"
  | "email_campaign"
  | "crm_automation"
  | "blog_post";

type Send = {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  send_date: string;
  send_time: string;
  duration: string;
  status: Status;
  asset_type: AssetType;
  note: string;
  audience: string;
  purpose: string;
  offer: string;
  subject: string;
  preview_text: string;
  production_brief: string;
};

type Client = { id: string; name: string };

// A Basecamp schedule entry, mirrored locally. Read-only here: these are edited
// in Basecamp, and the sync overwrites anything written on this side.
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
  const obj = parseProductionBrief(raw);
  if (!obj) return [];
  return BRIEF_LABELS.filter(([k]) => obj[k]).map(([k, label]) => [label, obj[k]]);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-09-01" -> "Sep 1, 2026". Blank stays blank.
function fmtDate(ymdStr: string): string {
  if (!ymdStr) return "";
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (!y || !m || !d) return ymdStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtListDay(ymdStr: string): string {
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (!y || !m || !d) return ymdStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

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

const ASSET_TYPE_LABEL: Record<Exclude<AssetType, "">, string> = {
  social_post: "Social post",
  social_video_carousel: "Social video carousel",
  email_campaign: "Email campaign",
  crm_automation: "CRM automation",
  blog_post: "Blog post",
};

// A production carries a structured intake brief. See lib/production-brief: the
// old test was "the brief is not empty", which turned a year of imported editorial
// content into camera shoots because its descriptions had been written into that
// column.
function isProduction(s: Pick<Send, "production_brief">): boolean {
  return isProductionBrief(s.production_brief);
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const EMPTY = {
  id: "",
  clientId: "",
  title: "",
  sendDate: "",
  sendTime: "",
  status: "planned" as Status,
  assetType: "" as AssetType,
  audience: "",
  purpose: "",
  offer: "",
  subject: "",
  previewText: "",
  note: "",
};

type Hover = { send: Send; top: number; left: number; maxHeight: number } | null;

export default function CalendarPage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [sends, setSends] = useState<Send[]>([]);
  // Whether this person's calendar is narrowed to the work their team owns, and
  // whether they've asked to step outside it. See TEAM_FOCUS in lib/people.
  const [scope, setScope] = useState<{ canToggle: boolean; narrowed: boolean }>({
    canToggle: false,
    narrowed: false,
  });
  const [showAll, setShowAll] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [clientQuery, setClientQuery] = useState("All clients");
  const [view, setView] = useState<"calendar" | "list">("list");
  const [typeFilter, setTypeFilter] = useState<CalendarTypeKey[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [plan, setPlan] = useState<{
    token: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    feedback: { send_id: string; body: string }[];
  } | null>(null);
  const [planCopied, setPlanCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  // The selected client's editorial footprint across all time, which is what
  // tells "this client has no calendar" apart from "this month happens to be
  // empty". Null while no single client is selected.
  const [summary, setSummary] = useState<{
    total: number;
    productions: number;
    firstDate: string;
    lastDate: string;
    months: string[];
  } | null>(null);
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const isAdmin = role === "admin";

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) setRole(data.role);
      })
      .catch(() => {});
  }, []);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  const load = useCallback(async () => {
    setError("");
    const start = ymd(year, month, 1);
    const end = ymd(year, month, daysInMonth);
    const [sr, cr] = await Promise.all([
      fetch(`/api/calendar?start=${start}&end=${end}${showAll ? "&all=1" : ""}`),
      fetch(`/api/revenue/clients`),
    ]);
    if (sr.status === 401 || cr.status === 401) {
      router.push("/login");
      return;
    }
    if (sr.ok) {
      const json = await sr.json();
      setSends(json.sends || []);
      if (json.scope) setScope(json.scope);
    }
    if (cr.ok) setClients((await cr.json()).clients || []);
  }, [year, month, daysInMonth, router, showAll]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the editorial-plan sharing info when a single client is selected.
  const loadPlan = useCallback(async () => {
    if (!isAdmin) { setPlan(null); return; }
    if (filter === "all") { setPlan(null); return; }
    const res = await fetch(`/api/calendar/plan/${filter}`);
    setPlan(res.ok ? await res.json() : null);
  }, [filter, isAdmin]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // Whether this client has an editorial calendar at all. Read for any role: the
  // prompt it drives is admin-only, but the "no calendar yet" fact is not.
  const loadSummary = useCallback(async () => {
    if (filter === "all") { setSummary(null); return; }
    try {
      const res = await fetch(`/api/calendar/summary?clientId=${filter}`);
      setSummary(res.ok ? await res.json() : null);
    } catch {
      setSummary(null);
    }
  }, [filter]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const feedbackBySend = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of plan?.feedback || []) m.set(f.send_id, f.body);
    return m;
  }, [plan]);

  const planUrl =
    plan?.token && typeof window !== "undefined"
      ? `${window.location.origin}/plan/${plan.token}`
      : "";
  const noteCount = plan?.feedback?.filter((f) => f.body.trim()).length || 0;

  async function copyPlan() {
    if (!planUrl) return;
    await navigator.clipboard.writeText(planUrl);
    setPlanCopied(true);
    setTimeout(() => setPlanCopied(false), 1500);
  }
  async function planAction(action: "rotate" | "clearApproval") {
    if (filter === "all") return;
    if (action === "rotate" && !confirm("Make a new link? The old link will stop working.")) return;
    if (action === "clearApproval" && !confirm("Clear the client's approval so they sign off again?")) return;
    await fetch(`/api/calendar/plan/${filter}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    loadPlan();
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of sends) {
      if (filter !== "all" && s.client_id !== filter) continue;
      if (!sendMatchesTypeFilter(s.asset_type, typeFilter)) continue;
      const arr = map.get(s.send_date) || [];
      arr.push(s);
      map.set(s.send_date, arr);
    }
    return map;
  }, [sends, filter, typeFilter]);

  const hasVisibleSends = useMemo(
    () => [...byDay.values()].some((items) => items.length > 0),
    [byDay]
  );

  const listGroups = useMemo(
    () => [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [byDay]
  );

  useEffect(() => {
    if (filter === "all") {
      setClientQuery("All clients");
      return;
    }
    const selected = clients.find((c) => c.id === filter);
    if (selected) setClientQuery(selected.name);
  }, [filter, clients]);

  const viewedMonth = `${year}-${pad(month + 1)}`;
  const clientName = clients.find((c) => c.id === filter)?.name || "this client";

  // Nothing planned, ever. The prompt to build a calendar hangs off this and not
  // off an empty grid, so paging into a quiet month never suggests starting over.
  const hasNoCalendar = !!summary && summary.total === 0;
  // A calendar exists, but not in the month on screen. Worth saying, because an
  // empty grid with no explanation is the thing that makes people doubt the data.
  const monthIsEmpty =
    !!summary && summary.total > 0 && !summary.months.includes(viewedMonth);

  // The month with content nearest the one being viewed, so the note can offer a
  // way back to the calendar rather than only reporting its absence.
  const nearestMonth = useMemo(() => {
    if (!summary?.months.length) return "";
    const index = (m: string) => {
      const [y, mo] = m.split("-").map(Number);
      return y * 12 + (mo - 1);
    };
    const target = index(viewedMonth);
    return summary.months.reduce((best, m) =>
      Math.abs(index(m) - target) < Math.abs(index(best) - target) ? m : best
    );
  }, [summary, viewedMonth]);

  function goToMonth(ym: string) {
    const [y, m] = ym.split("-").map(Number);
    setYear(y);
    setMonth(m - 1);
  }

  // Same client filter as sends, so filtering to one account hides other
  // accounts' meetings too.
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

  function applyClientQuery(raw: string) {
    const q = raw.trim();
    if (!q || q.toLowerCase() === "all clients") {
      setFilter("all");
      setClientQuery("All clients");
      return;
    }
    const exact = clients.find((c) => c.name.toLowerCase() === q.toLowerCase());
    if (exact) {
      setFilter(exact.id);
      setClientQuery(exact.name);
    }
  }

  // Filtering to a client and then clicking a day means that client, so the
  // selection carries into the form rather than having to be picked again.
  function openNew(date: string) {
    setEditing({ ...EMPTY, sendDate: date, clientId: filter === "all" ? "" : filter });
  }

  // The day a first send should default to: today when the current month is on
  // screen, otherwise the 1st of whichever month is being looked at.
  function firstDayInView(): string {
    const isThisMonth = year === now.getFullYear() && month === now.getMonth();
    return isThisMonth ? ymd(year, month, now.getDate()) : ymd(year, month, 1);
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
      assetType: s.asset_type || "",
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
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 100));
    const maxHeight = window.innerHeight - top - 12;
    setHover({ send: s, top, left, maxHeight });
  }
  function hideHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(null), 60);
  }
  function keepHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
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
      assetType: editing.assetType,
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
    // The first send a client gets has to clear the "no calendar" prompt.
    loadSummary();
  }

  async function createClient() {
    if (!isAdmin) return;
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
    if (res.ok) { setEditing(null); load(); loadSummary(); }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayYmd = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="app-shell">
      <div className="page-actions">
        {isAdmin ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn btn-sm" onClick={() => openNew(todayYmd)}>
              Add send
            </button>
          </>
        ) : null}
      </div>

      <main className="container container-wide stack">
        <div className="cal-header">
          <div>
            <p className="eyebrow">Email department</p>
            <h1 className="h1">Campaign calendar</h1>
          </div>
          <div className="row">
            <input
              className="select-clean cal-client-search"
              list="calendar-client-options"
              value={clientQuery}
              onChange={(e) => {
                const v = e.target.value;
                setClientQuery(v);
                if (!v.trim()) setFilter("all");
              }}
              onBlur={() => applyClientQuery(clientQuery)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyClientQuery(clientQuery);
                }
              }}
              placeholder="Type a client name"
              aria-label="Search clients"
            />
            <datalist id="calendar-client-options">
              <option value="All clients" />
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <div className="cal-nav">
              <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
              <span className="cal-month">{MONTHS[month]} {year}</span>
              <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
            {/* Only shown to people whose calendar starts narrowed to their own
                team's work, so it never appears for an admin who sees it all. */}
            {scope.canToggle ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAll((v) => !v)}
                title={
                  showAll
                    ? "Show only the work your team owns"
                    : "Show every campaign on the calendar"
                }
              >
                {showAll ? "Show my team's work" : "See all"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="cal-toolbar">
          <div className="cal-toolbar-filters">
            <span className="cal-toolbar-label">Show</span>
            <CalendarTypeFilter selected={typeFilter} onChange={setTypeFilter} />
            {hasVisibleSends ? (
              <span className="cal-toolbar-count">
                {listGroups.reduce((n, [, items]) => n + items.length, 0)}
              </span>
            ) : null}
          </div>
          <CalendarViewToggle view={view} onChange={setView} />
        </div>

        {error ? <p className="error">{error}</p> : null}

        {/* No calendar for this client yet. Asking a client to approve an empty
            plan makes no sense, so this replaces the approval card rather than
            sitting above it. */}
        {hasNoCalendar ? (
          isAdmin ? (
            <div className="card card-pad cal-onboard">
              <div className="cal-onboard-copy">
                <p className="eyebrow">Nothing planned yet</p>
                <h2 className="cal-onboard-title">
                  Build {clientName}&apos;s editorial calendar
                </h2>
                <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>
                  There are no planned emails, posts, or blogs on the calendar for
                  them. Import the calendar sheet if one already exists, or add the
                  first send and build it here.
                </p>
                {summary && summary.productions > 0 ? (
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                    They do have {summary.productions} production shoot
                    {summary.productions === 1 ? "" : "s"} booked. Shoots are
                    scheduling rather than editorial planning, so they are not part
                    of this.
                  </p>
                ) : null}
              </div>
              <div className="cal-onboard-actions">
                <button className="btn" onClick={() => setImporting(true)}>
                  Import a CSV
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => openNew(firstDayInView())}
                >
                  Add the first send
                </button>
                <a
                  className="btn btn-ghost btn-sm"
                  href="/api/calendar/import/template"
                  download
                >
                  Download template
                </a>
              </div>
            </div>
          ) : (
            <div className="card card-pad">
              <strong>No editorial calendar for {clientName} yet</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Nothing has been planned for them. An admin can import a calendar
                sheet or add the first send.
              </p>
            </div>
          )
        ) : null}

        {/* A calendar exists, just not in this month. Said out loud, with a way
            back, because an unexplained empty grid reads like lost data. */}
        {typeFilter.length > 0 && !hasNoCalendar && !monthIsEmpty && !hasVisibleSends ? (
          <div className="card card-pad cal-month-empty">
            <span>
              Nothing of those types in {MONTHS[month]} {year}. Try All, or pick a
              different combination.
            </span>
          </div>
        ) : null}

        {monthIsEmpty && summary ? (
          <div className="card card-pad cal-month-empty">
            <span>
              Nothing planned for {clientName} in {MONTHS[month]} {year}. Their
              calendar runs {fmtDate(summary.firstDate)} to {fmtDate(summary.lastDate)}.
            </span>
            {nearestMonth && nearestMonth !== viewedMonth ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => goToMonth(nearestMonth)}
              >
                Go to {MONTHS[Number(nearestMonth.split("-")[1]) - 1]}{" "}
                {nearestMonth.split("-")[0]}
              </button>
            ) : null}
          </div>
        ) : null}

        {isAdmin && filter !== "all" && plan && !hasNoCalendar ? (
          <div className="card card-pad plan-share">
            <div className="plan-share-main">
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <strong>Editorial plan approval</strong>
                {plan.approvedAt ? (
                  <span className="plan-status plan-status-ok">
                    Approved{plan.approvedBy ? ` · ${plan.approvedBy}` : ""}
                  </span>
                ) : (
                  <span className="plan-status plan-status-wait">Awaiting approval</span>
                )}
                {noteCount > 0 ? (
                  <span className="plan-status plan-status-note">
                    {noteCount} client note{noteCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Read-only link showing the next 90 days for the client to review and approve.
              </p>
              {planUrl ? (
                <div className="copy-box" style={{ marginTop: 8 }}>
                  <code>{planUrl}</code>
                </div>
              ) : null}
            </div>
            <div className="plan-share-actions">
              <button className="btn btn-secondary btn-sm" onClick={copyPlan}>
                {planCopied ? "Copied" : "Copy link"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => planAction("rotate")}>
                New link
              </button>
              {plan.approvedAt ? (
                <button className="btn btn-ghost btn-sm" onClick={() => planAction("clearApproval")}>
                  Reset approval
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {view === "list" ? (
          hasVisibleSends ? (
            <div className="cal-list">
              <div className="cal-list-head" aria-hidden="true">
                <span>Date</span>
                <span>Time</span>
                <span>Client</span>
                <span>Type</span>
                <span>Title</span>
                <span>Status</span>
              </div>
              {listGroups.flatMap(([, items]) => items).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cal-list-row ${isProduction(s) ? "is-production" : ""} ${feedbackBySend.has(s.id) ? "has-note" : ""}`}
                  onClick={() => {
                    if (isAdmin) openEdit(s);
                  }}
                  onMouseEnter={(e) => showHover(e, s)}
                  onMouseLeave={hideHover}
                >
                  <span className="cal-list-date">{fmtListDay(s.send_date)}</span>
                  <span className="cal-list-time">{s.send_time ? fmtTime(s.send_time) : "—"}</span>
                  <span className="cal-list-client">{s.client_name || "—"}</span>
                  <span className="cal-list-type">
                    {s.asset_type ? ASSET_TYPE_LABEL[s.asset_type] || s.asset_type : "—"}
                  </span>
                  <span className="cal-list-title">
                    {isProduction(s) ? "🎥 " : ""}
                    {s.title}
                    {feedbackBySend.has(s.id) ? (
                      <span className="cal-chip-note" title="Client left a note">💬</span>
                    ) : null}
                  </span>
                  <span className={`cal-pop-status chip-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                </button>
              ))}
            </div>
          ) : !hasNoCalendar && !monthIsEmpty && typeFilter.length === 0 ? (
            <div className="card card-pad">
              <p className="muted" style={{ margin: 0 }}>
                Nothing to list in {MONTHS[month]} {year}.
              </p>
            </div>
          ) : null
        ) : (
        <div className="cal-grid-wrap">
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
                onClick={() => {
                  if (isAdmin) openNew(date);
                }}
              >
                <div className="cal-daynum">{d}</div>
                {/* Basecamp schedule entries deliberately do not appear here.
                    The campaign calendar shows planned work; meetings live in
                    Basecamp and are picked up in Forecast instead. The event
                    cache is still synced, because the Forecast meeting picker
                    reads it. */}
                <div className="cal-events">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      className={`cal-chip chip-${s.status} ${isProduction(s) ? "is-production" : ""} ${feedbackBySend.has(s.id) ? "has-note" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isAdmin) openEdit(s);
                      }}
                      onMouseEnter={(e) => showHover(e, s)}
                      onMouseLeave={hideHover}
                    >
                      <span className="cal-chip-dot" />
                      <span className="cal-chip-name">
                        {s.send_time ? `${fmtTime(s.send_time)} · ` : ""}
                        {isProduction(s) ? "🎥 " : ""}{s.title}
                      </span>
                      {feedbackBySend.has(s.id) ? (
                        <span className="cal-chip-note" title="Client left a note">💬</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>
        )}
      </main>

      {hover ? (
        <div
          className="cal-pop"
          style={{ top: hover.top, left: hover.left, maxHeight: hover.maxHeight }}
          onMouseEnter={keepHover}
          onMouseLeave={hideHover}
        >
          <div className="cal-pop-head">
            <span className="cal-pop-title">{hover.send.title}</span>
            <span className={`cal-pop-status chip-${hover.send.status}`}>
              {STATUS_LABEL[hover.send.status]}
            </span>
          </div>
          {hover.send.client_name ? (
            <div className="cal-pop-client">
              {hover.send.client_name}
              {isProduction(hover.send) ? (
                <span className="cal-pop-kind">Production</span>
              ) : null}
            </div>
          ) : null}
          <dl className="cal-pop-list">
            <PopRow label="Start time" value={fmtTime(hover.send.send_time)} />
            {isProduction(hover.send) ? (
              <PopRow
                label="Length"
                value={
                  hover.send.duration === "full"
                    ? "Full day (9 AM – 5:30 PM)"
                    : "4 hours from selected start"
                }
              />
            ) : (
              <>
                <PopRow
                  label="Asset type"
                  value={hover.send.asset_type ? ASSET_TYPE_LABEL[hover.send.asset_type] : ""}
                />
                <PopRow label="Audience" value={hover.send.audience} />
                <PopRow label="Purpose" value={hover.send.purpose} />
                <PopRow label="Offers being tested" value={hover.send.offer} />
              </>
            )}
          </dl>
        </div>
      ) : null}

      {importing && isAdmin ? (
        <CalendarImportModal
          clients={clients}
          // The client the calendar is already filtered to, so the common case of
          // "I am looking at this account, import its sheet" skips a step.
          initialClientId={filter === "all" ? "" : filter}
          onClose={() => setImporting(false)}
          onImported={() => {
            load();
            loadPlan();
            loadSummary();
          }}
        />
      ) : null}

      {editing && isAdmin ? (
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
                    {isAdmin ? (
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => setAddingClient(true)}>+ New</button>
                    ) : null}
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
                <label>Asset type</label>
                <select className="select-clean" value={editing.assetType}
                  onChange={(e) => setEditing({ ...editing, assetType: e.target.value as AssetType })}>
                  <option value="">Not set</option>
                  <option value="social_post">Social post</option>
                  <option value="social_video_carousel">Social video carousel</option>
                  <option value="email_campaign">Email campaign</option>
                  <option value="crm_automation">CRM automation</option>
                  <option value="blog_post">Blog post</option>
                </select>
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
              {editing.id && feedbackBySend.get(editing.id)?.trim() ? (
                <div className="cal-brief cal-clientnote">
                  <div className="cal-brief-head">💬 Client note on this send</div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                    {feedbackBySend.get(editing.id)}
                  </p>
                </div>
              ) : null}
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
