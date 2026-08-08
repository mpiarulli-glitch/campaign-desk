"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type ColorWeek = "purple" | "red" | "blue" | "green" | "";
type Cadence = "monthly" | "bi_monthly" | "quarterly" | "";
type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  // Hand-set only. The cadence engine never produces this one.
  | "outreach_sent"
  | "requested"
  | "scheduled"
  | "sent";

const CADENCE_LABEL: Record<Cadence, string> = {
  monthly: "Monthly",
  bi_monthly: "Bi-Monthly",
  quarterly: "Quarterly",
  "": "—",
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured",
  inactive: "Inactive",
  not_due: "Not due yet",
  due: "Due",
  outreach_sent: "Outreach sent",
  requested: "Requested",
  scheduled: "Scheduled",
  sent: "Sent",
};

// The hand-set status choices. "" hands the row back to the cadence engine,
// which is why it reads as "Automatic" rather than as an empty option.
//
// The ones that mean the client is handled also stop the outreach, and say so
// on the option itself. Choosing "Requested" is a statement that they already
// asked, so continuing to chase them would be the exact nag worth avoiding.
const STATUS_OVERRIDE_OPTIONS = [
  { value: "", label: "Automatic" },
  { value: "not_due", label: "Not due yet" },
  { value: "due", label: "Due" },
  { value: "outreach_sent", label: "Outreach sent" },
  { value: "requested", label: "Requested (stops outreach)" },
  { value: "scheduled", label: "Scheduled (stops outreach)" },
  { value: "sent", label: "Sent (stops outreach)" },
  { value: "inactive", label: "Inactive (stops outreach)" },
];

// Statuses that mean handled. Mirrors HANDLED_STATUSES in cadence.ts, which is
// what the sweep actually enforces.
const HANDLED: CycleStatus[] = ["requested", "scheduled", "sent", "inactive"];

type Client = {
  id: string;
  name: string;
  active: number;
  contact_name: string;
  contact_email: string;
  account_manager: string;
  color_week: ColorWeek;
  production_cadence: Cadence;
  last_production_date: string | null;
  schedule_token: string | null;
  production_enrolled: number;
  basecamp_contact_id: number;
  status_override: string;
  outreach_paused: number;
  basecamp_project_id: string;
  videographer_id: string;
};

type Videographer = {
  id: string;
  name: string;
  active: number;
  // Comma-separated day numbers, 0 = Sunday. Weekdays this person never shoots.
  unavailable_weekdays: string;
};

const WEEKDAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
];

function daysOff(v: Videographer): number[] {
  return (v.unavailable_weekdays || "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

type BasecampPerson = {
  id: number;
  name: string;
  email: string;
  isClient: boolean;
  mentionable: boolean;
};

type OpenExtraRequest = {
  id: string;
  windowStart: string;
  windowEnd: string;
  bcCardAt: string | null;
  emailSentAt: string | null;
};

type ReachoutChannel = "email" | "basecamp_card" | "basecamp_comment";

const REACHOUT_LABEL: Record<ReachoutChannel, string> = {
  email: "Email",
  basecamp_card: "Basecamp card",
  basecamp_comment: "Basecamp follow-up",
};

type Reachout = {
  id: string;
  client_id: string;
  client_name: string;
  channel: ReachoutChannel;
  window_start: string | null;
  ymd: string;
  detail: string | null;
};

type Row = {
  client: Client;
  window: { start: string; end: string } | null;
  // What to display: the hand-set status if there is one, else the real one.
  status: CycleStatus;
  // What the cadence engine actually computes, kept so an override never hides
  // the truth: it still shows in the tooltip and on the edit control.
  realStatus: CycleStatus;
  overridden: boolean;
  existingSend: { id: string; sendDate: string; status: string } | null;
  currentReminderCount: number;
  lastEmailSent: string | null;
  lastWindowEmailed: string | null;
  // Last contact on any channel. `lastEmailSent` above covers email only, so it
  // reads "Never" for a client who has only ever been chased on Basecamp.
  lastReachout: { channel: ReachoutChannel; ymd: string; detail: string | null } | null;
  // Outreach for the window in front of them, counted across all channels.
  // `currentReminderCount` is the email-only version of this.
  currentReachoutCount: number;
  currentReachoutLast: { channel: ReachoutChannel; ymd: string } | null;
  openExtraRequest: OpenExtraRequest | null;
};

// Has this client been contacted about the window they are currently in?
// Falls back to the email count so rows still read correctly for outreach that
// predates the reach-out log.
function outreachCount(r: Row): number {
  return Math.max(r.currentReachoutCount || 0, r.currentReminderCount || 0);
}

type ProductionStatus = "requested" | "planned" | "scheduled" | "sent";
type ProductionTab =
  | "requested"
  | "awaiting"
  | "confirmed"
  | "cancelled"
  | "setup"
  | "reachouts";

// The "Log a production" form: a production that was arranged over the phone or
// in another booking system, recorded after the fact.
type LogForm = {
  clientId: string;
  date: string;
  time: string;
  duration: "half" | "full";
  status: "requested" | "scheduled" | "sent";
  note: string;
  cadenceWindowStart: string;
  notifyClient: boolean;
  notifyTeam: boolean;
  advanceAnchor: boolean;
  // An extra shoot outside the client's regular cadence — a client fell
  // behind, or just needs something ad hoc. Never touches their cadence
  // anchor and doesn't require a color week / cadence to be set at all.
  outOfCycle: boolean;
};

type Production = {
  id: string;
  client_name: string;
  send_date: string;
  send_time: string;
  duration: string;
  status: ProductionStatus;
  account_manager: string;
  videographer: string;
  created_at: string;
  cancelled_at: string | null;
  cadence_window_start: string | null;
};

// Which client fields can be edited inline, and how each maps to the PATCH body.
type Field =
  | "name"
  | "contact_name"
  | "contact_email"
  | "account_manager"
  | "active"
  | "color_week"
  | "production_cadence"
  | "last_production_date"
  | "status_override"
  | "basecamp_project_id"
  | "videographer_id";

const PATCH_KEY: Record<Field, string> = {
  name: "name",
  contact_name: "contactName",
  contact_email: "contactEmail",
  account_manager: "accountManager",
  active: "active",
  color_week: "colorWeek",
  production_cadence: "productionCadence",
  last_production_date: "lastProductionDate",
  status_override: "statusOverride",
  basecamp_project_id: "basecampProjectId",
  videographer_id: "videographerId",
};

const COLOR_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "purple", label: "Purple" },
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
];
const CADENCE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "monthly", label: "Monthly" },
  { value: "bi_monthly", label: "Bi-Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
const ACTIVE_OPTIONS = [
  { value: "1", label: "Yes" },
  { value: "0", label: "No" },
];
const ACCOUNT_MANAGER_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "Kyle", label: "Kyle" },
  { value: "Cassidy", label: "Cassidy" },
  { value: "Luis", label: "Luis" },
];

// Which group a client falls into, for the counts across the top. These are the
// four questions actually asked of this page: who is waiting on us, who needs
// booking now, who is already handled, and who was never set up.
type StatusFilter = "all" | "waiting" | "asked" | "due" | "ahead" | "unset";

function bucketOf(r: Row): Exclude<StatusFilter, "all"> {
  if (!r.window) return "unset";
  if (r.status === "requested") return "waiting";
  // Asked and not booked. Distinct from "due" (never asked) and from "ahead"
  // (nothing needed yet), because the next move is a chase rather than a first
  // approach.
  //
  // "Asked" means contacted on any channel about THIS window. Keying this off
  // the email count alone put clients we had already chased on Basecamp back in
  // "due", so they read as never approached and got approached again.
  // A hand-set "Outreach sent" counts the same as a logged one. It exists for
  // outreach that happened off the app, so it has to land in the same bucket as
  // the outreach the app did itself.
  if (r.status === "outreach_sent") return "asked";
  if (!r.existingSend && outreachCount(r) > 0) return "asked";
  if (r.status === "due") return "due";
  return "ahead";
}

