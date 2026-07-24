"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { TodoList } from "@/components/TodoList";
import { ChatPreviewCard } from "@/components/ChatPreviewCard";
import { StrategyPanel } from "@/components/StrategyPanel";
import { FlagsPanel } from "@/components/FlagsPanel";

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

type Kpi = { key: string; label: string; fmt: string; hint: string | null; value: number | null };
type DeliverableOverview = { deliverable_id: string; category: string; name: string; status: string };
type Send = { id: string; title: string; send_date: string; status: string };
type ActivityItem = { kind: string; at: string; summary: string; detail: string };

type OkrStatus = "on_track" | "at_risk" | "off_track" | "achieved";
type KeyResult = { id: string; description: string; target: number; current: number; unit: string };
type Okr = {
  id: string;
  client_id: string;
  objective: string;
  keyResults: KeyResult[];
  target_date: string | null;
  status: OkrStatus;
};

type DashboardData = {
  client: { id: string; name: string; accountManager: string; tier: string };
  production: {
    window: { start: string; end: string } | null;
    status: CycleStatus;
    existingSend: { sendDate: string; status: string } | null;
  };
  snapshot: { token: string | null; overview: DeliverableOverview[] };
  accountData: { kpis: Kpi[] };
  calendar: Send[];
  activity: ActivityItem[];
  okrs: Okr[];
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured",
  inactive: "Inactive",
  not_due: "Not due yet",
  due: "Ready to book",
  requested: "Requested",
  scheduled: "Scheduled",
  sent: "Sent",
};
const STATUS_DOT: Record<CycleStatus, string> = {
  not_configured: "is-muted",
  inactive: "is-muted",
  not_due: "is-muted",
  due: "is-signal",
  requested: "is-signal",
  scheduled: "is-good",
  sent: "is-good",
};

const OKR_STATUS_LABEL: Record<OkrStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};
const OKR_ARC_FILL: Record<OkrStatus, number> = {
  on_track: 0.7,
  at_risk: 0.4,
  off_track: 0.15,
  achieved: 1,
};

const TIER_LABEL: Record<string, string> = {
  "": "No tier",
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};

function fmtDate(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtKpi(value: number | null, fmt: string): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (fmt === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  if (fmt === "percent") return `${(value * 100).toFixed(1)}%`;
  if (fmt === "multiple") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}

function fmtAt(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A URL detail collapses to its final path segment so the feed reads as
// "blue-sea-3000-hdseries-switch" instead of the full product URL. Non-URL
// details pass through untouched.
function shortDetail(detail: string): string {
  try {
    const u = new URL(detail);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : u.hostname;
  } catch {
    return detail;
  }
}

type ActivityGroup = {
  kind: string;
  summary: string;
  at: string;
  details: string[];
  count: number;
};

// Collapse consecutive activity items that share a kind + summary (e.g. a burst
// of reviewer comments on the same campaign) into a single grouped row. Items
// arrive newest-first, so the first timestamp in a run is the most recent.
function groupActivity(items: ActivityItem[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const a of items) {
    const last = groups[groups.length - 1];
    if (last && last.kind === a.kind && last.summary === a.summary) {
      last.count += 1;
      if (a.detail) last.details.push(a.detail);
    } else {
      groups.push({
        kind: a.kind,
        summary: a.summary,
        at: a.at,
        details: a.detail ? [a.detail] : [],
        count: 1,
      });
    }
  }
  return groups;
}

const ACTIVITY_PREVIEW = 6;

type Tab = "overview" | "flags" | "strategy" | "todos" | "messages" | "production" | "calendar" | "goals";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "flags", label: "Flags" },
  { key: "strategy", label: "Strategy" },
  { key: "todos", label: "To-dos" },
  { key: "messages", label: "Messages" },
  { key: "production", label: "Production" },
  { key: "calendar", label: "Campaign calendar" },
  { key: "goals", label: "Goals & OKRs" },
];

const FLAG_LABEL: Record<string, string> = { red: "Red flag", yellow: "Yellow flag", green: "Green flag" };

