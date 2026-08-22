"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import { teamLabel } from "@/lib/team";
import { ClientServicePanel } from "@/components/ClientServicePanel";

type AskStatus =
  | "paused"
  | "nothing_to_ask"
  | "not_sent"
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "submitted";

type Row = {
  clientId: string;
  name: string;
  accountManager: string;
  accountManagerEmail: string;
  contactName: string;
  contactEmail: string;
  paused: boolean;
  hasBasecamp: boolean;
  snapshotUrl: string;
  month: string;
  monthLabel: string;
  leadsWaiting: number;
  revenueIn: boolean;
  revenueAmount: number | null;
  submitted: boolean;
  status: AskStatus;
  emailSentAt: string | null;
  emailDeliveredAt: string | null;
  emailOpenedAt: string | null;
  emailBouncedAt: string | null;
  basecampSentAt: string | null;
};

type Summary = {
  weekStart: string;
  clients: number;
  sent: number;
  opened: number;
  submitted: number;
  waiting: number;
};

type Account = { id: string; name: string; deliverable_count: number };

type HistoryRow = {
  id: string;
  week_start: string;
  month: string;
  channel: string;
  am_label: string;
  sent_to: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
};

type Tab = "dashboard" | "accounts";

// Every way the list can be narrowed. The first three are always offered; the
// rest only appear once something actually falls into them, so the row of
// filters stays short on a healthy week.
type Filter =
  | "all"
  | "waiting"
  | "submitted"
  | "blocked"
  | "bounced"
  | "unassigned"
  | "paused";

const STATUS_LABEL: Record<AskStatus, string> = {
  paused: "Paused",
  nothing_to_ask: "Nothing to ask",
  not_sent: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  submitted: "Answered",
};