const TONE: Record<CycleStatus, string> = {
  not_configured: "is-quiet",
  inactive: "is-quiet",
  not_due: "is-quiet",
  due: "is-bad",
  // Warn, not good: they were asked and still have not booked, which is the
  // same tone the automatic version of this state already uses.
  outreach_sent: "is-warn",
  requested: "is-warn",
  scheduled: "is-good",
  sent: "is-good",
};

const DOW_LETTER = ["M", "T", "W", "T", "F"];
const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function ymdAdd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayNumber(ymd: string): number {
  return Number(ymd.split("-")[2]);
}
function monthOf(ymd: string): string {
  return MONTH_SHORT[Number(ymd.split("-")[1]) - 1] || "";
}
function daysApart(from: string, to: string): number {
  const at = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86400000);
}

// Mon to Fri of the window, in order.
function windowDays(w: { start: string; end: string }): string[] {
  const out: string[] = [];
  for (let i = 0; i <= daysApart(w.start, w.end); i++) out.push(ymdAdd(w.start, i));
  return out;
}

// The line under the strip. Says the one thing worth knowing about timing.
function whenLabel(w: { start: string; end: string }, todayYmd: string): string {
  if (!todayYmd) return `${dayNumber(w.start)} to ${dayNumber(w.end)}`;
  const lead = daysApart(todayYmd, w.start);
  if (lead > 0) return `opens in ${lead} day${lead === 1 ? "" : "s"}`;
  if (w.end < todayYmd) return "window closed";
  const left = daysApart(todayYmd, w.end) + 1;
  return `${left} day${left === 1 ? "" : "s"} left to book`;
}