export default function ClientHubPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboardToken, setDashboardToken] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [activityOpen, setActivityOpen] = useState(true);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [flagStatus, setFlagStatus] = useState<"red" | "yellow" | "green" | null>(null);

  const loadFlagStatus = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}/flags`);
    if (!res.ok) return;
    const active = ((await res.json()).flags || []).filter((f: { resolved: number }) => !f.resolved);
    const order = { red: 0, yellow: 1, green: 2 } as const;
    const worst = active
      .map((f: { level: "red" | "yellow" | "green" }) => f.level)
      .sort((a: "red" | "yellow" | "green", b: "red" | "yellow" | "green") => order[a] - order[b])[0];
    setFlagStatus(worst || null);
  }, [id]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const res = await fetch(`/api/admin/clients/${id}/dashboard`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError("Could not load this client's hub.");
        setLoading(false);
        return;
      }
      setData(await res.json());
      setLoading(false);
    },
    [id, router]
  );

  useEffect(() => {
    load();
    loadFlagStatus();
  }, [load, loadFlagStatus]);

  useEffect(() => {
    fetch(`/api/admin/clients/${id}/dashboard-token`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDashboardToken(d.token));
  }, [id]);

  async function rotateToken() {
    const res = await fetch(`/api/admin/clients/${id}/dashboard-token`, { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setDashboardToken(d.token);
      setCopyMsg("Link rotated — old link no longer works.");
    }
  }

  function copyLink() {
    if (!dashboardToken) return;
    const url = `${window.location.origin}/dashboard/${dashboardToken}`;
    navigator.clipboard.writeText(url);
    setCopyMsg("Copied to clipboard.");
    setTimeout(() => setCopyMsg(""), 3000);
  }

  async function addOkr() {
    const objective = (prompt("Objective") || "").trim();
    if (!objective) return;
    const targetDate = (prompt("Target date (YYYY-MM-DD), or leave blank") || "").trim();
    const res = await fetch(`/api/okrs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, objective, targetDate: targetDate || null, keyResults: [] }),
    });
    if (res.ok) load({ silent: true });
  }

  async function addKeyResult(okr: Okr) {
    const description = (prompt("Key result") || "").trim();
    if (!description) return;
    const target = Number(prompt("Target value") || "0");
    const unit = (prompt("Unit (e.g. $, %, leave blank)") || "").trim();
    const keyResults = [
      ...okr.keyResults,
      { id: "", description, target: Number.isFinite(target) ? target : 0, current: 0, unit },
    ];
    const res = await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyResults }),
    });
    if (res.ok) load({ silent: true });
  }

  async function updateKeyResultCurrent(okr: Okr, krId: string, current: number) {
    const keyResults = okr.keyResults.map((kr) => (kr.id === krId ? { ...kr, current } : kr));
    await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyResults }),
    });
    load({ silent: true });
  }

  async function setOkrStatus(okr: Okr, status: OkrStatus) {
    await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load({ silent: true });
  }

  async function deleteOkr(okrId: string) {
    if (!confirm("Delete this OKR?")) return;
    await fetch(`/api/okrs/${okrId}`, { method: "DELETE" });
    load({ silent: true });
  }

  const snapshotDone = data?.snapshot.overview.filter((d) =>
    ["completed", "approved"].includes(d.status)
  ).length ?? 0;
  const snapshotTotal = data?.snapshot.overview.length ?? 0;

  const headlineKpi = data?.accountData.kpis[0] ?? null;
  const activeGoal = data?.okrs.find((o) => o.status !== "achieved") ?? data?.okrs[0] ?? null;

  const upcomingCalendar = useMemo(
    () => (data?.calendar || []).slice(0, 8),
    [data]
  );

  const activityGroups = useMemo(
    () => groupActivity(data?.activity || []),
    [data]
  );
  const visibleActivity = activityExpanded
    ? activityGroups
    : activityGroups.slice(0, ACTIVITY_PREVIEW);

  return (
    <div className="acct-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/clients" />
      </header>

      <section className="snap-hero" style={{ padding: "38px 0 30px" }}>
        <div className="snap-hero-inner">
          <p className="snap-hero-eyebrow">Client hub</p>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <h1 className="snap-hero-title" style={{ fontSize: "clamp(26px,4vw,38px)" }}>
                  {data?.client.name || "Client hub"}
                </h1>
                {flagStatus ? (
                  <button
                    className={`flag-pill flag-${flagStatus}`}
                    onClick={() => setTab("flags")}
                    title="View flags"
                  >
                    <span className="flag-dot" /> {FLAG_LABEL[flagStatus]}
                  </button>
                ) : null}
              </div>
              <p className="snap-hero-sub">
                {data ? `Managed by ${data.client.accountManager || "—"} · ${TIER_LABEL[data.client.tier] ?? "No tier"}` : ""}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={copyLink} disabled={!dashboardToken}>
                Copy client link
              </button>
              <button className="btn btn-secondary btn-sm" onClick={rotateToken}>
                Rotate link
              </button>
            </div>
          </div>
        </div>
      </section>

      <main className="container stack" style={{ gap: 22, paddingTop: 28, paddingBottom: 80 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : data ? (
          <>
            {copyMsg ? <p className="muted" style={{ margin: 0 }}>{copyMsg}</p> : null}

            <div className="acct-pulse">
              <div className="acct-pulse-item">
                <span className={`dot ${STATUS_DOT[data.production.status]}`} />
                <div><p className="k">Production</p><p className="v">{STATUS_LABEL[data.production.status]}</p></div>
              </div>
              <div className="acct-pulse-item">
                <span className={`dot ${snapshotTotal ? "is-good" : "is-muted"}`} />
                <div>
                  <p className="k">Snapshot</p>
                  <p className="v">{snapshotTotal ? `${snapshotDone}/${snapshotTotal} done` : "Not tracked"}</p>
                </div>
              </div>
              <div className="acct-pulse-item">
                <span className="dot is-signal" />
                <div>
                  <p className="k">{headlineKpi?.label || "Revenue"}</p>
                  <p className="v">{headlineKpi ? fmtKpi(headlineKpi.value, headlineKpi.fmt) : "—"}</p>
                </div>
              </div>
              <div className="acct-pulse-item">
                <span className={`dot ${activeGoal ? "is-ember" : "is-muted"}`} />
                <div>
                  <p className="k">Goals</p>
                  <p className="v">
                    {data.okrs.length
                      ? `${data.okrs.length} active · ${OKR_STATUS_LABEL[activeGoal!.status]}`
                      : "None set"}
                  </p>
                </div>
              </div>
            </div>

            <div className="acct-tabs">
              {TABS.map((t) => (
                <button key={t.key} className={tab === t.key ? "is-on" : ""} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <div className="stack" style={{ gap: 32 }}>
                <div className="acct-section">
                  <div className="acct-section-head"><h2 className="acct-section-title">Account data</h2></div>
                  <div className="kpi-grid">
                    {data.accountData.kpis.map((k) => (
                      <div key={k.key} className="kpi-tile">
                        <span className="kpi-label">{k.label}</span>
                        <span className="kpi-value">{fmtKpi(k.value, k.fmt)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="acct-section">
                  <div className="acct-section-head">
                    <h2 className="acct-section-title">Weekly snapshot</h2>
                    {data.snapshot.token ? (
                      <a className="acct-section-link" href={`/admin/snapshot/${data.client.id}`}>
                        Open snapshot editor →
                      </a>
                    ) : null}
                  </div>
                  <div className="card card-pad">
                    <p style={{ margin: 0, fontSize: 14 }}>
                      {snapshotTotal
                        ? `${snapshotDone} of ${snapshotTotal} deliverables completed this period.`
                        : "No deliverables tracked yet."}
                    </p>
                  </div>
                </div>

                <div className="acct-section">
                  <div className="acct-section-head">
                    <button
                      type="button"
                      className="acct-collapse-btn"
                      onClick={() => setActivityOpen((o) => !o)}
                      aria-expanded={activityOpen}
                    >
                      <span className={`acct-collapse-caret ${activityOpen ? "is-open" : ""}`} aria-hidden="true" />
                      <h2 className="acct-section-title">Activity</h2>
                      {activityGroups.length ? (
                        <span className="acct-count">{data.activity.length}</span>
                      ) : null}
                    </button>
                  </div>
                  {activityOpen ? (
                    <div className="card card-pad">
                      {activityGroups.length ? (
                        <>
                          <ul className="act-feed">
                            {visibleActivity.map((g, i) => (
                              <li key={i} className="act-item">
                                <span className={`act-dot ${g.kind}`} aria-hidden="true" />
                                <div className="act-body">
                                  <div className="act-summary">
                                    {g.summary}
                                    {g.count > 1 ? (
                                      <span className="act-badge">{g.count}</span>
                                    ) : null}
                                  </div>
                                  {g.details.length ? (
                                    <div className="act-detail" title={g.details.join("\n")}>
                                      {shortDetail(g.details[0])}
                                      {g.details.length > 1
                                        ? ` +${g.details.length - 1} more`
                                        : ""}
                                    </div>
                                  ) : null}
                                </div>
                                <span className="act-when">{fmtAt(g.at)}</span>
                              </li>
                            ))}
                          </ul>
                          {activityGroups.length > ACTIVITY_PREVIEW ? (
                            <button
                              type="button"
                              className="act-more"
                              onClick={() => setActivityExpanded((e) => !e)}
                            >
                              {activityExpanded
                                ? "Show less"
                                : `Show all ${activityGroups.length}`}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tab === "flags" ? (
              <FlagsPanel clientId={data.client.id} onChange={loadFlagStatus} />
            ) : null}

            {tab === "strategy" ? (
              <StrategyPanel clientId={data.client.id} onGenerated={() => setTab("todos")} />
            ) : null}

            {tab === "todos" ? (
              <div className="card card-pad">
                <TodoList clientId={data.client.id} title="Client to-dos" />
              </div>
            ) : null}

            {tab === "messages" ? (
              <div className="acct-msg-grid">
                <ChatPreviewCard
                  clientId={data.client.id}
                  kind="internal"
                  title="Internal thread"
                  tag="Team only"
                />
                <ChatPreviewCard
                  clientId={data.client.id}
                  kind="client"
                  title="Client thread"
                  tag="Visible to the client"
                />
              </div>
            ) : null}

            {tab === "production" ? (
              <div className="card card-pad row" style={{ justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontWeight: 600, margin: "0 0 4px" }}>{STATUS_LABEL[data.production.status]}</p>
                  {data.production.window ? (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      {data.production.existingSend
                        ? `Booked for ${fmtDate(data.production.existingSend.sendDate)}`
                        : `Next window: ${fmtDate(data.production.window.start)} – ${fmtDate(data.production.window.end)}`}
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Not configured.</p>
                  )}
                </div>
                <span className={`acct-pill ${STATUS_DOT[data.production.status] === "is-good" ? "is-good" : STATUS_DOT[data.production.status] === "is-signal" ? "is-signal" : "is-muted"}`}>
                  {STATUS_LABEL[data.production.status]}
                </span>
              </div>
            ) : null}

            {tab === "calendar" ? (
              <div className="stack" style={{ gap: 8 }}>
                {upcomingCalendar.length ? (
                  <div className="card card-pad">
                    {upcomingCalendar.map((s, i) => (
                      <div
                        key={s.id}
                        className="row"
                        style={i > 0 ? { marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" } : undefined}
                      >
                        <span>{s.title}</span>
                        <span className="muted" style={{ fontSize: 13 }}>{fmtDate(s.send_date)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty"><p>Nothing scheduled.</p></div>
                )}
              </div>
            ) : null}

            {tab === "goals" ? (
              <div className="stack" style={{ gap: 16 }}>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={addOkr}>+ Add OKR</button>
                </div>
                {data.okrs.length === 0 ? (
                  <div className="empty"><p>No goals tracked for this account yet.</p></div>
                ) : (
                  data.okrs.map((okr) => (
                    <div key={okr.id} className="card card-pad acct-okr-card">
                      <div className="acct-okr-top">
                        <div>
                          <p className="acct-okr-title">{okr.objective}</p>
                          <p className="acct-okr-meta">
                            {okr.target_date ? `Target: ${fmtDate(okr.target_date)}` : "No target date"}
                          </p>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <select
                            className="select-clean badge-select"
                            value={okr.status}
                            onChange={(e) => setOkrStatus(okr, e.target.value as OkrStatus)}
                          >
                            {Object.entries(OKR_STATUS_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          <button className="btn btn-ghost btn-sm" onClick={() => deleteOkr(okr.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="acct-goal-track" style={{ marginBottom: 14 }}>
                        <div className="acct-goal-fill" style={{ width: `${OKR_ARC_FILL[okr.status] * 100}%` }} />
                      </div>
                      <div>
                        {okr.keyResults.map((kr) => (
                          <div key={kr.id} className="acct-kr-row">
                            <span className="desc">{kr.description}</span>
                            <div className="track"><div className="fill" style={{ width: `${kr.target ? Math.min(100, (kr.current / kr.target) * 100) : 0}%` }} /></div>
                            <span className="num">{kr.current}{kr.unit} / {kr.target}{kr.unit}</span>
                            <input
                              type="number"
                              className="cell-input"
                              style={{ width: 70, marginLeft: 8 }}
                              defaultValue={kr.current}
                              onBlur={(e) => updateKeyResultCurrent(okr, kr.id, Number(e.target.value))}
                            />
                          </div>
                        ))}
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ width: "fit-content", marginTop: 10 }}
                          onClick={() => addKeyResult(okr)}
                        >
                          + Add key result
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
