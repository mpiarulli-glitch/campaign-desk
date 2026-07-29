"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AutomationsPanel } from "@/components/lifecycle/AutomationsPanel";
import { LinkedInPanel } from "@/components/lifecycle/LinkedInPanel";
import { NotesPanel } from "@/components/lifecycle/NotesPanel";
import { ReportPanel } from "@/components/lifecycle/ReportPanel";
import { PLATFORM_LABELS, type LifecycleDashboard } from "@/components/lifecycle/types";

type Tab = "overview" | "approvals" | "linkedin" | "automations" | "sops" | "notes" | "report";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "approvals", label: "Approvals" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "automations", label: "Automations" },
  { id: "sops", label: "SOPs" },
  { id: "notes", label: "Notes & links" },
  { id: "report", label: "Account report" },
];

export default function LifecyclePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<LifecycleDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (force) setSyncing(true);
      try {
        const res = await fetch(`/api/lifecycle${force ? "?refresh=1" : ""}`);
        if (res.status === 401) {
          setDenied(true);
          return;
        }
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (denied) router.push("/login");
  }, [denied, router]);

  const refresh = useCallback(() => void load(false), [load]);

  if (loading) {
    return (
      <div className="ops-scope">
        <div className="ops-page">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ops-scope">
        <div className="ops-page">
          <p className="muted">Could not load the lifecycle dashboard.</p>
        </div>
      </div>
    );
  }

  const c = data.counts;

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head" style={{ alignItems: "flex-start" }}>
          <div>
            <h1 className="ops-title">Lifecycle Marketing.</h1>
            <p className="muted" style={{ marginTop: 2 }}>
              Approvals, outreach, automations and playbooks in one place.
            </p>
          </div>
          <button className="btn btn-sm" disabled={syncing} onClick={() => void load(true)}>
            {syncing ? "Syncing…" : "Sync Skylead"}
          </button>
        </div>

        <div className="lc-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`lc-tab ${tab === t.id ? "on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "approvals" && c.pendingApprovals > 0 ? (
                <span className="lc-tab-count">{c.pendingApprovals}</span>
              ) : null}
              {t.id === "linkedin" && c.campaignsNeedingRefresh > 0 ? (
                <span className="lc-tab-count lc-tab-count-bad">{c.campaignsNeedingRefresh}</span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="stack" style={{ gap: 16 }}>
            <div className="lc-kpis">
              <div><b>{c.pendingApprovals}</b><span>open approvals</span></div>
              <div><b>{c.waitingOnClient}</b><span>waiting on client</span></div>
              <div><b>{c.waitingOnUs}</b><span>waiting on us</span></div>
              <div><b>{c.liveAutomations}</b><span>live automations</span></div>
              <div><b>{c.linkedInLive}</b><span>live LinkedIn</span></div>
              <div className={c.campaignsNeedingRefresh > 0 ? "is-bad" : ""}>
                <b>{c.campaignsNeedingRefresh}</b><span>need a refresh</span>
              </div>
              <div className={c.brokenSeats > 0 ? "is-bad" : ""}>
                <b>{c.brokenSeats}</b><span>seats not sending</span>
              </div>
            </div>

            {data.linkedIn.needsRefresh.length > 0 ? (
              <div className="ops-panel">
                <h3 style={{ marginTop: 0 }}>Campaigns to refresh</h3>
                {data.linkedIn.needsRefresh.slice(0, 8).map((row) => (
                  <div key={row.id} className="lc-line">
                    <span>
                      <b>{row.name}</b>
                      <span className="muted"> · {row.seatName}</span>
                    </span>
                    <span className="muted">
                      {row.verdict.reasons.map((r) => r.label).join(", ")}
                    </span>
                  </div>
                ))}
                {data.linkedIn.needsRefresh.length > 8 ? (
                  <button className="lc-mini" onClick={() => setTab("linkedin")}>
                    See all {data.linkedIn.needsRefresh.length}
                  </button>
                ) : null}
              </div>
            ) : null}

            {data.approvals.length > 0 ? (
              <div className="ops-panel">
                <h3 style={{ marginTop: 0 }}>Oldest open approvals</h3>
                {data.approvals.slice(0, 6).map((a) => (
                  <div key={a.id} className="lc-line">
                    <Link href={`/admin/campaigns/${a.id}`}>{a.title}</Link>
                    <span className="muted">
                      {a.clientName} · {a.waitingDays}d ·{" "}
                      {a.status === "in_review" ? "with client" : "with us"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {data.liveAutomationsByPlatform.length > 0 ? (
              <div className="ops-panel">
                <h3 style={{ marginTop: 0 }}>Automations by platform</h3>
                {data.liveAutomationsByPlatform.map((p) => (
                  <div key={p.platform} className="lc-line">
                    <span>{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
                    <span className="muted">{p.live} live of {p.total}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "approvals" ? (
          <div className="stack" style={{ gap: 10 }}>
            {data.approvals.length === 0 ? (
              <p className="muted">Nothing is waiting on a decision. Enjoy it.</p>
            ) : (
              data.approvals.map((a) => (
                <div key={a.id} className="lc-approval">
                  <div>
                    <Link href={`/admin/campaigns/${a.id}`} className="lc-approval-title">
                      {a.title}
                    </Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.clientName}
                      {a.openComments > 0 ? ` · ${a.openComments} open comment${a.openComments === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <span className={`lc-chip ${a.status === "in_review" ? "lc-chip-warn" : "lc-chip-bad"}`}>
                      {a.status === "in_review" ? "With client" : "With us"}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{a.waitingDays}d</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "linkedin" ? (
          <LinkedInPanel data={data.linkedIn} clients={data.clients} onChanged={refresh} />
        ) : null}

        {tab === "automations" ? (
          <AutomationsPanel
            automations={data.automations}
            clients={data.clients}
            onChanged={refresh}
          />
        ) : null}

        {tab === "sops" ? (
          <div className="stack" style={{ gap: 10 }}>
            <p className="muted">
              SOPs are shared with the team hub, so anything you add there shows up here.{" "}
              <Link href="/admin/hub">Edit them in MEG Team Hub</Link>.
            </p>
            {data.sops.length === 0 ? (
              <p className="muted">No SOPs written yet.</p>
            ) : (
              data.sops.map((s) => (
                <div key={s.id} className="lc-line">
                  <span>
                    {s.link ? (
                      <a href={s.link} target="_blank" rel="noreferrer">{s.title}</a>
                    ) : (
                      s.title
                    )}
                  </span>
                  <span className="muted">{s.category || "Uncategorised"}</span>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "notes" ? (
          <NotesPanel
            notes={data.notes}
            links={data.links}
            clients={data.clients}
            onChanged={refresh}
          />
        ) : null}

        {tab === "report" ? <ReportPanel clients={data.clients} /> : null}
      </div>
    </div>
  );
}
