"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { operatorStatusLabel } from "@/lib/campaign-status";
import {
  EMAIL_PLATFORMS,
  emailPlatformLabel,
  previewLaunchTodos,
  type EmailPlatform,
  type PaceStatus,
} from "@/lib/email-launch";
import { hasOwnerToolsAccess } from "@/lib/people";
import { BrandGuidePanel } from "./BrandGuidePanel";
import { ChannelAnalyticsPanel } from "./ChannelAnalyticsPanel";
import { ClientIntegrationsPanel } from "./ClientIntegrationsPanel";
import { ChecklistBlock } from "./ChecklistBlock";
import { ClientSectionNav, type ClientView } from "./ClientSectionNav";
import { ClientWorkflowsPanel } from "./ClientWorkflowsPanel";
import { HubFoldCard } from "./HubFoldCard";
import { MoodBoardPanel } from "./MoodBoardPanel";
import { OffersPanel } from "./OffersPanel";

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
  businessModel?: "ecomm" | "b2b" | "home_service";
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
  deliverables: HubLaunchTodo[];
  automations: HubLaunchTodo[];
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
  const autos = c.automations || [];
  if (autos.length > 0) {
    const done = autos.filter((a) => a.status === "done").length;
    return `${done} of ${autos.length}`;
  }
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

function readViewParam(): ClientView {
  if (typeof window === "undefined") return "month";
  const raw = new URLSearchParams(window.location.search).get("view");
  if (raw === "brand" || raw === "mood" || raw === "offers") return raw;
  return "month";
}

function writeDeskUrl(id: string, view: ClientView, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("client", id);
  else url.searchParams.delete("client");
  if (id && view !== "month") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  const next = `${url.pathname}${url.search}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current) return;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

function PaceDot({ pace, launching }: { pace: PaceStatus; launching: boolean }) {
  const tone = launching && pace !== "behind" ? "launch" : pace;
  return <span className={`lh-dot is-${tone}`} aria-hidden="true" />;
}

function confirmRemoveFromLifecycle(name: string): boolean {
  return confirm(
    `Take ${name} off Lifecycle? They keep every record and you can add them back. This month and later months drop them; earlier months stay as they were.`
  );
}

async function requestRemoveFromLifecycle(
  clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/lifecycle/hub/${clientId}`, { method: "DELETE" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: data.error || "Could not remove that client." };
  return { ok: true };
}

function ClientCards({
  clients,
  removingId,
  onSelect,
  onRemove,
}: {
  clients: HubClient[];
  removingId: string;
  onSelect: (id: string) => void;
  onRemove: (client: HubClient) => void;
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
        const removing = removingId === c.id;
        return (
          <article
            key={c.id}
            className={`snap-pick-card lh-pick-card is-pace-${c.pace}`}
          >
            <button
              type="button"
              className="lh-pick-open"
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
            </button>
            <div className="snap-pick-card-foot">
              <span className={`snap-pick-metric is-${c.pace}`}>{metricLabel(c)}</span>
              <span className={`snap-pick-status ${status.tone}`}>{status.label}</span>
              <button
                type="button"
                className="lh-pick-remove"
                disabled={removing}
                onClick={() => onRemove(c)}
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </article>
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
    <details className="lh-card lh-fold lh-add">
      <summary className="lh-card-head">
        <span className="lh-fold-title">Add a client</span>
        <span className="muted">{available.length} waiting</span>
      </summary>
      <form
        className={`lh-add-form${mode === "automations" ? " is-automations" : ""}`}
        onSubmit={(e) => void submit(e)}
      >
        <div className="lh-add-setup" role="group" aria-label="How to add them">
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

        <div className="lh-add-row">
          <label className="lh-field">
            <span>Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
              aria-label="Client"
            >
              <option value="">Pick a client…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
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
            </>
          ) : null}
          <button type="submit" className="btn" disabled={!canSubmit}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>

        {mode === "launch" && clientId && preview.length ? (
          <p className="lh-add-preview">
            Creates{" "}
            {preview.map((item, i) => (
              <span key={item.title}>
                {i ? " · " : ""}
                {item.title.toLowerCase()} ({prettyDate(item.dueDate)})
              </span>
            ))}
          </p>
        ) : null}
        {mode === "automations" ? (
          <p className="lh-add-hint">
            Adds them to Lifecycle with no launch to-dos. Open the client to pull live
            workflows.
          </p>
        ) : null}
        {error ? <p className="lh-error">{error}</p> : null}
      </form>
    </details>
  );
}