// Which tint a status gets. Answered is the only green: everything else is
// either in flight or needs a human.
const STATUS_TONE: Record<AskStatus, string> = {
  paused: "is-muted",
  nothing_to_ask: "is-muted",
  not_sent: "is-warn",
  sent: "is-info",
  delivered: "is-info",
  opened: "is-info",
  bounced: "is-bad",
  submitted: "is-good",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMoney(n: number | null): string {
  if (n === null) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtWeek(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A send can email the contact, post a Basecamp card, or both. Missing an
 * email address only loses the email, so the row that genuinely cannot be
 * reached is the one missing both routes. Keyed off contact_email rather than
 * contact_name, because the name is not what the send reads.
 */
function noRoute(row: Row): boolean {
  return !row.contactEmail.trim() && !row.hasBasecamp;
}

/** Emailing is off the table but a card can still land. */
function cardOnly(row: Row): boolean {
  return !row.contactEmail.trim() && row.hasBasecamp;
}

/**
 * Sort order is the order somebody should work the list: things that are
 * broken, then work we owe, then work the client owes, then everything already
 * settled. Inside a rank it falls back to the client name so the list never
 * reshuffles between loads.
 */
function urgency(row: Row): number {
  if (row.paused) return 6;
  if (row.emailBouncedAt) return 0;
  if (noRoute(row)) return 1;
  if (row.submitted) return 5;
  if (row.status === "nothing_to_ask") return 4;
  if (row.status === "not_sent") return 2;
  return 3;
}

export default function ClientServicesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [scopeTouched, setScopeTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingOn, setSendingOn] = useState(true);
  const isAdmin = role === "admin";

  async function load() {
    try {
      const res = await fetch("/api/client-services");
      if (res.status === 401) return router.push("/login");
      if (!res.ok) {
        setError("Could not load the dashboard.");
        return;
      }
      const data = await res.json();
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setSendingOn(data.sendingEnabled !== false);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    const res = await fetch("/api/snapshot/accounts");
    if (!res.ok) return;
    setAccounts((await res.json()).accounts || []);
  }

  useEffect(() => {
    load();
    loadAccounts();
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) {
          setRole(data.role);
          setPerson(data.person || null);
        }
      })
      .catch(() => {});
  }, []);

  // The label the rows carry is the account manager's display name, so the
  // signed-in person is matched by label rather than by slug.
  const myLabel = person ? teamLabel(person) : "";
  const mineCount = useMemo(
    () => (myLabel ? rows.filter((r) => r.accountManager === myLabel).length : 0),
    [rows, myLabel]
  );

  // Somebody who owns clients lands on their own list. The owner carries a null
  // person and everybody else with nothing assigned falls through to All, and
  // an explicit click always wins from then on.
  useEffect(() => {
    if (scopeTouched) return;
    setScope(mineCount > 0 ? "mine" : "all");
  }, [mineCount, scopeTouched]);

  function chooseScope(next: "mine" | "all") {
    setScopeTouched(true);
    setScope(next);
  }

  async function act(clientId: string, action: "send" | "pause" | "resume") {
    if (action === "send") {
      const row = rows.find((r) => r.clientId === clientId);
      const prompt = sendingOn
        ? `Send this week's snapshot ask to ${row?.contactName || row?.name} now?` +
          (row?.contactEmail ? `\n\nEmail: ${row.contactEmail}` : "")
        : `Sending is switched off, so nothing will actually go out.\n\n` +
          `Run the ask for ${row?.contactName || row?.name} and show what it would do?`;
      if (!confirm(prompt)) return;
    }
    setBusyId(clientId);
    setError("");
    setMessage("");
    const res = await fetch("/api/client-services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, clientId }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "That did not work.");
      return;
    }
    const data = await res.json();
    setRows(data.rows || []);
    setSummary(data.summary || null);
    if (typeof data.sendingEnabled === "boolean") setSendingOn(data.sendingEnabled);
    if (action === "send") {
      const r = data.result;
      const parts: string[] = [];
      if (r?.email?.ok) parts.push("emailed");
      else if (r?.email?.skipped) parts.push(`no email (${r.email.skipped})`);
      if (r?.basecamp?.ok) parts.push("Basecamp card posted");
      else if (r?.basecamp?.skipped) parts.push(`no card (${r.basecamp.skipped})`);
      setMessage(
        sendingOn
          ? parts.length
            ? `Done: ${parts.join(", ")}.`
            : "Nothing was sent."
          : "Sending is switched off, so nothing left the building. " +
            "Set CLIENT_SERVICES_SENDING=on to arm it."
      );
    } else {
      setMessage(action === "pause" ? "Outreach paused." : "Outreach resumed.");
    }
  }

  async function toggleHistory(clientId: string) {
    if (openId === clientId) {
      setOpenId(null);
      return;
    }
    setOpenId(clientId);
    setHistory([]);
    const res = await fetch(`/api/client-services?clientId=${clientId}`);
    if (res.ok) setHistory((await res.json()).history || []);
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin || !newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/revenue/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not add account.");
      return;
    }
    const data = await res.json();
    router.push(`/admin/snapshot/${data.client.id}`);
  }

  // Everything below is derived from this one scoped list, so the counts on the
  // filters and the triage cards always agree with the rows on screen.
  const scoped = useMemo(
    () =>
      scope === "mine" && myLabel
        ? rows.filter((r) => r.accountManager === myLabel)
        : rows,
    [rows, scope, myLabel]
  );

  const counts = useMemo(
    () => ({
      all: scoped.length,
      waiting: scoped.filter((r) => !r.submitted && !r.paused).length,
      submitted: scoped.filter((r) => r.submitted).length,
      blocked: scoped.filter((r) => !r.paused && noRoute(r)).length,
      bounced: scoped.filter((r) => Boolean(r.emailBouncedAt)).length,
      unassigned: scoped.filter((r) => !r.accountManager).length,
      paused: scoped.filter((r) => r.paused).length,
      cardOnly: scoped.filter((r) => !r.paused && cardOnly(r)).length,
      noReplyTo: scoped.filter((r) => r.accountManager && !r.accountManagerEmail)
        .length,
    }),
    [scoped]
  );

  const visible = useMemo(() => {
    const byFilter = scoped.filter((r) => {
      if (filter === "waiting") return !r.submitted && !r.paused;
      if (filter === "submitted") return r.submitted;
      if (filter === "blocked") return !r.paused && noRoute(r);
      if (filter === "bounced") return Boolean(r.emailBouncedAt);
      if (filter === "unassigned") return !r.accountManager;
      if (filter === "paused") return r.paused;
      return true;
    });
    const q = query.trim().toLowerCase();
    const searched = q
      ? byFilter.filter((r) =>
          [r.name, r.contactName, r.contactEmail, r.accountManager]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : byFilter;
    return [...searched].sort(
      (a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name)
    );
  }, [scoped, filter, query]);

  // Only the filters that have something in them, so a clean week does not show
  // a row of zeroes.
  const filterTabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "waiting", label: "Still waiting", count: counts.waiting },
    { key: "submitted", label: "Answered", count: counts.submitted },
    ...(counts.blocked
      ? [{ key: "blocked" as Filter, label: "Cannot reach", count: counts.blocked }]
      : []),
    ...(counts.bounced
      ? [{ key: "bounced" as Filter, label: "Bounced", count: counts.bounced }]
      : []),
    ...(counts.unassigned
      ? [
          {
            key: "unassigned" as Filter,
            label: "Unassigned",
            count: counts.unassigned,
          },
        ]
      : []),
    ...(counts.paused
      ? [{ key: "paused" as Filter, label: "Paused", count: counts.paused }]
      : []),
  ];

  // The triage strip. Each card is a real problem with a filter behind it, so
  // reading the page starts with what needs a person rather than with 64 rows.
  const triage: {
    key: Filter;
    n: number;
    title: string;
    note: string;
    tone?: string;
  }[] = [
    {
      key: "bounced" as Filter,
      n: counts.bounced,
      title: "bounced",
      note: "The address rejected the email. Fix it before the next sweep.",
      tone: "is-bad",
    },
    {
      key: "blocked" as Filter,
      n: counts.blocked,
      title: "cannot be reached",
      note: "No contact email and no Basecamp project, so a send does nothing.",
    },
    {
      key: "unassigned" as Filter,
      n: counts.unassigned,
      title: "unassigned",
      note: "No account manager, so replies land on the agency address.",
    },
  ].filter((t) => t.n > 0);

  const panel = panelId ? rows.find((r) => r.clientId === panelId) || null : null;

  const askedPct = summary && summary.clients ? (summary.sent / summary.clients) * 100 : 0;
  const answeredPct =
    summary && summary.clients ? (summary.submitted / summary.clients) * 100 : 0;

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/behind">
          Behind report
        </Link>
        {isAdmin && tab === "accounts" ? (
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add account"}
          </button>
        ) : null}
      </div>

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Client services</p>
          <h1 className="h1">Client Services Hub</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Every client&apos;s weekly snapshot in one place: what we asked them
            for, whether it reached them, and whether the numbers came back.
          </p>
        </div>

        <div className="tabs" role="tablist" aria-label="Client services views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "dashboard"}
            className={`tab ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            This week
            <span className="tab-count">{rows.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "accounts"}
            className={`tab ${tab === "accounts" ? "active" : ""}`}
            onClick={() => setTab("accounts")}
          >
            Deliverable setup
            <span className="tab-count">{accounts.length}</span>
          </button>
        </div>

        {!sendingOn ? (
          <div className="cs-disarmed">
            <strong>Sending is switched off.</strong>
            <span>
              The dashboard is live and the Friday sweep is not scheduled.
              Nothing is emailed to a client and no Basecamp card is posted,
              including from <em>Send now</em>, which reports what it would have
              done instead. Set <code>CLIENT_SERVICES_SENDING=on</code> on the
              service to arm it.
            </span>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}

        {tab === "dashboard" ? (
          loading ? (
            <p className="muted">Loading...</p>
          ) : (
            <>
              {summary ? (
                <div className="card cs-week">
                  <div className="cs-week-head">
                    <div>
                      <p className="cs-week-eyebrow">Week of</p>
                      <h2 className="cs-week-date">{fmtWeek(summary.weekStart)}</h2>
                    </div>
                    <p className="cs-week-line">
                      <strong>{summary.submitted}</strong> of{" "}
                      <strong>{summary.clients}</strong> clients have come back
                      with their numbers. <strong>{summary.waiting}</strong> are
                      still outstanding.
                    </p>
                  </div>

                  <div
                    className="cs-bar"
                    role="img"
                    aria-label={`${summary.sent} asked, ${summary.submitted} answered, out of ${summary.clients} clients`}
                  >
                    <span
                      className="cs-bar-fill is-asked"
                      style={{ width: `${askedPct}%` }}
                    />
                    <span
                      className="cs-bar-fill is-answered"
                      style={{ width: `${answeredPct}%` }}
                    />
                  </div>

                  <div className="cs-week-stats">
                    <div className="cs-stat">
                      <span className="cs-stat-n">
                        {summary.sent}
                        <span className="cs-of"> / {summary.clients}</span>
                      </span>
                      <span className="cs-stat-l">Asked</span>
                    </div>
                    <div className="cs-stat">
                      <span className="cs-stat-n">{summary.opened}</span>
                      <span className="cs-stat-l">
                        Opened
                        <button
                          type="button"
                          className="cs-hint"
                          title="Opens are approximate. Apple Mail loads images before anyone reads, which counts as an open, and a client who blocks images can read the whole thing and never register one. Answered is the number to trust."
                          aria-label="Why opens are approximate"
                        >
                          ?
                        </button>
                      </span>
                    </div>
                    <div className="cs-stat is-good">
                      <span className="cs-stat-n">{summary.submitted}</span>
                      <span className="cs-stat-l">Answered</span>
                    </div>
                    <div className="cs-stat is-warn">
                      <span className="cs-stat-n">{summary.waiting}</span>
                      <span className="cs-stat-l">Still waiting</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {triage.length ? (
                <div className="cs-triage">
                  <p className="cs-triage-head">Needs a person</p>
                  <div className="cs-triage-cards">
                    {triage.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`cs-triage-card ${t.tone || ""} ${
                          filter === t.key ? "active" : ""
                        }`}
                        onClick={() => setFilter(filter === t.key ? "all" : t.key)}
                      >
                        <span className="cs-triage-n">{t.n}</span>
                        <span className="cs-triage-t">{t.title}</span>
                        <span className="cs-triage-note">{t.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="cs-toolbar">
                {mineCount > 0 ? (
                  <div className="cs-scope" role="group" aria-label="Whose clients">
                    <button
                      type="button"
                      className={`cs-scope-b ${scope === "mine" ? "active" : ""}`}
                      onClick={() => chooseScope("mine")}
                    >
                      My clients
                      <span className="tab-count">{mineCount}</span>
                    </button>
                    <button
                      type="button"
                      className={`cs-scope-b ${scope === "all" ? "active" : ""}`}
                      onClick={() => chooseScope("all")}
                    >
                      Everyone
                      <span className="tab-count">{rows.length}</span>
                    </button>
                  </div>
                ) : null}

                <div className="cs-search">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search client, contact or manager"
                    aria-label="Search clients"
                  />
                </div>
              </div>

              <div className="tabs cs-filters" role="tablist" aria-label="Filter">
                {filterTabs.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`tab ${filter === f.key ? "active" : ""}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                    <span className="tab-count">{f.count}</span>
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <div className="empty">
                  <p>
                    {query.trim()
                      ? `Nothing matches "${query.trim()}".`
                      : "Nothing here for this filter."}
                  </p>
                </div>
              ) : (
                <div className="card cs-table-wrap">
                  <table className="table cs-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Account manager</th>
                        <th>This week</th>
                        <th>Outstanding</th>
                        <th>Progress</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const dead = noRoute(row);
                        const asked = Boolean(row.emailSentAt || row.basecampSentAt);
                        const landed = Boolean(
                          row.emailDeliveredAt || row.emailOpenedAt
                        );
                        return (
                          <Fragment key={row.clientId}>
                            <tr
                              className={[
                                row.paused ? "is-paused" : "",
                                dead && !row.paused ? "is-blocked" : "",
                                row.emailBouncedAt ? "is-bounced" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="cs-client"
                                  onClick={() => setPanelId(row.clientId)}
                                >
                                  {row.name}
                                </button>
                                {row.contactName ? (
                                  <div className="cs-sub">{row.contactName}</div>
                                ) : null}
                                {dead ? (
                                  <div className="cs-flag is-bad">
                                    No email, no Basecamp
                                  </div>
                                ) : cardOnly(row) ? (
                                  <div className="cs-flag is-warn">
                                    Basecamp card only
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {row.accountManager ? (
                                  <span>{row.accountManager}</span>
                                ) : (
                                  <span className="cs-gap">Unassigned</span>
                                )}
                                {row.accountManager && !row.accountManagerEmail ? (
                                  <div
                                    className="cs-sub cs-gap"
                                    title="Replies will go to the agency address until this manager has an email on their account."
                                  >
                                    No reply-to
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                <span className={`cs-pill ${STATUS_TONE[row.status]}`}>
                                  {STATUS_LABEL[row.status]}
                                </span>
                              </td>
                              <td>
                                <div className="cs-asked">
                                  <span
                                    className={
                                      row.leadsWaiting > 0 ? "cs-open" : "cs-done"
                                    }
                                  >
                                    {row.leadsWaiting > 0
                                      ? `${row.leadsWaiting} lead${row.leadsWaiting === 1 ? "" : "s"} to confirm`
                                      : "Leads confirmed"}
                                  </span>
                                  <span
                                    className={row.revenueIn ? "cs-done" : "cs-open"}
                                  >
                                    {row.revenueIn
                                      ? row.revenueAmount !== null
                                        ? `${fmtMoney(row.revenueAmount)} in`
                                        : "Revenue in"
                                      : `${row.monthLabel} revenue owed`}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div className="cs-rail" aria-hidden="true">
                                  <span className={`cs-step ${asked ? "on" : ""}`} />
                                  <span
                                    className={`cs-step ${
                                      row.emailBouncedAt ? "bad" : landed ? "on" : ""
                                    }`}
                                  />
                                  <span
                                    className={`cs-step ${row.submitted ? "good" : ""}`}
                                  />
                                </div>
                                <div className="cs-when">
                                  {row.emailBouncedAt ? (
                                    <span className="cs-when-bad">
                                      Bounced {fmtWhen(row.emailBouncedAt)}
                                    </span>
                                  ) : asked ? (
                                    <>
                                      <span>
                                        Asked{" "}
                                        {fmtWhen(
                                          row.emailSentAt || row.basecampSentAt
                                        )}
                                      </span>
                                      {row.emailOpenedAt ? (
                                        <span>
                                          Opened {fmtWhen(row.emailOpenedAt)}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="cs-gap">Not asked yet</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <div className="cs-actions">
                                  {isAdmin ? (
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      disabled={busyId === row.clientId || dead}
                                      title={
                                        dead
                                          ? "This client has no contact email and no Basecamp project, so there is nowhere for the ask to go. Add one on their account first."
                                          : undefined
                                      }
                                      onClick={() => act(row.clientId, "send")}
                                    >
                                      {busyId === row.clientId
                                        ? "Sending..."
                                        : row.emailSentAt || row.basecampSentAt
                                          ? "Send again"
                                          : "Send now"}
                                    </button>
                                  ) : null}
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => toggleHistory(row.clientId)}
                                  >
                                    {openId === row.clientId ? "Hide" : "History"}
                                  </button>
                                  {isAdmin ? (
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      disabled={busyId === row.clientId}
                                      onClick={() =>
                                        act(
                                          row.clientId,
                                          row.paused ? "resume" : "pause"
                                        )
                                      }
                                    >
                                      {row.paused ? "Resume" : "Pause"}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                            {openId === row.clientId ? (
                              <tr className="cs-history-row">
                                <td colSpan={6}>
                                  {history.length === 0 ? (
                                    <p className="muted cs-history-empty">
                                      Nothing sent to this client yet.
                                    </p>
                                  ) : (
                                    <table className="table cs-history">
                                      <thead>
                                        <tr>
                                          <th>Week</th>
                                          <th>Channel</th>
                                          <th>From</th>
                                          <th>Sent to</th>
                                          <th>Sent</th>
                                          <th>Delivered</th>
                                          <th>Opened</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {history.map((h) => (
                                          <tr key={h.id}>
                                            <td>{h.week_start}</td>
                                            <td>
                                              {h.channel === "email"
                                                ? "Email"
                                                : "Basecamp"}
                                            </td>
                                            <td>{h.am_label || "—"}</td>
                                            <td>{h.sent_to || "—"}</td>
                                            <td>{fmtWhen(h.sent_at) || "—"}</td>
                                            <td>
                                              {h.bounced_at
                                                ? "Bounced"
                                                : fmtWhen(h.delivered_at) || "—"}
                                            </td>
                                            <td>{fmtWhen(h.opened_at) || "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        ) : (
          <>
            {isAdmin && adding ? (
              <form className="card card-pad row" onSubmit={addAccount} style={{ gap: 8 }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Account name"
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "Adding..." : "Create"}
                </button>
              </form>
            ) : null}

            {accounts.length === 0 ? (
              <div className="empty">
                <p>No accounts yet. Add one to start.</p>
              </div>
            ) : (
              <div className="campaign-list">
                {accounts.map((a) => (
                  <Link
                    key={a.id}
                    href={`/admin/snapshot/${a.id}`}
                    className="campaign-item"
                  >
                    <div>
                      <h3>{a.name}</h3>
                      <div className="meta">
                        {a.deliverable_count} deliverable
                        {a.deliverable_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span className="btn btn-secondary btn-sm">Open</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {panel ? (
        <ClientServicePanel
          client={panel}
          isAdmin={isAdmin}
          sendingOn={sendingOn}
          sending={busyId === panel.clientId}
          onClose={() => setPanelId(null)}
          onSend={() => act(panel.clientId, "send")}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
