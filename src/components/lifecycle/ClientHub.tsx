"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { operatorStatusLabel } from "@/lib/campaign-status";
import {
  EMAIL_PLATFORMS,
  emailPlatformLabel,
  previewLaunchTodos,
  type EmailPlatform,
  type PaceStatus,
} from "@/lib/email-launch";
import { hasOwnerToolsAccess } from "@/lib/people";
import { EmailAnalyticsPanel } from "./EmailAnalyticsPanel";
import { ClientWorkflowsPanel } from "./ClientWorkflowsPanel";

type HubWorkKind = "campaign" | "automation";

type HubSend = {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  assetType: string;
  kind: HubWorkKind;
};

type HubCampaign = {
  id: string;
  title: string;
  status: string;
  approvedChannel: string | null;
  updatedAt: string;
};

type HubActivity = {
  id: string;
  source: "calendar" | "campaign";
  kind: HubWorkKind;
  title: string;
  date: string | null;
  status: string;
  countsTowardQuota: boolean;
  delivered?: boolean;
  href: string | null;
};

type HubLaunchTodo = {
  id: string;
  title: string;
  dueDate: string | null;
  status: "open" | "done";
};

type HubClient = {
  id: string;
  name: string;
  quota: number;
  delivered: number;
  remaining: number;
  pace: PaceStatus;
  paceLabel: string;
  pipeline: string;
  pipelineLabel: string;
  launchDate: string | null;
  platform: EmailPlatform | null;
  ghlLinked: boolean;
  nextSend: HubSend | null;
  sends: HubSend[];
  campaigns: HubCampaign[];
  activity: HubActivity[];
  memberIds: string[];
  logoUrl: string | null;
  category: string;
  description: string;
  status: "active" | "behind";
  launch: {
    started: boolean;
    open: number;
    total: number;
    todos: HubLaunchTodo[];
  };
};