function ClientDetail({
  client,
  view,
  onView,
  onChanged,
  onRemoved,
  onBack,
  canSeeOwnerTools,
  onOpenTools,
}: {
  client: HubClient;
  view: ClientView;
  onView: (view: ClientView) => void;
  onChanged: () => void;
  onRemoved: () => void;
  onBack: () => void;
  canSeeOwnerTools: boolean;
  onOpenTools?: () => void;
}) {
  const [quotaDraft, setQuotaDraft] = useState(String(client.quota || ""));
  const [logTitle, setLogTitle] = useState("");
  const [logDate, setLogDate] = useState("");
  const [logStatus, setLogStatus] = useState<"sent" | "approved">("sent");
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState("");
  const [quotaError, setQuotaError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [crmLinked, setCrmLinked] = useState(false);
  const [analyticsTick, setAnalyticsTick] = useState(0);
  const handleCrmChange = useCallback((linked: boolean) => {
    setCrmLinked((prev) => {
      if (prev !== linked) setAnalyticsTick((n) => n + 1);
      return linked;
    });
  }, []);
  const automations = client.automations || [];
  const automationDone = automations.filter((a) => a.status === "done").length;
  const emailPct =
    client.quota > 0 ? Math.min(100, Math.round((client.delivered / client.quota) * 100)) : 0;
  const automationPct =
    automations.length > 0
      ? Math.min(100, Math.round((automationDone / automations.length) * 100))
      : 0;

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

  async function removeFromLifecycle() {
    if (!confirmRemoveFromLifecycle(client.name)) return;
    setRemoving(true);
    setRemoveError("");
    try {
      const result = await requestRemoveFromLifecycle(client.id);
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      onRemoved();
    } finally {
      setRemoving(false);
    }
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
      <div className="lh-detail-bar">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← All clients
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={removing}
          onClick={() => void removeFromLifecycle()}
        >
          {removing ? "Removing…" : "Remove from Lifecycle"}
        </button>
      </div>
      {removeError ? <p className="lh-error">{removeError}</p> : null}
      <header className="lh-detail-head">
        <div>
          <h2>{client.name}</h2>
          {headerBits.length ? <p className="muted">{headerBits.join(" · ")}</p> : null}
          <ClientSectionNav view={view} onView={onView} />
        </div>
        <span className={`lh-pace is-${client.pace}`}>{client.paceLabel}</span>
      </header>

      {view === "month" ? (
      <div className="lh-detail-layout">
      <ChannelAnalyticsPanel
        key={`email-${client.id}-${analyticsTick}`}
        clientId={client.id}
        memberIds={client.memberIds || []}
        ghlLinked={Boolean(client.ghlLinked)}
        crmLinked={crmLinked}
        businessModel={client.businessModel || "home_service"}
        onOpenTools={onOpenTools}
      />

      <HubFoldCard className="lh-quota" title="Deliverables">
        {client.quota > 0 ? (
          <>
            <p className="lh-quota-num">
              <strong>{client.delivered}</strong>
              <span> of {client.quota}</span>
            </p>
            <p className="lh-quota-label">campaign emails sent for client approval</p>
            <div className={`lh-bar is-${client.pace}`}>
              <div className="lh-bar-fill" style={{ width: `${emailPct}%` }} />
            </div>
            <p className="lh-card-note">
              {client.pace === "met"
                ? "Contract met — counted once those emails were sent to the client for approval. Automations don’t count."
                : client.remaining === 1
                  ? "1 campaign email still owed. Counted once sent to the client for approval."
                  : `${client.remaining} campaign emails still owed. Counted once sent to the client for approval.`}
            </p>
            {automations.length > 0 ? (
              <p className="lh-card-note">
                {automationDone} of {automations.length} contracted automations set up.
              </p>
            ) : null}
          </>
        ) : automations.length > 0 ? (
          <>
            <p className="lh-quota-num">
              <strong>{automationDone}</strong>
              <span> of {automations.length}</span>
            </p>
            <p className="lh-quota-label">contracted automations set up</p>
            <div className={`lh-bar is-${client.pace}`}>
              <div className="lh-bar-fill" style={{ width: `${automationPct}%` }} />
            </div>
            <p className="lh-card-note">
              {automationDone === automations.length
                ? "All contracted automations are set up. Check them off as they go live."
                : automations.length - automationDone === 1
                  ? "1 automation still owed. Check it off when it’s live."
                  : `${automations.length - automationDone} automations still owed. Check them off when they’re live.`}
            </p>
          </>
        ) : (
          <p className="lh-card-note">
            No monthly campaign quota. Add the automations this account is contracted for, or set
            emails per month.
          </p>
        )}

        <div className="lh-quota-tools">
          <label className="lh-field">
            <span>Campaign emails /mo</span>
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
          {client.quota > 0 ? (
            <p className="lh-card-note">
              Set this to 0 if the account is moving from monthly sends to a set list of automations.
            </p>
          ) : null}

          <div className="lh-quota-block">
            <span className="lh-log-label">Automations to set up</span>
            <ChecklistBlock
              items={automations}
              empty="Add each automation this account is contracted for — welcome series, abandoned cart, and so on. Paste one per line."
              addLabel="Add automations"
              placeholder={"Welcome series\nAbandoned cart\nReview request"}
              kind="automation"
              clientId={client.id}
              onChanged={onChanged}
            />
          </div>

          <ChecklistBlock
            items={client.deliverables || []}
            empty="Add LinkedIn, SMS, landing pages, or other contracted work."
            addLabel="Add deliverable"
            placeholder="e.g. LinkedIn campaigns"
            kind="deliverable"
            clientId={client.id}
            onChanged={onChanged}
          />

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
      </HubFoldCard>

      <HubFoldCard
        className="lh-month-card"
        title="This month"
        actions={
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
        }
      >
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
      </HubFoldCard>

      <ClientWorkflowsPanel
        key={`wf-${client.id}`}
        clientId={client.id}
        memberIds={client.memberIds || []}
        ghlLinked={Boolean(client.ghlLinked)}
        onOpenTools={onOpenTools}
      />

      <ClientIntegrationsPanel
        key={`crm-${client.id}`}
        clientId={client.id}
        onChange={handleCrmChange}
      />
      </div>
      ) : view === "brand" ? (
        <BrandGuidePanel key={client.id} clientId={client.id} />
      ) : view === "mood" ? (
        <MoodBoardPanel key={client.id} clientId={client.id} />
      ) : (
        <OffersPanel key={client.id} clientId={client.id} />
      )}
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

export function ClientHub({
  onOpenTools,
}: {
  onOpenTools?: () => void;
} = {}) {
  const [data, setData] = useState<HubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [canSeeOwnerTools, setCanSeeOwnerTools] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<ClientView>("month");
  const viewRef = useRef<ClientView>("month");
  const [urlReady, setUrlReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [removingId, setRemovingId] = useState("");

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
    function syncFromUrl() {
      const nextView = readViewParam();
      viewRef.current = nextView;
      setView(nextView);
      setSelectedId(readClientParam());
    }
    syncFromUrl();
    setUrlReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
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
    writeDeskUrl("", "month", "replace");
  }, [data, selectedId, urlReady]);

  function select(id: string) {
    const nextView = viewRef.current;
    setSelectedId(id);
    setView(nextView);
    writeDeskUrl(id, nextView, "push");
  }

  function clearSelection() {
    setSelectedId("");
    writeDeskUrl("", viewRef.current, "push");
  }

  function openView(next: ClientView) {
    if (next === view) return;
    viewRef.current = next;
    setView(next);
    writeDeskUrl(selectedId, next, "push");
  }

  async function removeCard(client: HubClient) {
    if (!confirmRemoveFromLifecycle(client.name)) return;
    setRemovingId(client.id);
    try {
      const result = await requestRemoveFromLifecycle(client.id);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      if (selectedId === client.id) clearSelection();
      await load();
    } finally {
      setRemovingId("");
    }
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
        <ClientDetail
          client={selected}
          view={view}
          onView={openView}
          onChanged={() => void load()}
          onRemoved={() => {
            clearSelection();
            void load();
          }}
          onBack={clearSelection}
          canSeeOwnerTools={canSeeOwnerTools}
          onOpenTools={onOpenTools}
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
      <ClientCards
        clients={filtered}
        removingId={removingId}
        onSelect={select}
        onRemove={(c) => void removeCard(c)}
      />
    </div>
  );
}
