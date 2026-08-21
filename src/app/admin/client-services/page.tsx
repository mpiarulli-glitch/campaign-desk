"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";

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

const STATUS_LABEL: Record<AskStatus, string> = {
  paused: "Paused",
  nothing_to_ask: "Nothing to ask",
  not_sent: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  submitted: "Submitted",
};

// Which tint a status gets. Submitted is the only green: everything else is
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
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [filter, setFilter] = useState<"all" | "waiting" | "submitted">("all");
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
        if (data?.authenticated) setRole(data.role);
      })
      .catch(() => {});
  }, []);

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

  const visible = useMemo(() => {
    if (filter === "waiting") return rows.filter((r) => !r.submitted && !r.paused);
    if (filter === "submitted") return rows.filter((r) => r.submitted);
    return rows;
  }, [rows, filter]);

  const waitingCount = rows.filter((r) => !r.submitted && !r.paused).length;

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
            Client dashboard
            <span className="tab-count">{rows.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "accounts"}
            className={`tab ${tab === "accounts" ? "active" : ""}`}
            onClick={() => setTab("accounts")}
          >
            Account snapshots
            <span className="tab-count">{accounts.length}</span>
          </button>
        </div>

        {!sendingOn ? (
          <div className="cs-disarmed">
            <strong>Sending is switched off.</strong>
            <span>
              The dashboard is live and the Friday sweep is not scheduled. Nothing
              is emailed to a client and no Basecamp card is posted, including
              from <em>Send now</em>, which reports what it would have done
              instead. Set <code>CLIENT_SERVICES_SENDING=on</code> on the service
              to arm it.
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
                <div className="kpi-grid cs-kpis">
                  <div className="kpi-tile">
                    <span className="kpi-label">Week of</span>
                    <span className="kpi-value">{summary.weekStart}</span>
                  </div>
                  <div className="kpi-tile">
                    <span className="kpi-label">Asked this week</span>
                    <span className="kpi-value">
                      {summary.sent}
                      <span className="cs-of"> / {summary.clients}</span>
                    </span>
                  </div>
                  <div className="kpi-tile">
                    <span className="kpi-label">Opened</span>
                    <span className="kpi-value">{summary.opened}</span>
                  </div>
                  <div className="kpi-tile">
                    <span className="kpi-label">Submitted</span>
                    <span className="kpi-value">{summary.submitted}</span>
                  </div>
                  <div className="kpi-tile">
                    <span className="kpi-label">Still waiting</span>
                    <span className="kpi-value">{summary.waiting}</span>
                  </div>
                </div>
              ) : null}

              <p className="cs-caveat">
                Opens are approximate. Apple Mail loads images for people before
                they read anything, which counts as an open, and a client who
                blocks images can read the whole thing and never register one.
                Submitted is the number to trust.
              </p>

              <div className="tabs cs-filters" role="tablist" aria-label="Filter">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "all"}
                  className={`tab ${filter === "all" ? "active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  All
                  <span className="tab-count">{rows.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "waiting"}
                  className={`tab ${filter === "waiting" ? "active" : ""}`}
                  onClick={() => setFilter("waiting")}
                >
                  Still waiting
                  <span className="tab-count">{waitingCount}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "submitted"}
                  className={`tab ${filter === "submitted" ? "active" : ""}`}
                  onClick={() => setFilter("submitted")}
                >
                  Submitted
                  <span className="tab-count">
                    {rows.filter((r) => r.submitted).length}
                  </span>
                </button>
              </div>

              {visible.length === 0 ? (
                <div className="empty">
                  <p>Nothing here for this filter.</p>
                </div>
              ) : (
                <div className="card cs-table-wrap">
                  <table className="table cs-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Account manager</th>
                        <th>This week</th>
                        <th>Asked for</th>
                        <th>Sent</th>
                        <th>Opened</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => (
                        <Fragment key={row.clientId}>
                          <tr className={row.paused ? "is-paused" : ""}>
                            <td>
                              <Link
                                className="cs-client"
                                href={`/admin/snapshot/${row.clientId}`}
                              >
                                {row.name}
                              </Link>
                              {row.contactName ? (
                                <div className="cs-sub">{row.contactName}</div>
                              ) : (
                                <div className="cs-sub cs-gap">No contact set</div>
                              )}
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
                              <span
                                className={`cs-pill ${STATUS_TONE[row.status]}`}
                              >
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
                                    ? `${row.leadsWaiting} lead${row.leadsWaiting === 1 ? "" : "s"}`
                                    : "Leads in"}
                                </span>
                                <span
                                  className={row.revenueIn ? "cs-done" : "cs-open"}
                                >
                                  {row.revenueIn
                                    ? row.revenueAmount !== null
                                      ? `${fmtMoney(row.revenueAmount)} in`
                                      : "Revenue in"
                                    : `${row.monthLabel} revenue`}
                                </span>
                              </div>
                            </td>
                            <td>
                              {row.emailSentAt || row.basecampSentAt ? (
                                <div className="cs-channels">
                                  {row.emailSentAt ? (
                                    <span title={`Email sent ${row.emailSentAt}`}>
                                      Email {fmtWhen(row.emailSentAt)}
                                    </span>
                                  ) : null}
                                  {row.basecampSentAt ? (
                                    <span title={`Card posted ${row.basecampSentAt}`}>
                                      Basecamp {fmtWhen(row.basecampSentAt)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="cs-gap">Not yet</span>
                              )}
                            </td>
                            <td>
                              {row.emailBouncedAt ? (
                                <span className="cs-pill is-bad">Bounced</span>
                              ) : row.emailOpenedAt ? (
                                <span title={row.emailOpenedAt}>
                                  {fmtWhen(row.emailOpenedAt)}
                                </span>
                              ) : row.emailDeliveredAt ? (
                                <span className="cs-gap">Delivered</span>
                              ) : (
                                <span className="cs-gap">—</span>
                              )}
                            </td>
                            <td>
                              <div className="cs-actions">
                                {isAdmin ? (
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    disabled={busyId === row.clientId}
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
                                      act(row.clientId, row.paused ? "resume" : "pause")
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
                              <td colSpan={7}>
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
                      ))}
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
    </div>
  );
}