const AVATAR_COLORS = [
  "#d98b2b",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#0ea5e9",
  "#f59e0b",
  "#ec4899",
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

type HubPayload = {
  period: string;
  periodLabel: string;
  today: string;
  counts: { total: number; behind: number; onTrack: number; met: number; launching: number };
  clients: HubClient[];
  available: Array<{ id: string; name: string }>;
};

type Filter = "all" | "behind" | "on_track" | "launching";

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sendLabel(status: string): string {
  if (status === "scheduled") return "Scheduled";
  if (status === "planned") return "Planned";
  if (status === "requested") return "Requested";
  if (status === "sent") return "Sent";
  return status;
}

function kindLabel(kind: HubWorkKind): string {
  return kind === "automation" ? "Automation" : "Campaign";
}

function matchesClient(c: HubClient, id: string): boolean {
  return c.id === id || (c.memberIds || []).includes(id);
}

function metricLabel(c: HubClient): string {
  if (c.quota > 0) return `${c.delivered} of ${c.quota}`;
  if (c.campaigns.length === 1) return "1 Campaign";
  if (c.campaigns.length > 1) return `${c.campaigns.length} Campaigns`;
  return "No quota";
}

function paceStatus(c: HubClient): { label: string; tone: string } {
  if (c.pace === "behind") return { label: "Behind", tone: "is-behind" };
  if (c.pace === "met") return { label: "Met", tone: "is-met" };
  if (c.pace === "on_track") return { label: "On track", tone: "is-active" };
  if (c.launch.open > 0) return { label: "Launching", tone: "is-launch" };
  return { label: "No quota", tone: "is-muted" };
}

function ClientLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <span className="snap-pick-logo">
        <img
          src={logoUrl}
          alt=""
          width={40}
          height={40}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span
      className="snap-pick-logo is-initials"
      style={{ background: avatarColor(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function readClientParam(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("client") || "";
}

function writeClientParam(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("client", id);
  else url.searchParams.delete("client");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function PaceDot({ pace, launching }: { pace: PaceStatus; launching: boolean }) {
  const tone = launching && pace !== "behind" ? "launch" : pace;
  return <span className={`lh-dot is-${tone}`} aria-hidden="true" />;
}

function ClientCards({
  clients,
  onSelect,
}: {
  clients: HubClient[];
  onSelect: (id: string) => void;
}) {
  if (clients.length === 0) {
    return <p className="lh-empty">No clients match.</p>;
  }
  return (
    <div className="snap-pick-grid">
      {clients.map((c) => {
        const status = paceStatus(c);
        const pct =
          c.quota > 0 ? Math.min(100, Math.round((c.delivered / c.quota) * 100)) : 0;
        return (
          <button
            key={c.id}
            type="button"
            className={`snap-pick-card lh-pick-card is-pace-${c.pace}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="snap-pick-card-head">
              <ClientLogo name={c.name} logoUrl={c.logoUrl} />
              <div className="snap-pick-card-title">
                <h3>{c.name}</h3>
                {c.category ? <p className="snap-pick-card-cat">{c.category}</p> : null}
              </div>
              <PaceDot pace={c.pace} launching={c.launch.open > 0} />
            </div>
            <p className="snap-pick-card-desc">{c.description}</p>
            {c.quota > 0 ? (
              <div
                className={`lh-pick-bar is-${c.pace}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={c.quota}
                aria-valuenow={c.delivered}
                aria-label={`${c.delivered} of ${c.quota} emails sent for approval`}
              >
                <div className="lh-pick-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
            <div className="snap-pick-card-foot">
              <span className={`snap-pick-metric is-${c.pace}`}>{metricLabel(c)}</span>
              <span className={`snap-pick-status ${status.tone}`}>{status.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PlatformSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: EmailPlatform | "") => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      required
      onChange={(e) => onChange((e.target.value as EmailPlatform) || "")}
    >
      <option value="">Platform…</option>
      {EMAIL_PLATFORMS.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function LaunchForm({
  today,
  busy,
  error,
  submitLabel,
  onCreate,
  onCancel,
}: {
  today: string;
  busy: boolean;
  error: string;
  submitLabel?: string;
  onCreate: (launchDate: string, platform: EmailPlatform) => void;
  onCancel?: () => void;
}) {
  const [launchDate, setLaunchDate] = useState(today);
  const [platform, setPlatform] = useState<EmailPlatform | "">("");
  const preview = previewLaunchTodos(launchDate);
  return (
    <form
      className="lh-launch-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!launchDate || !platform) return;
        onCreate(launchDate, platform);
      }}
    >
      <label className="lh-field">
        <span>Launch date</span>
        <input
          type="date"
          required
          value={launchDate}
          onChange={(e) => setLaunchDate(e.target.value)}
        />
      </label>
      <label className="lh-field">
        <span>Platform</span>
        <PlatformSelect value={platform} onChange={setPlatform} />
      </label>
      <ul className="lh-preview">
        {preview.map((item) => (
          <li key={item.title}>
            <span>{item.title}</span>
            <span>{prettyDate(item.dueDate)}</span>
          </li>
        ))}
      </ul>
      {error ? <p className="lh-error">{error}</p> : null}
      <div className="lh-actions">
        <button type="submit" className="btn" disabled={busy || !platform || preview.length === 0}>
          {busy ? "Adding…" : submitLabel || "Add client"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function AddClientForm({
  available,
  today,
  onAdded,
}: {
  available: Array<{ id: string; name: string }>;
  today: string;
  onAdded: (clientId: string) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [mode, setMode] = useState<"launch" | "automations">("launch");
  const [launchDate, setLaunchDate] = useState(today);
  const [platform, setPlatform] = useState<EmailPlatform | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = mode === "launch" ? previewLaunchTodos(launchDate) : [];
  const canSubmit =
    mode === "automations"
      ? Boolean(clientId && !busy)
      : Boolean(clientId && launchDate && platform && preview.length && !busy);

  if (available.length === 0) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lifecycle/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "automations"
            ? { clientId, mode: "automations" }
            : { clientId, mode: "launch", launchDate, platform }
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not add that client.");
        return;
      }
      const added = clientId;
      setClientId("");
      setPlatform("");
      onAdded(added);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lh-add" onSubmit={(e) => void submit(e)}>
      <p className="lh-add-label">Add a client</p>
      <div className="lh-add-modes">
        <button
          type="button"
          className={`lh-add-mode ${mode === "launch" ? "on" : ""}`}
          onClick={() => setMode("launch")}
        >
          Campaign launch
        </button>
        <button
          type="button"
          className={`lh-add-mode ${mode === "automations" ? "on" : ""}`}
          onClick={() => setMode("automations")}
        >
          Automations only
        </button>
      </div>
      <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
        <option value="">Pick a client…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {mode === "launch" ? (
        <>
          <label className="lh-field">
            <span>Launch date</span>
            <input
              type="date"
              required
              value={launchDate}
              onChange={(e) => setLaunchDate(e.target.value)}
            />
          </label>
          <label className="lh-field">
            <span>Platform</span>
            <PlatformSelect value={platform} onChange={setPlatform} />
          </label>
          {clientId && preview.length ? (
            <ul className="lh-preview">
              {preview.map((item) => (
                <li key={item.title}>
                  <span>{item.title}</span>
                  <span>{prettyDate(item.dueDate)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="lh-card-note lh-add-hint">
          Adds them to Lifecycle without launch to-dos. Open the client to pull live GHL
          workflows.
        </p>
      )}
      {error ? <p className="lh-error">{error}</p> : null}
      <button type="submit" className="btn btn-sm" disabled={!canSubmit}>
        {busy ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

function ClientDetail({
  client,
  today,
  onChanged,
  canSeeOwnerTools,
}: {
  client: HubClient;
  today: string;
  onChanged: () => void;
  canSeeOwnerTools: boolean;
}) {
  const [launching, setLaunching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missingPlatform, setMissingPlatform] = useState<EmailPlatform | "">("");
  const [quotaDraft, setQuotaDraft] = useState(String(client.quota || ""));
  const [logTitle, setLogTitle] = useState("");
  const [logDate, setLogDate] = useState("");
  const [logStatus, setLogStatus] = useState<"sent" | "approved">("sent");
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState("");
  const [quotaError, setQuotaError] = useState("");
  const pct =
    client.quota > 0 ? Math.min(100, Math.round((client.delivered / client.quota) * 100)) : 0;

  useEffect(() => {
    setQuotaDraft(String(client.quota || ""));
    setQuotaError("");
  }, [client.id, client.quota]);

  async function saveQuota(raw: string) {
    const next = Math.max(0, Math.round(Number(raw || 0)));
    if (!Number.isFinite(next)) {
      setQuotaError("Enter a whole number.");
      setQuotaDraft(String(client.quota || ""));
      return;
    }
    if (next === client.quota) {
      setQuotaDraft(String(client.quota || ""));
      return;
    }
    setQuotaError("");
    const res = await fetch(`/api/lifecycle/hub/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quota: next }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setQuotaError(data.error || "Could not save that count.");
      setQuotaDraft(String(client.quota || ""));
      return;
    }
    onChanged();
  }

  async function submitLog(e: FormEvent) {
    e.preventDefault();
    const title = logTitle.trim();
    if (!title) {
      setLogError("Add a title.");
      return;
    }
    setLogging(true);
    setLogError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${client.id}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          sentOn: logDate || undefined,
          status: logStatus,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setLogError(data.error || "Could not log that campaign.");
        return;
      }
      setLogTitle("");
      setLogDate("");
      setLogStatus("sent");
      onChanged();
    } finally {
      setLogging(false);
    }
  }

  async function createLaunch(startDate: string, platform: EmailPlatform) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${client.id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchDate: startDate, platform }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 409) {
        setError(data.error || "Could not create those to-dos.");
        return;
      }
      setLaunching(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function savePlatform(platform: EmailPlatform) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${client.id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not save that platform.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTodo(todo: HubLaunchTodo) {
    const next = todo.status === "done" ? "open" : "done";
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  }

  const activity = client.activity || [];
  const thisMonth = activity.filter((a) => a.date);
  const inReview = activity.filter((a) => !a.date);
  const sentThisMonth = activity.filter((a) => a.status === "sent").length;
  const headerBits = [
    emailPlatformLabel(client.platform),
    client.launchDate ? `Launch ${prettyDate(client.launchDate)}` : "",
    client.nextSend
      ? `Next ${prettyDate(client.nextSend.date)}`
      : sentThisMonth
        ? `${sentThisMonth} sent this month`
        : "",
  ].filter(Boolean);

  return (
    <div className="lh-detail">
      <header className="lh-detail-head">
        <div>
          <h2>{client.name}</h2>
          {headerBits.length ? <p className="muted">{headerBits.join(" · ")}</p> : null}
        </div>
        <span className={`lh-pace is-${client.pace}`}>{client.paceLabel}</span>
      </header>

      <div className="lh-detail-layout">
      <section className="lh-card lh-quota">
        {client.quota > 0 ? (
          <>
            <p className="lh-quota-num">
              <strong>{client.delivered}</strong>
              <span> of {client.quota}</span>
            </p>
            <p className="lh-quota-label">campaign emails sent for client approval</p>
            <div className={`lh-bar is-${client.pace}`}>
              <div className="lh-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="lh-card-note">
              {client.pace === "met"
                ? "Contract met — counted once those emails were sent to the client for approval. Automations don’t count."
                : client.remaining === 1
                  ? "1 campaign email still owed. Counted once sent to the client for approval."
                  : `${client.remaining} campaign emails still owed. Counted once sent to the client for approval.`}
            </p>
          </>
        ) : (
          <p className="lh-card-note">
            No monthly campaign quota on file. Automations still show in the list.
          </p>
        )}

        <div className="lh-quota-tools">
          <label className="lh-field">
            <span>Contracted /mo</span>
            <input
              type="number"
              min={0}
              max={99}
              value={quotaDraft}
              onChange={(e) => setQuotaDraft(e.target.value)}
              onBlur={() => void saveQuota(quotaDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Contracted campaign emails per month"
            />
          </label>
          {quotaError ? <p className="lh-error">{quotaError}</p> : null}

          <form className="lh-log-form" onSubmit={(e) => void submitLog(e)}>
            <span className="lh-log-label">Log campaign</span>
            <input
              type="text"
              value={logTitle}
              onChange={(e) => setLogTitle(e.target.value)}
              placeholder="Title"
              aria-label="Campaign title"
            />
            <div className="lh-log-row">
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                aria-label="Sent date"
              />
              <select
                value={logStatus}
                onChange={(e) => setLogStatus(e.target.value as "sent" | "approved")}
                aria-label="Status"
              >
                <option value="sent">Sent</option>
                <option value="approved">Approved</option>
              </select>
              <button type="submit" className="btn btn-sm" disabled={logging}>
                {logging ? "Saving…" : "Log"}
              </button>
            </div>
            {logError ? <p className="lh-error">{logError}</p> : null}
          </form>
        </div>
      </section>

      <section className="lh-card lh-month-card">
        <div className="lh-card-head">
          <h3>This month</h3>
          <span className="lh-card-links">
            {canSeeOwnerTools ? (
              <Link href="/admin/calendar" className="lh-link">
                Calendar
              </Link>
            ) : null}
            <Link href="/admin/campaigns" className="lh-link">
              Campaigns
            </Link>
          </span>
        </div>
        {thisMonth.length === 0 && inReview.length === 0 ? (
          <p className="lh-card-note">Nothing sent or scheduled yet this month.</p>
        ) : (
          <ul className="lh-timeline">
            {thisMonth.map((row) => (
              <ActivityRow key={row.id} row={row} canSeeOwnerTools={canSeeOwnerTools} />
            ))}
          </ul>
        )}
        {inReview.length > 0 ? (
          <>
            <h4 className="lh-subhead">Still in review</h4>
            <ul className="lh-timeline">
              {inReview.map((row) => (
                <ActivityRow key={row.id} row={row} canSeeOwnerTools={canSeeOwnerTools} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="lh-card lh-launch-card">
        <div className="lh-card-head">
          <h3>Launch</h3>
          {!client.launch.started && !launching ? (
            <button type="button" className="lh-link" onClick={() => setLaunching(true)}>
              Set launch date
            </button>
          ) : client.launch.started ? (
            <span className="muted">
              {client.launch.open
                ? `${client.launch.open} of ${client.launch.total} open`
                : "Done"}
            </span>
          ) : null}
        </div>
        {client.launch.started ? (
          <>
            {!client.platform ? (
              <form
                className="lh-launch-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!missingPlatform) return;
                  void savePlatform(missingPlatform);
                }}
              >
                <label className="lh-field">
                  <span>Platform</span>
                  <PlatformSelect value={missingPlatform} onChange={setMissingPlatform} />
                </label>
                {error ? <p className="lh-error">{error}</p> : null}
                <div className="lh-actions">
                  <button type="submit" className="btn btn-sm" disabled={busy || !missingPlatform}>
                    {busy ? "Saving…" : "Save platform"}
                  </button>
                </div>
              </form>
            ) : null}
            <ul className="lh-todos">
              {client.launch.todos.map((t) => {
                const overdue = t.status === "open" && t.dueDate && t.dueDate < today;
                return (
                  <li key={t.id} className={t.status === "done" ? "is-done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={t.status === "done"}
                        onChange={() => void toggleTodo(t)}
                      />
                      <span>{t.title}</span>
                    </label>
                    {t.dueDate ? (
                      <span className={`lh-due ${overdue ? "is-overdue" : ""}`}>
                        {prettyDate(t.dueDate)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : launching ? (
          <LaunchForm
            today={today}
            busy={busy}
            error={error}
            submitLabel="Create to-dos"
            onCreate={(d, platform) => void createLaunch(d, platform)}
            onCancel={() => {
              setLaunching(false);
              setError("");
            }}
          />
        ) : (
          <p className="lh-card-note">
            Set a launch date and platform to create the calendar, first campaigns, and automations
            to-dos.
          </p>
        )}
      </section>

      <ClientWorkflowsPanel
        key={`wf-${client.id}`}
        clientId={client.id}
        memberIds={client.memberIds || []}
        ghlLinked={Boolean(client.ghlLinked)}
      />

      <EmailAnalyticsPanel
        key={client.id}
        clientId={client.id}
        memberIds={client.memberIds || []}
        ghlLinked={Boolean(client.ghlLinked)}
      />
      </div>
    </div>
  );
}

function ActivityRow({
  row,
  canSeeOwnerTools,
}: {
  row: HubActivity;
  canSeeOwnerTools: boolean;
}) {
  const href =
    row.href === "/admin/calendar" && !canSeeOwnerTools ? null : row.href;
  const status =
    row.source === "campaign" ? operatorStatusLabel(row.status, null) : sendLabel(row.status);
  const title = href ? (
    <Link href={href} className="lh-row-title">
      {row.title}
    </Link>
  ) : (
    <span className="lh-row-title">{row.title}</span>
  );
  return (
    <li className={`lh-time-row ${row.status === "sent" ? "is-sent" : ""}`}>
      <span className={`lh-kind is-${row.kind}`}>{kindLabel(row.kind)}</span>
      {title}
      <span className="lh-row-meta">
        {row.date ? prettyDate(row.date) : status}
        {row.date ? ` · ${status}` : ""}
        {row.kind === "automation"
          ? " · doesn’t count"
          : row.source === "campaign" && !row.delivered
            ? " · not with the client yet"
            : ""}
      </span>
    </li>
  );
}

export function ClientHub() {
  const [data, setData] = useState<HubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [canSeeOwnerTools, setCanSeeOwnerTools] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    const res = await fetch("/api/lifecycle/hub");
    if (res.status === 401) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((auth) => {
        if (!auth?.authenticated) return;
        setCanSeeOwnerTools(
          hasOwnerToolsAccess({
            role: auth.role,
            person: auth.person || null,
            owner: Boolean(auth.owner),
            impersonating: Boolean(auth.impersonating),
          })
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedId(readClientParam());
    setUrlReady(true);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.clients.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (filter === "behind") return c.pace === "behind";
      if (filter === "on_track") return c.pace === "on_track" || c.pace === "met";
      if (filter === "launching") return c.launch.open > 0;
      return true;
    });
  }, [data, query, filter]);

  useEffect(() => {
    if (!data || !urlReady || !selectedId) return;
    if (data.clients.some((c) => matchesClient(c, selectedId))) return;
    setSelectedId("");
    writeClientParam("");
  }, [data, selectedId, urlReady]);

  function select(id: string) {
    setSelectedId(id);
    writeClientParam(id);
  }

  function clearSelection() {
    setSelectedId("");
    writeClientParam("");
  }

  if (denied) {
    return <p className="lh-empty">Sign in to see clients.</p>;
  }
  if (loading) {
    return <p className="lh-empty">Loading clients…</p>;
  }
  if (!data) {
    return <p className="lh-empty">Could not load clients.</p>;
  }

  const selected = data.clients.find((c) => matchesClient(c, selectedId)) || null;
  const counts = data.counts;

  if (selected) {
    return (
      <div className="lh lh-detail-page">
        <div className="lh-detail-bar">
          <button type="button" className="btn btn-ghost" onClick={clearSelection}>
            ← All clients
          </button>
        </div>
        <ClientDetail
          client={selected}
          today={data.today}
          onChanged={() => void load()}
          canSeeOwnerTools={canSeeOwnerTools}
        />
      </div>
    );
  }

  return (
    <div className="lh lh-grid-page">
      <div className="lh-grid-toolbar">
        <div>
          <p className="lh-kicker">{data.periodLabel}</p>
          <p className="lh-counts">
            {counts.behind} behind · {counts.onTrack} on track · {counts.met} met
            {counts.launching ? ` · ${counts.launching} launching` : ""}
          </p>
        </div>
        <input
          className="lh-search"
          type="search"
          placeholder="Find a client"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="lh-filters" role="tablist" aria-label="Filter clients">
          {(
            [
              ["all", "All"],
              ["behind", "Behind"],
              ["on_track", "On track"],
              ["launching", "Launching"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "on" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <AddClientForm
          available={data.available}
          today={data.today}
          onAdded={(id) => {
            void load().then(() => select(id));
          }}
        />
      </div>
      <ClientCards clients={filtered} onSelect={select} />
    </div>
  );
}
