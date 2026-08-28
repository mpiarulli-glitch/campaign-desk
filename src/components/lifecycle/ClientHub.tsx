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
  nextSend: HubSend | null;
  sends: HubSend[];
  campaigns: HubCampaign[];
  activity: HubActivity[];
  memberIds: string[];
  launch: {
    started: boolean;
    open: number;
    total: number;
    todos: HubLaunchTodo[];
  };
};

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

function listLine(c: HubClient): string {
  if (c.quota > 0) {
    const next = c.nextSend ? ` · next ${prettyDate(c.nextSend.date)}` : "";
    return `${c.delivered} of ${c.quota}${next}`;
  }
  if (c.nextSend) return `Next ${prettyDate(c.nextSend.date)}`;
  if (c.launch.open > 0) return `Launching · ${c.launch.open} open`;
  return emailPlatformLabel(c.platform) || "No quota";
}

function matchesClient(c: HubClient, id: string): boolean {
  return c.id === id || (c.memberIds || []).includes(id);
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

function ClientList({
  clients,
  selectedId,
  onSelect,
}: {
  clients: HubClient[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (clients.length === 0) {
    return <p className="lh-empty">No clients match.</p>;
  }
  return (
    <ul className="lh-list">
      {clients.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`lh-list-item ${selectedId === c.id ? "on" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <PaceDot pace={c.pace} launching={c.launch.open > 0} />
            <span className="lh-list-copy">
              <span className="lh-list-name">{c.name}</span>
              <span className="lh-list-meta">{listLine(c)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
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
  const [launchDate, setLaunchDate] = useState(today);
  const [platform, setPlatform] = useState<EmailPlatform | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = previewLaunchTodos(launchDate);
  const canSubmit = Boolean(clientId && launchDate && platform && preview.length && !busy);

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
        body: JSON.stringify({ clientId, launchDate, platform }),
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
      <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
        <option value="">Pick a client…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
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
  const pct =
    client.quota > 0 ? Math.min(100, Math.round((client.delivered / client.quota) * 100)) : 0;

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
      </section>

      <section className="lh-card">
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

      <section className="lh-card">
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
    if (!data || !urlReady) return;
    if (selectedId && data.clients.some((c) => matchesClient(c, selectedId))) return;
    const next = filtered[0]?.id || data.clients[0]?.id || "";
    if (next) {
      setSelectedId(next);
      writeClientParam(next);
    }
  }, [data, filtered, selectedId, urlReady]);

  function select(id: string) {
    setSelectedId(id);
    writeClientParam(id);
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

  return (
    <div className="lh">
      <aside className="lh-rail">
        <div className="lh-rail-head">
          <p className="lh-kicker">{data.periodLabel}</p>
          <p className="lh-counts">
            {counts.behind} behind · {counts.onTrack} on track · {counts.met} met
            {counts.launching ? ` · ${counts.launching} launching` : ""}
          </p>
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
        </div>
        <ClientList clients={filtered} selectedId={selectedId} onSelect={select} />
        <AddClientForm
          available={data.available}
          today={data.today}
          onAdded={(id) => {
            void load().then(() => select(id));
          }}
        />
      </aside>
      <div className="lh-main">
        {selected ? (
          <ClientDetail
            client={selected}
            today={data.today}
            onChanged={() => void load()}
            canSeeOwnerTools={canSeeOwnerTools}
          />
        ) : (
          <p className="lh-empty">
            {data.available.length
              ? "Add a client with a launch date and platform, or pick one from the list."
              : "Pick a client."}
          </p>
        )}
      </div>
    </div>
  );
}