function fmtDate(ymd: string | null): string {
  if (!ymd) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtWindow(w: { start: string; end: string } | null): string {
  if (!w) return "—";
  const short = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return `${short(w.start)} – ${short(w.end)}`;
}

function colorLabel(c: ColorWeek): string {
  return c ? c[0].toUpperCase() + c.slice(1) : "—";
}

function fmtTime(hhmm: string): string {
  if (!hhmm) return "—";
  const [hourText, minute = "00"] = hhmm.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function ProductionPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [reachouts, setReachouts] = useState<Reachout[]>([]);
  // Basecamp rosters, fetched per client the first time its picker is opened.
  // Not loaded up front: it is one API call per project and most rows are never
  // expanded.
  const [people, setPeople] = useState<
    Record<string, { loading: boolean; people: BasecampPerson[]; reason?: string }>
  >({});
  const [tab, setTab] = useState<ProductionTab>("setup");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState<Record<string, string>>({});
  const [showInactive, setShowInactive] = useState(true);
  const [colorFilter, setColorFilter] = useState<ColorWeek | "all">("all");
  // The server's business date. Used to mark the window strip, so "today" is
  // Pacific rather than whatever the viewer's machine says.
  const [today, setToday] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);

  // Per-cell inline editing.
  const [edit, setEdit] = useState<{ id: string; field: Field } | null>(null);
  const [val, setVal] = useState("");
  const skipCommit = useRef(false);

  const [bc, setBc] = useState<{
    configured: boolean;
    connected: boolean;
    // Whose Basecamp login the background jobs act as. Should be the mascot
    // account, never a real person's.
    identity: { name: string; email: string } | null;
    personalLoginInUse: { person: string; name: string } | null;
  } | null>(null);
  const [videographers, setVideographers] = useState<Videographer[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // "Log a production" form, for productions booked outside the app.
  const [logging, setLogging] = useState<LogForm | null>(null);
  const logFormRef = useRef<HTMLFormElement>(null);
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState("");

  // "Ask to schedule" form: reach out to a client about an extra production
  // in a hand-picked window, via Basecamp card + email.
  const [extraAsk, setExtraAsk] = useState<{
    clientId: string;
    windowStart: string;
    windowEnd: string;
    note: string;
  } | null>(null);
  const [extraAskSaving, setExtraAskSaving] = useState(false);
  const [extraAskError, setExtraAskError] = useState("");
  const [extraAskBusyId, setExtraAskBusyId] = useState("");

  function openLog(clientId = "") {
    setLogError("");
    const row = clientId ? rows.find((r) => r.client.id === clientId) : undefined;
    setLogging({
      clientId,
      // Opening from a client's row prefills their current window, which is the
      // date wanted almost every time. Opening the blank form leaves it empty.
      date: row?.window?.start || "",
      time: "09:00",
      duration: "half",
      status: "scheduled",
      note: "",
      cadenceWindowStart: "",
      notifyClient: false,
      notifyTeam: false,
      advanceAnchor: true,
      // No window to derive from (cadence not set up yet) is the one case
      // where out-of-cycle is clearly the only option, so default to it.
      outOfCycle: Boolean(clientId) && !row?.window,
    });
  }

  // Picking a client prefills the date with their current window, which is what
  // you want almost every time. Backfilling a past production means changing it.
  function chooseLogClient(clientId: string) {
    if (!logging) return;
    const row = rows.find((r) => r.client.id === clientId);
    setLogging({
      ...logging,
      clientId,
      date: logging.date || row?.window?.start || "",
    });
  }

  async function submitLog(e: FormEvent) {
    e.preventDefault();
    if (!logging) return;
    if (!logging.clientId) { setLogError("Pick a client."); return; }
    if (!logging.date) { setLogError("Pick the production date."); return; }
    setLogSaving(true);
    setLogError("");
    const res = await fetch("/api/production", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: logging.clientId,
        date: logging.date,
        time: logging.time,
        duration: logging.duration,
        status: logging.status,
        note: logging.note,
        outOfCycle: logging.outOfCycle,
        cadenceWindowStart: logging.outOfCycle
          ? undefined
          : logging.cadenceWindowStart || undefined,
        notifyClient: logging.notifyClient,
        notifyTeam: logging.notifyTeam,
        // Only meaningful on a completed production; the server ignores it
        // otherwise, but don't send a misleading true. Out-of-cycle never
        // advances the anchor, regardless of what the checkbox says.
        advanceAnchor:
          !logging.outOfCycle && logging.status === "sent" && logging.advanceAnchor,
      }),
    });
    setLogSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLogError(data.error || "Could not log the production.");
      return;
    }
    setLogging(null);
    load({ silent: true });
  }

  function openExtraAsk(clientId: string) {
    setExtraAskError("");
    const start = new Date();
    start.setDate(start.getDate() + 3);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setExtraAsk({
      clientId,
      windowStart: iso(start),
      windowEnd: iso(end),
      note: "",
    });
  }

  async function submitExtraAsk(e: FormEvent) {
    e.preventDefault();
    if (!extraAsk) return;
    if (!extraAsk.windowStart || !extraAsk.windowEnd) {
      setExtraAskError("Pick a start and end date.");
      return;
    }
    setExtraAskSaving(true);
    setExtraAskError("");
    const res = await fetch("/api/production/extra-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(extraAsk),
    });
    setExtraAskSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setExtraAskError(data.error || "Could not send the request.");
      return;
    }
    setExtraAsk(null);
    load({ silent: true });
  }

  async function resendExtraAsk(id: string) {
    setExtraAskBusyId(id);
    await fetch(`/api/production/extra-request/${id}`, { method: "POST" });
    setExtraAskBusyId("");
    load({ silent: true });
  }

  async function cancelExtraAsk(id: string) {
    if (!confirm("Cancel this scheduling request? The client's link will no longer offer this window.")) return;
    setExtraAskBusyId(id);
    await fetch(`/api/production/extra-request/${id}`, { method: "DELETE" });
    setExtraAskBusyId("");
    load({ silent: true });
  }

  async function addVideographer() {
    const name = (prompt("Videographer name") || "").trim();
    if (!name) return;
    const res = await fetch("/api/videographers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) load({ silent: true });
  }

  async function loadBc() {
    const res = await fetch("/api/basecamp/status");
    if (res.ok) setBc(await res.json());
  }
  async function disconnectBc() {
    await fetch("/api/basecamp/status", { method: "DELETE" });
    loadBc();
  }
  const [matchMsg, setMatchMsg] = useState("");
  // Held between the preview call and the apply call so importing new clients is
  // never a surprise — you see the counts and names first.
  const [importPreview, setImportPreview] = useState<{
    linked: Array<{ client: string; project: string }>;
    created: Array<{ client: string; project: string }>;
    ambiguous: Array<{ client: string; options: string[] }>;
    noProject: string[];
    skippedInternal: string[];
  } | null>(null);

  async function runMatch(opts: { createMissing: boolean; dryRun: boolean }) {
    setMatchMsg(
      opts.dryRun ? "Checking Basecamp..." : "Matching clients to Basecamp projects..."
    );
    const res = await fetch("/api/basecamp/automatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      setMatchMsg("Could not reach Basecamp. Is it still connected?");
      return;
    }
    const d = await res.json();
    if (opts.dryRun) {
      setImportPreview(d);
      setMatchMsg("");
      return;
    }
    setImportPreview(null);
    setMatchMsg(
      `Linked ${d.linked.length}${d.created.length ? `, created ${d.created.length}` : ""}. ` +
        (d.noProject.length ? `No project found for: ${d.noProject.join(", ")}.` : "All set.")
    );
    load({ silent: true });
  }

  // Bring the form into view when it opens. Clicking "Log a shoot" on a client
  // twenty rows down otherwise looks like the button did nothing.
  // Statically checkable: a plain string that changes whenever the form opens or
  // switches client, and is empty while the form is closed.
  const logOpenFor = logging ? `open:${logging.clientId}` : "";
  useEffect(() => {
    if (logOpenFor && logFormRef.current) {
      logFormRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [logOpenFor]);

  // Cancelling hands the cadence window back, so the client goes straight back
  // to needing a production. Reversible, which is why there is no confirm.
  async function setCancelled(id: string, cancelled: boolean) {
    const res = await fetch(`/api/calendar/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelled }),
    });
    if (!res.ok) {
      setError(cancelled ? "Could not cancel that production." : "Could not restore it.");
      return;
    }
    load({ silent: true });
  }

  // For rows that should never have existed, like a test booking.
  async function removeProduction(id: string, clientName: string) {
    if (!confirm(`Delete the ${clientName} production for good? This cannot be undone. Cancel it instead if you want to keep the record.`)) {
      return;
    }
    const res = await fetch(`/api/calendar/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete that production.");
      return;
    }
    load({ silent: true });
  }

  const autoMatch = () => runMatch({ createMissing: false, dryRun: false });

  // silent = true skips the loading state so an inline edit or toggle
  // doesn't blank the whole table out and jump the page back to the top.
  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    const res = await fetch("/api/production");
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
    setRows(data.clients || []);
    setProductions(data.productions || []);
    setVideographers(data.videographers || []);
    setReachouts(data.reachouts || []);
    if (data.today) setToday(data.today);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const admin = data?.role === "admin";
        setIsAdmin(admin);
        if (admin) loadBc();
      })
      .catch(() => {});
  }, []);

  function beginEdit(id: string, field: Field, current: string) {
    setError("");
    setEdit({ id, field });
    setVal(current);
  }

  function cancelEdit() {
    skipCommit.current = true;
    setEdit(null);
  }

  async function commit(override?: string) {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    if (!edit) return;
    const { id, field } = edit;
    const raw = override !== undefined ? override : val;
    setEdit(null);

    let value: string | boolean | null = raw;
    if (field === "active") value = raw === "1";
    else if (field === "last_production_date") value = raw || null;

    const res = await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [PATCH_KEY[field]]: value }),
    });
    if (!res.ok) {
      setError("Could not save that change.");
      return;
    }
    load({ silent: true });
  }

  async function loadPeople(clientId: string) {
    if (people[clientId]?.loading || people[clientId]?.people.length) return;
    setPeople((m) => ({ ...m, [clientId]: { loading: true, people: [] } }));
    const res = await fetch(`/api/revenue/clients/${clientId}/basecamp-people`);
    if (!res.ok) {
      setPeople((m) => ({
        ...m,
        [clientId]: { loading: false, people: [], reason: "Could not load the project roster." },
      }));
      return;
    }
    const data = await res.json();
    setPeople((m) => ({
      ...m,
      [clientId]: { loading: false, people: data.people || [], reason: data.reason },
    }));
  }

  // Picking a person writes all three fields at once: the id we match on, plus
  // the name and email so every existing surface that reads them stays correct.
  async function pickContact(clientId: string, person: BasecampPerson | null) {
    const res = await fetch(`/api/revenue/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        person
          ? {
              basecampContactId: person.id,
              contactName: person.name,
              contactEmail: person.email,
            }
          : { basecampContactId: 0 }
      ),
    });
    if (!res.ok) {
      setError("Could not set the contact.");
      return;
    }
    load({ silent: true });
  }

  // A standing day off for a videographer, applied to every client assigned to
  // them. Beats re-entering the same date as a blackout on each client forever.
  async function setDaysOff(videographerId: string, days: number[]) {
    const res = await fetch(`/api/videographers/${videographerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unavailableWeekdays: days }),
    });
    if (!res.ok) {
      setError("Could not change that videographer's availability.");
      return;
    }
    load({ silent: true });
  }

  async function setOutreachPaused(clientId: string, paused: boolean) {
    const res = await fetch(`/api/revenue/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outreachPaused: paused }),
    });
    if (!res.ok) {
      setError("Could not change the outreach setting.");
      return;
    }
    load({ silent: true });
  }

  async function setEnrolled(clientId: string, enrolled: boolean) {
    const res = await fetch(`/api/revenue/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productionEnrolled: enrolled }),
    });
    if (!res.ok) {
      setError("Could not update production status.");
      return;
    }
    load({ silent: true });
  }

  async function copyLink(clientId: string) {
    const res = await fetch(`/api/revenue/clients/${clientId}/schedule-token`);
    if (!res.ok) {
      setLinkMessage((m) => ({ ...m, [clientId]: "Could not get link." }));
      return;
    }
    const data = await res.json();
    const url = `${window.location.origin}/schedule/${data.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMessage((m) => ({ ...m, [clientId]: "Copied!" }));
    } catch {
      setLinkMessage((m) => ({ ...m, [clientId]: url }));
    }
  }

  const enrolled = useMemo(() => rows.filter((r) => r.client.production_enrolled), [rows]);
  const removed = useMemo(() => rows.filter((r) => !r.client.production_enrolled), [rows]);
  // Ordered by what needs a person: waiting on us, then due, then booked ahead,
  // then never set up. Within a group, the soonest window first.
  const BUCKET_ORDER: Record<Exclude<StatusFilter, "all">, number> = {
    waiting: 0, due: 1, asked: 2, ahead: 3, unset: 4,
  };
  const visible = useMemo(
    () =>
      enrolled
        .filter((r) => (showInactive ? true : r.client.active))
        .filter((r) => (colorFilter === "all" ? true : r.client.color_week === colorFilter))
        .filter((r) => (statusFilter === "all" ? true : bucketOf(r) === statusFilter))
        .slice()
        .sort((a, b) => {
          const d = BUCKET_ORDER[bucketOf(a)] - BUCKET_ORDER[bucketOf(b)];
          if (d !== 0) return d;
          const aw = a.window?.start || "9999-99-99";
          const bw = b.window?.start || "9999-99-99";
          return aw === bw ? a.client.name.localeCompare(b.client.name) : aw.localeCompare(bw);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enrolled, showInactive, colorFilter, statusFilter]
  );

  // Clients who have had outreach and still have not booked. The tally is per
  // window, which is the number that matters when deciding whether to chase.
  const awaiting = useMemo(
    () =>
      enrolled
        .filter((r) => r.window && !r.existingSend && outreachCount(r) > 0)
        .slice()
        .sort(
          (a, b) =>
            outreachCount(b) - outreachCount(a) ||
            (a.window?.start || "").localeCompare(b.window?.start || "")
        ),
    [enrolled]
  );

  const counts = useMemo(() => {
    const base = { waiting: 0, due: 0, asked: 0, ahead: 0, unset: 0 };
    for (const r of enrolled) {
      if (!showInactive && !r.client.active) continue;
      base[bucketOf(r)]++;
    }
    return base;
  }, [enrolled, showInactive]);
  const activeCount = enrolled.filter((r) => r.client.active).length;
  const liveProductions = useMemo(
    () => productions.filter((production) => !production.cancelled_at),
    [productions]
  );
  const cancelledProductions = useMemo(
    () => productions.filter((production) => production.cancelled_at),
    [productions]
  );
  const requestedProductions = useMemo(
    () => liveProductions.filter((production) => production.status === "requested"),
    [liveProductions]
  );
  const confirmedProductions = useMemo(
    () => liveProductions.filter((production) => production.status !== "requested"),
    [liveProductions]
  );
  const visibleProductions =
    tab === "requested"
      ? requestedProductions
      : tab === "cancelled"
        ? cancelledProductions
        : confirmedProductions;

  // Only clients whose color week and cadence are set can have a production
  // logged, since without them there's no window to record it against.
  const loggableClients = useMemo(
    () =>
      enrolled
        .filter((r) => r.client.color_week && r.client.production_cadence)
        .sort((a, b) => a.client.name.localeCompare(b.client.name)),
    [enrolled]
  );
  const logSelectedWindow = useMemo(
    () =>
      logging?.clientId
        ? rows.find((r) => r.client.id === logging.clientId)?.window || null
        : null,
    [logging?.clientId, rows]
  );
  // Whether moving the anchor is consequential depends on the cadence: monthly
  // windows don't move, longer cadences shift by whole months.
  const logSelectedCadence = useMemo(
    () =>
      logging?.clientId
        ? rows.find((r) => r.client.id === logging.clientId)?.client
            .production_cadence || ""
        : "",
    [logging?.clientId, rows]
  );

  const vidOptions = [
    { value: "", label: "Unassigned" },
    ...videographers.map((v) => ({ value: v.id, label: v.name })),
  ];
  const vidName = (id: string) => videographers.find((v) => v.id === id)?.name || "";

  // Renders a text/date/select input for the cell currently being edited.
  function editor(field: Field, type: "text" | "date" | "select", options?: { value: string; label: string }[]) {
    const commonKey = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") cancelEdit();
    };
    if (type === "select" && options) {
      return (
        <select
          autoFocus
          className="select-clean cell-input"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => commit()}
          onKeyDown={commonKey}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        autoFocus
        type={type}
        className="cell-input"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={commonKey}
      />
    );
  }

  // A clickable, editable cell.
  // Same click-to-edit behaviour as the old table cells, in a span so it works
  // inside the bands. Non-admins get plain text, never an editable affordance.
  function editableField(
    r: Row,
    field: Field,
    type: "text" | "date" | "select",
    current: string,
    display: React.ReactNode,
    options?: { value: string; label: string }[]
  ) {
    if (!isAdmin) return display;
    const active = edit?.id === r.client.id && edit?.field === field;
    if (active) return <span className="cell-editing">{editor(field, type, options)}</span>;
    return (
      <span
        className="cell-clickable"
        title="Click to edit"
        role="button"
        tabIndex={0}
        onClick={() => beginEdit(r.client.id, field, current)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            beginEdit(r.client.id, field, current);
          }
        }}
      >
        {display}
      </span>
    );
  }

  return (
    <div className="app-shell">
      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Email department</p>
          <h1 className="h1">Productions</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            See where every client stands, review new production requests, and
            check what the scheduler has been sending.
          </p>
        </div>

        <div className="tabs" role="tablist" aria-label="Production views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "setup"}
            className={`tab ${tab === "setup" ? "active" : ""}`}
            onClick={() => setTab("setup")}
          >
            Production dashboard
            <span className="tab-count">{enrolled.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "requested"}
            className={`tab ${tab === "requested" ? "active" : ""}`}
            onClick={() => setTab("requested")}
          >
            To confirm
            <span className="tab-count">{requestedProductions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "confirmed"}
            className={`tab ${tab === "confirmed" ? "active" : ""}`}
            onClick={() => setTab("confirmed")}
          >
            Confirmed
            <span className="tab-count">{confirmedProductions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "awaiting"}
            className={`tab ${tab === "awaiting" ? "active" : ""}`}
            onClick={() => setTab("awaiting")}
          >
            Awaiting client
            <span className="tab-count">{awaiting.length}</span>
          </button>
          {cancelledProductions.length ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "cancelled"}
              className={`tab ${tab === "cancelled" ? "active" : ""}`}
              onClick={() => setTab("cancelled")}
            >
              Cancelled
              <span className="tab-count">{cancelledProductions.length}</span>
            </button>
          ) : null}
          <span className="tab-divider" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={tab === "reachouts"}
            className={`tab ${tab === "reachouts" ? "active" : ""}`}
            onClick={() => setTab("reachouts")}
          >
            Reach-outs
            <span className="tab-count">{reachouts.length}</span>
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {isAdmin ? (
          logging ? (
            <form ref={logFormRef} className="card card-pad stack" onSubmit={submitLog}>
              <div>
                <h2 className="h3" style={{ margin: 0 }}>
                  {logging.outOfCycle ? "Request an out-of-cycle production" : "Log a production"}
                </h2>
                <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>
                  {logging.outOfCycle
                    ? "An extra shoot outside the client's regular cadence — they fell behind, or just need something ad hoc. Never moves their cadence anchor or their next regular window."
                    : "For a production booked over the phone or in another system. This records it against the client's cadence window, so it shows in the queue and stops their scheduling reminders."}
                </p>
              </div>

              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={logging.outOfCycle}
                  onChange={(e) =>
                    setLogging({ ...logging, outOfCycle: e.target.checked })
                  }
                />
                <span className="muted">
                  This is an out-of-cycle request (doesn&apos;t affect their regular schedule)
                </span>
              </label>

              <div className="rev-form-grid">
                <div className="field">
                  <label htmlFor="log-client">Client</label>
                  <select
                    id="log-client"
                    className="select-clean"
                    value={logging.clientId}
                    onChange={(e) => chooseLogClient(e.target.value)}
                  >
                    <option value="">Pick a client</option>
                    {loggableClients.map((r) => (
                      <option key={r.client.id} value={r.client.id}>
                        {r.client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-date">Production date</label>
                  <input
                    id="log-date"
                    type="date"
                    value={logging.date}
                    onChange={(e) => setLogging({ ...logging, date: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="log-time">Start time</label>
                  <select
                    id="log-time"
                    className="select-clean"
                    value={logging.time}
                    onChange={(e) => setLogging({ ...logging, time: e.target.value })}
                  >
                    <option value="">No time set</option>
                    {["09:00", "10:00", "11:00", "12:00", "13:00"].map((t) => (
                      <option key={t} value={t}>{fmtTime(t)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-duration">Length</label>
                  <select
                    id="log-duration"
                    className="select-clean"
                    value={logging.duration}
                    onChange={(e) =>
                      setLogging({ ...logging, duration: e.target.value as "half" | "full" })
                    }
                  >
                    <option value="half">4 hours</option>
                    <option value="full">Full day</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-status">Status</label>
                  <select
                    id="log-status"
                    className="select-clean"
                    value={logging.status}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        status: e.target.value as LogForm["status"],
                      })
                    }
                  >
                    <option value="requested">Requested, not confirmed</option>
                    <option value="scheduled">Confirmed</option>
                    <option value="sent">Already happened</option>
                  </select>
                </div>
                {logging.outOfCycle ? null : (
                  <div className="field">
                    <label htmlFor="log-window">Counts toward window</label>
                    <input
                      id="log-window"
                      type="date"
                      value={logging.cadenceWindowStart}
                      onChange={(e) =>
                        setLogging({ ...logging, cadenceWindowStart: e.target.value })
                      }
                    />
                    <span className="muted" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                      {logSelectedWindow
                        ? `Leave blank to work it out from the date. Their current window is ${fmtWindow(logSelectedWindow)}.`
                        : "Leave blank to work it out from the production date."}
                    </span>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="log-note">Note for the crew</label>
                <textarea
                  id="log-note"
                  rows={2}
                  value={logging.note}
                  onChange={(e) => setLogging({ ...logging, note: e.target.value })}
                  placeholder="Parking, on-site contact, anything the videographer needs."
                />
              </div>

              <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={logging.notifyClient}
                    onChange={(e) =>
                      setLogging({ ...logging, notifyClient: e.target.checked })
                    }
                  />
                  <span className="muted">Email the client a confirmation</span>
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={logging.notifyTeam}
                    onChange={(e) =>
                      setLogging({ ...logging, notifyTeam: e.target.checked })
                    }
                  />
                  <span className="muted">Post to the Video Editing Campfire</span>
                </label>
                {!logging.outOfCycle && logging.status === "sent" ? (
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={logging.advanceAnchor}
                      onChange={(e) =>
                        setLogging({ ...logging, advanceAnchor: e.target.checked })
                      }
                    />
                    <span className="muted">
                      Move their last production date to this one
                    </span>
                  </label>
                ) : null}
              </div>

              {!logging.outOfCycle && logging.status === "sent" && logging.advanceAnchor && logSelectedCadence ? (
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  {logSelectedCadence === "monthly"
                    ? "Safe on a monthly client: every month has a window, so their next one stays where it is."
                    : "Careful on a " +
                      (logSelectedCadence === "quarterly" ? "quarterly" : "bi-monthly") +
                      " client. The cadence counts forward from the month of their last production, so this moves every future window."}
                </p>
              ) : null}

              {logError ? <p className="error">{logError}</p> : null}

              <div className="row" style={{ gap: 10 }}>
                <button className="btn" type="submit" disabled={logSaving}>
                  {logSaving ? "Saving..." : "Log production"}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setLogging(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openLog()}>
                + Log a production
              </button>
            </div>
          )
        ) : null}

        {tab === "reachouts" ? (
          <ReachoutLog reachouts={reachouts} loading={loading} today={today} />
        ) : null}

        {tab === "setup" ? (
          <>
        {/* Counts before the list, and each one filters. The question this page
            answers is "who needs me", so that reads first. */}
        <div className="pcon-chips">
          {([
            ["waiting", counts.waiting, "waiting on us"],
            ["due", counts.due, "due now"],
            ["asked", counts.asked, "asked, no booking"],
            ["ahead", counts.ahead, "booked ahead"],
            ["unset", counts.unset, "not set up"],
          ] as Array<[Exclude<StatusFilter, "all">, number, string]>).map(([key, n, label]) => (
            <button
              key={key}
              type="button"
              className="pcon-chip"
              aria-pressed={statusFilter === key}
              onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
            >
              <span className="n">{n}</span> {label}
            </button>
          ))}
          {statusFilter !== "all" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusFilter("all")}>
              Show all
            </button>
          ) : null}
        </div>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span className="muted">
            {colorFilter === "all"
              ? `${activeCount} active · ${enrolled.length} in production`
              : `${visible.length} ${colorLabel(colorFilter as ColorWeek)} client${visible.length === 1 ? "" : "s"}`}
          </span>
          <div className="row" style={{ gap: 16 }}>
            <label className="row" style={{ gap: 8 }}>
              <span className="muted">Color week</span>
              <select
                className="select-clean"
                style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}
                value={colorFilter}
                onChange={(e) => setColorFilter(e.target.value as ColorWeek | "all")}
              >
                <option value="all">All colors</option>
                <option value="purple">Purple</option>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
              </select>
            </label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              <span className="muted">Show inactive</span>
            </label>
          </div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Videographers
            </span>
            {isAdmin ? (
              <button className="btn btn-ghost btn-sm" onClick={addVideographer}>+ Add videographer</button>
            ) : null}
            <span className="muted" style={{ fontSize: 12 }}>
              One production per day each. A booked day blocks that videographer&apos;s other clients.
            </span>
          </div>
          {videographers.length ? (
            <div className="stack" style={{ gap: 6 }}>
              {videographers.map((v) => {
                const off = daysOff(v);
                return (
                  <div key={v.id} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, minWidth: 120 }}>{v.name}</span>
                    {isAdmin ? (
                      <span className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: 12 }}>Shoots on</span>
                        {WEEKDAYS.map((d) => {
                          const available = !off.includes(d.n);
                          return (
                            <button
                              key={d.n}
                              type="button"
                              className={`btn btn-sm ${available ? "btn-secondary" : "btn-ghost"}`}
                              title={
                                available
                                  ? `${v.name} shoots on ${d.label}. Click to make it a standing day off.`
                                  : `${v.name} never shoots on ${d.label}. Click to open it back up.`
                              }
                              style={available ? undefined : { textDecoration: "line-through", opacity: 0.5 }}
                              onClick={() =>
                                setDaysOff(
                                  v.id,
                                  available ? [...off, d.n] : off.filter((n) => n !== d.n)
                                )
                              }
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {off.length
                          ? `No ${off.map((n) => WEEKDAYS.find((d) => d.n === n)?.label || n).join(", ")}`
                          : "Every weekday"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>None yet.</span>
          )}
        </div>

        {bc ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between", gap: 12 }}>
            <span className="row" style={{ gap: 8 }}>
              <span
                className="color-dot"
                style={{ background: bc.connected ? "var(--success)" : "var(--border-strong)" }}
              />
              <strong>Basecamp</strong>
              <span className="muted">
                {bc.connected
                  ? bc.identity
                    ? `Reminders and approval cards post as ${bc.identity.name}.`
                    : "Connected. Scheduling cards post to each client's project."
                  : bc.configured
                    ? "Not connected yet."
                    : "Not configured. Add the Basecamp integration keys on the server."}
              </span>
              {/* The shared connection is supposed to be the mascot account. If
                  it is somebody's own login, everything automated is going out
                  under their name and they should know. */}
              {bc.personalLoginInUse ? (
                <span className="error" style={{ fontSize: 12 }}>
                  This is {bc.personalLoginInUse.name}&apos;s personal Basecamp
                  login. Reconnect as the mascot account so automated posts are
                  not attributed to them.
                </span>
              ) : null}
            </span>
            {bc.configured && !bc.connected ? (
              <a className="btn btn-sm" href="/api/basecamp/connect">Connect Basecamp</a>
            ) : null}
            {bc.connected ? (
              <span className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={autoMatch}>Auto-match projects</button>
                <button
                  className="btn btn-sm"
                  onClick={() => runMatch({ createMissing: true, dryRun: true })}
                >
                  Import clients from Basecamp
                </button>
                <button className="btn btn-ghost btn-sm" onClick={disconnectBc}>Disconnect</button>
              </span>
            ) : null}
          </div>
        ) : null}
        {matchMsg ? <p className="muted" style={{ marginTop: -6 }}>{matchMsg}</p> : null}

        {importPreview ? (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <strong>Preview: nothing has been changed yet</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
              {importPreview.linked.length} existing clients would be linked to a project,{" "}
              {importPreview.created.length} new clients would be created,{" "}
              {importPreview.skippedInternal.length} internal projects skipped.
            </p>
            {importPreview.created.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>New clients to create ({importPreview.created.length})</summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.created.map((c) => (
                    <li key={c.project}>{c.client}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.linked.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>Existing clients to link ({importPreview.linked.length})</summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.linked.map((c) => (
                    <li key={c.client}>
                      {c.client} → {c.project}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.ambiguous.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>
                  Ambiguous, left alone ({importPreview.ambiguous.length}) — set these by hand
                </summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.ambiguous.map((a) => (
                    <li key={a.client}>
                      {a.client}: {a.options.join(" | ")}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.noProject.length ? (
              <details style={{ marginBottom: 12 }}>
                <summary>No Basecamp project found ({importPreview.noProject.length})</summary>
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.noProject.join(", ")}
                </p>
              </details>
            ) : null}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm"
                onClick={() => runMatch({ createMissing: true, dryRun: false })}
              >
                Apply these changes
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setImportPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="empty"><p>No clients to show.</p></div>
        ) : (
          <div className="pcon-list">
            {visible.map((r) => {
              const c = r.client;
              const open = openRow === c.id;
              return (
                <div
                  key={c.id}
                  className="pcon-band"
                  data-week={c.color_week}
                  style={{ opacity: c.active ? 1 : 0.55 }}
                >
                  <div className="pcon-rail" aria-hidden="true" />
                  <div className="pcon-in">
                    <div className="pcon-who">
                      {editableField(r, "name", "text", c.name, <h3>{c.name}</h3>)}
                      <p className="pcon-meta">
                        {editableField(
                          r, "color_week", "select", c.color_week,
                          <span>{c.color_week ? `${colorLabel(c.color_week).toLowerCase()} week` : "no colour week"}</span>,
                          COLOR_OPTIONS
                        )}
                        {" · "}
                        {editableField(
                          r, "production_cadence", "select", c.production_cadence,
                          <span>{c.production_cadence ? CADENCE_LABEL[c.production_cadence].toLowerCase() : "no cadence"}</span>,
                          CADENCE_OPTIONS
                        )}
                        {" · "}
                        {editableField(
                          r, "account_manager", "select", c.account_manager,
                          <span>{c.account_manager || "no manager"}</span>,
                          ACCOUNT_MANAGER_OPTIONS
                        )}
                        {" · "}
                        {editableField(
                          r, "videographer_id", "select", c.videographer_id,
                          <span>{vidName(c.videographer_id) || "no videographer"}</span>,
                          vidOptions
                        )}
                      </p>
                    </div>

                    {r.window ? (
                      <div className="pcon-strip">
                        <div className="pcon-mon">{monthOf(r.window.start)}</div>
                        <div className="pcon-cells">
                          {windowDays(r.window).map((d, i) => {
                            const booked = r.existingSend?.sendDate === d;
                            const past = Boolean(today) && d < today;
                            const cls = booked ? "is-on" : past ? "is-gone" : "is-open";
                            return (
                              <div
                                key={d}
                                className={`pcon-cell ${cls}`}
                                title={
                                  booked
                                    ? `Booked ${fmtDate(d)}`
                                    : past
                                      ? `${fmtDate(d)} has passed`
                                      : `${fmtDate(d)} is open`
                                }
                              >
                                <span className="dow">{DOW_LETTER[i]}</span>
                                <span className="dnum">{dayNumber(d)}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="pcon-when">{whenLabel(r.window, today)}</div>
                      </div>
                    ) : (
                      <p className="pcon-nowindow">
                        No window until a colour week and cadence are set.
                      </p>
                    )}

                    <div className="pcon-facts">
                      <div className="pcon-line">
                        <span className="k">Last shoot</span>
                        {editableField(
                          r, "last_production_date", "date", c.last_production_date || "",
                          <span className="v">{fmtDate(c.last_production_date)}</span>
                        )}
                      </div>
                      {r.existingSend ? (
                        <div className="pcon-line">
                          <span className="k">Booked</span>
                          <span className="v">{fmtDate(r.existingSend.sendDate)}</span>
                        </div>
                      ) : null}
                      {outreachCount(r) > 0 ? (
                        <div className="pcon-line">
                          <span className="k">Outreach</span>
                          <span className="v">
                            {r.currentReachoutLast
                              ? `${fmtDate(r.currentReachoutLast.ymd)} (${REACHOUT_LABEL[r.currentReachoutLast.channel]})`
                              : r.lastEmailSent
                                ? fmtDate(r.lastEmailSent)
                                : "sent"}
                            {outreachCount(r) > 1 ? `, ${outreachCount(r)}x` : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="pcon-act">
                      {/* A client who has been asked and has not booked reads as
                          "Not due yet" on status alone, which looks like nothing
                          has happened. Say the ask happened instead: it is the
                          thing you need to know when deciding whether to chase.
                          Reminders start 21 days before a window opens, so this
                          state is normal for three weeks while status still,
                          truthfully, says the window has not started. */}
                      {r.overridden ? (
                        // Hand-set, so it wins over everything the row could
                        // work out for itself. The real status stays in the
                        // tooltip: a pinned row should never be able to lie
                        // about what the cadence engine thinks.
                        <span
                          className={`pcon-pill ${TONE[r.status]}`}
                          title={`Set by hand to "${STATUS_LABEL[r.status]}". Actual status is "${STATUS_LABEL[r.realStatus]}". ${
                            HANDLED.includes(r.status)
                              ? "Outreach is stopped while this is set."
                              : "Outreach continues."
                          } Set it back to Automatic in the row below.`}
                        >
                          {STATUS_LABEL[r.status]} (set)
                        </span>
                      ) : !r.existingSend && outreachCount(r) > 0 ? (
                        <span
                          className="pcon-pill is-warn"
                          title={`Outreach sent ${outreachCount(r)} time${outreachCount(r) === 1 ? "" : "s"}${
                            r.currentReachoutLast
                              ? `, last on ${fmtDate(r.currentReachoutLast.ymd)} by ${REACHOUT_LABEL[r.currentReachoutLast.channel].toLowerCase()}`
                              : r.lastEmailSent
                                ? `, last on ${fmtDate(r.lastEmailSent)}`
                                : ""
                          }. ${STATUS_LABEL[r.status]}. Waiting on them to book.`}
                        >
                          Outreach sent{outreachCount(r) > 1 ? ` ${outreachCount(r)}x` : ""}
                        </span>
                      ) : (
                        <span className={`pcon-pill ${TONE[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      )}
                      {c.outreach_paused ? (
                        <span
                          className="pcon-pill is-bad"
                          title="Outreach is paused by hand. This client gets no emails and no Basecamp nudges until it is switched back on."
                        >
                          Paused
                        </span>
                      ) : null}
                      {r.existingSend ? (
                        <Link className="btn btn-secondary btn-sm" href={`/admin/production/${r.existingSend.id}`}>
                          Open
                        </Link>
                      ) : isAdmin ? (
                        <button className="btn btn-secondary btn-sm" onClick={() => openLog(c.id)}>
                          {r.window ? "Log a shoot" : "Request extra"}
                        </button>
                      ) : null}
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-expanded={open}
                        onClick={() => setOpenRow(open ? null : c.id)}
                      >
                        {open ? "Less" : "More"}
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="pcon-more">
                      <div>
                        <span className="k">Contact</span>
                        <div className="v">
                          {isAdmin ? (
                            <ContactPicker
                              client={c}
                              roster={people[c.id]}
                              onOpen={() => loadPeople(c.id)}
                              onPick={(person) => pickContact(c.id, person)}
                            />
                          ) : (
                            <span>{c.contact_name || "Not set"}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="k">Email</span>
                        <div className="v">
                          {editableField(r, "contact_email", "text", c.contact_email,
                            <span>{c.contact_email || "Not set"}</span>)}
                        </div>
                      </div>
                      <div>
                        <span className="k">Active</span>
                        <div className="v">
                          {editableField(r, "active", "select", c.active ? "1" : "0",
                            <span>{c.active ? "Yes" : "No"}</span>, ACTIVE_OPTIONS)}
                        </div>
                      </div>
                      <div>
                        <span className="k">Basecamp project</span>
                        <div className="v">
                          {editableField(r, "basecamp_project_id", "text", c.basecamp_project_id,
                            <span>{c.basecamp_project_id || "Not set"}</span>)}
                        </div>
                      </div>
                      <div>
                        <span className="k">Window emailed</span>
                        <div className="v">{r.lastWindowEmailed ? fmtDate(r.lastWindowEmailed) : "Never"}</div>
                      </div>
                      {isAdmin ? (
                        <div>
                          <span className="k">Status</span>
                          <div className="v">
                            {editableField(
                              r, "status_override", "select", c.status_override || "",
                              <span>
                                {c.status_override
                                  ? `${STATUS_LABEL[r.status]} (set by hand${
                                      HANDLED.includes(r.status)
                                        ? ", outreach stopped"
                                        : ""
                                    })`
                                  : `${STATUS_LABEL[r.realStatus]} (automatic)`}
                              </span>,
                              STATUS_OVERRIDE_OPTIONS
                            )}
                          </div>
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div>
                          <span className="k">Outreach</span>
                          <div className="v">
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setOutreachPaused(c.id, !c.outreach_paused)
                              }
                              title={
                                c.outreach_paused
                                  ? "Start emailing and posting Basecamp nudges again."
                                  : "Stop all automated outreach for this client until you switch it back on."
                              }
                            >
                              {c.outreach_paused ? "Resume outreach" : "Pause outreach"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <span className="k">Last contacted</span>
                        <div className="v">
                          {r.lastReachout ? (
                            <span title={r.lastReachout.detail || undefined}>
                              {fmtDate(r.lastReachout.ymd)}{" "}
                              <span className="muted">
                                ({REACHOUT_LABEL[r.lastReachout.channel]})
                              </span>
                            </span>
                          ) : (
                            "Never"
                          )}
                        </div>
                      </div>
                      {isAdmin ? (
                        <div>
                          <span className="k">Extra production</span>
                          <div className="v">
                            {r.openExtraRequest ? (
                              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <span className="pcon-pill is-warn">
                                  Asked: {fmtDate(r.openExtraRequest.windowStart)} – {fmtDate(r.openExtraRequest.windowEnd)}
                                </span>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  disabled={extraAskBusyId === r.openExtraRequest.id}
                                  onClick={() => resendExtraAsk(r.openExtraRequest!.id)}
                                >
                                  Resend
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  disabled={extraAskBusyId === r.openExtraRequest.id}
                                  onClick={() => cancelExtraAsk(r.openExtraRequest!.id)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : extraAsk?.clientId === c.id ? (
                              <form className="stack" style={{ gap: 10, maxWidth: 420 }} onSubmit={submitExtraAsk}>
                                <div className="rev-form-grid">
                                  <div className="field">
                                    <label htmlFor={`extra-start-${c.id}`}>Window start</label>
                                    <input
                                      id={`extra-start-${c.id}`}
                                      type="date"
                                      value={extraAsk.windowStart}
                                      onChange={(e) => setExtraAsk({ ...extraAsk, windowStart: e.target.value })}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor={`extra-end-${c.id}`}>Window end</label>
                                    <input
                                      id={`extra-end-${c.id}`}
                                      type="date"
                                      value={extraAsk.windowEnd}
                                      onChange={(e) => setExtraAsk({ ...extraAsk, windowEnd: e.target.value })}
                                    />
                                  </div>
                                </div>
                                <div className="field">
                                  <label htmlFor={`extra-note-${c.id}`}>Note (optional)</label>
                                  <textarea
                                    id={`extra-note-${c.id}`}
                                    rows={2}
                                    value={extraAsk.note}
                                    onChange={(e) => setExtraAsk({ ...extraAsk, note: e.target.value })}
                                    placeholder="Anything to tell the client about why this one's extra."
                                  />
                                </div>
                                {extraAskError ? <p className="error">{extraAskError}</p> : null}
                                <div className="row" style={{ gap: 10 }}>
                                  <button className="btn btn-sm" type="submit" disabled={extraAskSaving}>
                                    {extraAskSaving ? "Sending..." : "Send Basecamp card + email"}
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => setExtraAsk(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <button className="btn btn-secondary btn-sm" onClick={() => openExtraAsk(c.id)}>
                                Ask to schedule
                              </button>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div>
                          <span className="k">Scheduling link</span>
                          <div className="v">
                            {c.color_week && c.production_cadence ? (
                              <button className="btn btn-ghost btn-sm" onClick={() => copyLink(c.id)}>
                                Copy link
                              </button>
                            ) : (
                              <span className="muted">Needs a colour week first</span>
                            )}
                            {linkMessage[c.id] ? (
                              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                                {linkMessage[c.id]}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div>
                          {/* This acts on the CLIENT, not on a production. It
                              sits near the per-production Archive and Delete
                              actions, so the label has to name its object. */}
                          <span className="k">Whole client</span>
                          <div className="v">
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (confirm(`Take ${c.name} out of production scheduling altogether? They keep every record, they just stop getting production windows and reminders. This is not the same as archiving one production.`)) {
                                  setEnrolled(c.id, false);
                                }
                              }}
                            >
                              Stop scheduling this client
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="pcon-legend">
          <span><i className="pcon-sw is-on" /> booked</span>
          <span><i className="pcon-sw is-open" /> open to book</span>
          <span><i className="pcon-sw is-gone" /> day has passed</span>
          <span>The left edge of each row is the client&apos;s colour week.</span>
        </div>

        {isAdmin && removed.length > 0 ? (
          <div className="card card-pad stack">
            <strong>Removed from production ({removed.length})</strong>
            <p className="muted" style={{ margin: 0 }}>
              These clients are kept in full but don&apos;t get productions or reminders.
              Add one back anytime.
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {removed.map((r) => (
                <span key={r.client.id} className="removed-chip">
                  {r.client.name}
                  <button className="btn btn-ghost btn-sm" onClick={() => setEnrolled(r.client.id, true)}>
                    Add to production
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
          </>
        ) : tab === "awaiting" ? (
          loading ? (
            <p className="muted">Loading...</p>
          ) : awaiting.length === 0 ? (
            <div className="empty">
              <p>Nobody is waiting. Every client who has been asked has booked.</p>
            </div>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
                Asked and still not booked, most chased first. The tally counts
                outreach for their current window only, so it resets when the
                window moves on.
              </p>
              <div className="pcon-list">
                {awaiting.map((r) => {
                  const c = r.client;
                  return (
                    <div key={c.id} className="pcon-band" data-week={c.color_week}>
                      <div className="pcon-rail" aria-hidden="true" />
                      <div className="pcon-in">
                        <div className="pcon-who">
                          <h3>{c.name}</h3>
                          <p className="pcon-meta">
                            {c.contact_name || "no contact"}
                            {" · "}
                            {c.color_week ? `${colorLabel(c.color_week).toLowerCase()} week` : "no colour week"}
                            {" · "}
                            {c.account_manager || "no manager"}
                          </p>
                        </div>

                        {r.window ? (
                          <div className="pcon-strip">
                            <div className="pcon-mon">{monthOf(r.window.start)}</div>
                            <div className="pcon-cells">
                              {windowDays(r.window).map((d, i) => {
                                const past = Boolean(today) && d < today;
                                return (
                                  <div
                                    key={d}
                                    className={`pcon-cell ${past ? "is-gone" : "is-open"}`}
                                    title={fmtDate(d)}
                                  >
                                    <span className="dow">{DOW_LETTER[i]}</span>
                                    <span className="dnum">{dayNumber(d)}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="pcon-when">{whenLabel(r.window, today)}</div>
                          </div>
                        ) : null}

                        <div className="pcon-facts">
                          <div className="pcon-line">
                            <span className="k">Asked</span>
                            <span className="v">
                              {outreachCount(r)} time
                              {outreachCount(r) === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="pcon-line">
                            <span className="k">Last</span>
                            <span className="v">
                              {r.currentReachoutLast
                                ? `${fmtDate(r.currentReachoutLast.ymd)} (${REACHOUT_LABEL[r.currentReachoutLast.channel]})`
                                : r.lastEmailSent
                                  ? fmtDate(r.lastEmailSent)
                                  : "unknown"}
                            </span>
                          </div>
                        </div>

                        <div className="pcon-act">
                          <span className="pcon-pill is-warn">
                            Outreach sent{outreachCount(r) > 1 ? ` ${outreachCount(r)}x` : ""}
                          </span>
                          {isAdmin ? (
                            <>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => copyLink(c.id)}
                              >
                                Copy link
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => openLog(c.id)}
                              >
                                Log a shoot
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {linkMessage[c.id] ? (
                        <div className="pcon-more">
                          <div><span className="k">Scheduling link</span>
                            <div className="v">{linkMessage[c.id]}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )
        ) : (
          <ProductionQueue
            productions={visibleProductions}
            loading={loading}
            isAdmin={isAdmin}
            onCancel={(id) => setCancelled(id, true)}
            onRestore={(id) => setCancelled(id, false)}
            onDelete={removeProduction}
            emptyLabel={
              tab === "requested"
                ? "No bookings are waiting for your confirmation."
                : tab === "cancelled"
                  ? "Nothing cancelled."
                  : "No productions have been confirmed yet."
            }
          />
        )}
      </main>
    </div>
  );
}

// Every outbound contact, newest first, grouped by the day it went out.
//
// This is the surface that answers "who did we reach out to". The sweep touches
// clients on three channels and only the email channel was ever reported, so a
// run that chased six clients on Basecamp read as having contacted nobody.
function ReachoutLog({
  reachouts,
  loading,
  today,
}: {
  reachouts: Reachout[];
  loading: boolean;
  today: string;
}) {
  if (loading) return <p className="muted">Loading reach-outs...</p>;
  if (!reachouts.length) {
    return (
      <div className="empty">
        <p>No reach-outs logged yet.</p>
        <p className="muted">
          Every scheduling email, Basecamp card, and follow-up comment lands here
          once the next sweep runs.
        </p>
      </div>
    );
  }

  // Group by date. The API returns newest first, so insertion order is already
  // the order we want.
  const days = new Map<string, Reachout[]>();
  for (const r of reachouts) {
    const list = days.get(r.ymd) || [];
    list.push(r);
    days.set(r.ymd, list);
  }

  return (
    <div className="stack">
      {[...days].map(([ymd, items]) => {
        const clients = new Set(items.map((i) => i.client_id));
        return (
          <div key={ymd} className="card card-pad stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 className="h3" style={{ margin: 0 }}>
                {ymd === today ? "Today" : fmtDate(ymd)}
              </h2>
              <span className="muted">
                {clients.size} client{clients.size === 1 ? "" : "s"},{" "}
                {items.length} contact{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Channel</th>
                  <th>Sent to</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.client_name}</td>
                    <td>
                      <span className="pcon-pill is-quiet">
                        {REACHOUT_LABEL[r.channel]}
                      </span>
                    </td>
                    <td className="muted">{r.detail || "Not recorded"}</td>
                    <td className="muted">
                      {r.window_start ? fmtDate(r.window_start) : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// Pick the client contact from their Basecamp project's actual roster.
//
// A typed name had to match Basecamp exactly or the scheduling card was
// withheld and the client was never asked. Selecting from the real list makes
// that mistake unreachable, and stores the person's Basecamp id so a later
// rename on their side does not break the match either.
function ContactPicker({
  client,
  roster,
  onOpen,
  onPick,
}: {
  client: Client;
  roster?: { loading: boolean; people: BasecampPerson[]; reason?: string };
  onOpen: () => void;
  onPick: (person: BasecampPerson | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    const picked = client.basecamp_contact_id > 0;
    return (
      <span
        className="cell-clickable"
        title={
          picked
            ? "Picked from the Basecamp project. Click to change."
            : "Not picked from Basecamp, so this has to match a name on the project exactly. Click to pick from the roster."
        }
        role="button"
        tabIndex={0}
        onClick={() => {
          setEditing(true);
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
            onOpen();
          }
        }}
      >
        {client.contact_name || "Not set"}
        {client.contact_name && !picked ? (
          <span className="muted"> (typed)</span>
        ) : null}
      </span>
    );
  }

  if (roster?.loading) return <span className="muted">Loading roster...</span>;

  // No roster means the reason matters more than the control. Say what is wrong
  // rather than showing an empty dropdown.
  if (roster && !roster.people.length) {
    return (
      <span>
        <span className="muted">{roster.reason || "Nobody on that project."}</span>{" "}
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
    );
  }

  const clients = (roster?.people || []).filter((p) => p.isClient);
  const staff = (roster?.people || []).filter((p) => !p.isClient);

  return (
    <span className="cell-editing">
      <select
        autoFocus
        defaultValue={String(client.basecamp_contact_id || "")}
        onChange={(e) => {
          const id = Number(e.target.value);
          const person = (roster?.people || []).find((p) => p.id === id) || null;
          setEditing(false);
          onPick(person);
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="">Nobody picked</option>
        {clients.length ? (
          <optgroup label="On the client's side">
            {clients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.mentionable ? "" : " (cannot be mentioned)"}
              </option>
            ))}
          </optgroup>
        ) : null}
        {staff.length ? (
          <optgroup label="Our people">
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.mentionable ? "" : " (cannot be mentioned)"}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </span>
  );
}

function ProductionQueue({
  productions,
  loading,
  emptyLabel,
  isAdmin,
  onCancel,
  onRestore,
  onDelete,
}: {
  productions: Production[];
  loading: boolean;
  emptyLabel: string;
  isAdmin: boolean;
  onCancel: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string, clientName: string) => void;
}) {
  if (loading) return <p className="muted">Loading productions...</p>;
  if (!productions.length) {
    return (
      <div className="empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  // Same band shape as the client list, so moving between tabs doesn't feel
  // like moving between two different pages. The strip is a single day here,
  // because a booked production is one date rather than a range.
  return (
    <div className="pcon-list">
      {productions.map((production) => {
        const statusLabel = production.cancelled_at
          ? "Cancelled"
          : production.status === "requested"
            ? "Requested"
            : production.status === "sent"
              ? "Completed"
              : "Confirmed";
        const tone = production.cancelled_at
          ? "is-quiet"
          : production.status === "requested"
            ? "is-warn"
            : "is-good";
        return (
          <div key={production.id} className="pcon-band">
            <div className="pcon-rail" aria-hidden="true" />
            <div className="pcon-in">
              <div className="pcon-who">
                <h3>
                  {production.client_name}
                  {!production.cadence_window_start ? (
                    <span
                      className="pcon-pill is-quiet"
                      style={{ marginLeft: 8, verticalAlign: "middle" }}
                      title="Requested outside the client's regular cadence. Does not affect their normal schedule."
                    >
                      Out of cycle
                    </span>
                  ) : null}
                </h3>
                <p className="pcon-meta">
                  {production.duration === "full" ? "Full day" : "4 hours"}
                  {" · "}
                  {production.videographer || "no videographer"}
                  {" · "}
                  {production.account_manager || "no manager"}
                </p>
              </div>

              <div className="pcon-strip">
                <div className="pcon-mon">{monthOf(production.send_date)}</div>
                <div className="pcon-cells">
                  <div className="pcon-cell is-on" title={fmtDate(production.send_date)}>
                    <span className="dow">
                      {DOW_LETTER[
                        Math.min(
                          4,
                          Math.max(
                            0,
                            new Date(`${production.send_date}T00:00:00Z`).getUTCDay() - 1
                          )
                        )
                      ]}
                    </span>
                    <span className="dnum">{dayNumber(production.send_date)}</span>
                  </div>
                </div>
                <div className="pcon-when">{fmtTime(production.send_time)}</div>
              </div>

              <div className="pcon-facts">
                <div className="pcon-line">
                  <span className="k">Date</span>
                  <span className="v">{fmtDate(production.send_date)}</span>
                </div>
              </div>

              <div className="pcon-act">
                <span className={`pcon-pill ${tone}`}>{statusLabel}</span>
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/admin/production/${production.id}`}
                >
                  Open
                </Link>
                {isAdmin ? (
                  production.cancelled_at ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => onRestore(production.id)}>
                        Restore
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onDelete(production.id, production.client_name)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Cancel this production. The client goes back to needing one."
                      onClick={() => onCancel(production.id)}
                    >
                      Cancel
                    </button>
                  )
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
