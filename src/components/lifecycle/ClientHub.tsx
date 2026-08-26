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

type HubSend = {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  assetType: string;
};

type HubCampaign = {
  id: string;
  title: string;
  status: string;
  approvedChannel: string | null;
  updatedAt: string;
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
            <span className="lh-list-name">{c.name}</span>
            <span className="lh-list-meta">
              {c.quota > 0
                ? `${c.delivered}/${c.quota}`
                : emailPlatformLabel(c.platform) || c.pipelineLabel}
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
}: {
  client: HubClient;
  today: string;
  onChanged: () => void;
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

  return (
    <div className="lh-detail">
      <header className="lh-detail-head">
        <div>
          <h2>{client.name}</h2>
          <p className="muted">
            {[
              client.launchDate ? `Launch ${prettyDate(client.launchDate)}` : client.pipelineLabel,
              emailPlatformLabel(client.platform),
              client.nextSend
                ? `Next send ${prettyDate(client.nextSend.date)}`
                : "Nothing on the calendar",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className={`lh-pace is-${client.pace}`}>{client.paceLabel}</span>
      </header>

      <section className="lh-card">
        <div className="lh-card-head">
          <h3>Contract this month</h3>
          <span className="muted">
            {client.quota > 0
              ? `${client.delivered} of ${client.quota} emails`
              : "No monthly quota on file"}
          </span>
        </div>
        {client.quota > 0 ? (
          <>
            <div className={`lh-bar is-${client.pace}`}>
              <div className="lh-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="lh-card-note">
              {client.pace === "met"
                ? "This month’s emails are delivered."
                : client.remaining === 1
                  ? "1 email still owed."
                  : `${client.remaining} emails still owed.`}
            </p>
          </>
        ) : (
          <p className="lh-card-note">Set a monthly email quota on the client if this account is contracted for email.</p>
        )}
      </section>

      <section className="lh-card">
        <div className="lh-card-head">
          <h3>Sending</h3>
          <Link href="/admin/calendar" className="lh-link">
            Calendar
          </Link>
        </div>
        {client.sends.length === 0 ? (
          <p className="lh-card-note">Nothing scheduled from today through next month.</p>
        ) : (
          <ul className="lh-rows">
            {client.sends.map((s) => (
              <li key={s.id}>
                <span className="lh-row-title">{s.title}</span>
                <span className="lh-row-meta">
                  {prettyDate(s.date)}
                  {s.time ? ` · ${s.time}` : ""} · {sendLabel(s.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lh-card">
        <div className="lh-card-head">
          <h3>In flight</h3>
          <Link href="/admin/campaigns" className="lh-link">
            Campaigns
          </Link>
        </div>
        {client.campaigns.length === 0 ? (
          <p className="lh-card-note">No open email campaigns.</p>
        ) : (
          <ul className="lh-rows">
            {client.campaigns.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/campaigns/${c.id}`} className="lh-row-title">
                  {c.title}
                </Link>
                <span className="lh-row-meta">
                  {operatorStatusLabel(c.status, c.approvedChannel)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lh-card">
        <div className="lh-card-head">
          <h3>Launch checklist</h3>
          {!client.launch.started && !launching ? (
            <button type="button" className="lh-link" onClick={() => setLaunching(true)}>
              Set launch date
            </button>
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

export function ClientHub() {
  const [data, setData] = useState<HubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
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
    if (selectedId && data.clients.some((c) => c.id === selectedId)) return;
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

  const selected = data.clients.find((c) => c.id === selectedId) || null;
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
          <ClientDetail client={selected} today={data.today} onChanged={() => void load()} />
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
