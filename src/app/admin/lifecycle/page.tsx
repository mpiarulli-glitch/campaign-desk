"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AutomationsPanel } from "@/components/lifecycle/AutomationsPanel";
import { SubjectBankPanel } from "@/components/lifecycle/SubjectBankPanel";
import { KnowledgePanel } from "@/components/lifecycle/KnowledgePanel";
import { LinkedInPanel } from "@/components/lifecycle/LinkedInPanel";
import { NotesPanel } from "@/components/lifecycle/NotesPanel";
import { ReportPanel } from "@/components/lifecycle/ReportPanel";
import { SeatArray } from "@/components/lifecycle/SeatArray";
import { PLATFORM_LABELS, type LifecycleDashboard } from "@/components/lifecycle/types";

type Channel =
  | "status"
  | "subjects"
  | "linkedin"
  | "automations"
  | "sops"
  | "knowledge"
  | "notes"
  | "report";

// Ordered for the person who lives in this tab: email work first, then the
// reference material, with LinkedIn outreach last because it belongs to someone
// else's day. Approvals used to sit second; the Approvals ageing report covers
// the same ground with ageing and per-client breakdowns, so the channel went
// rather than being maintained in two places. The Status readout still carries
// the pending count.
const CHANNELS: Array<{ id: Channel; label: string }> = [
  { id: "status", label: "Status" },
  { id: "subjects", label: "Subject lines" },
  { id: "automations", label: "Automations" },
  { id: "report", label: "Account report" },
  { id: "sops", label: "Playbooks" },
  { id: "knowledge", label: "Knowledge" },
  { id: "notes", label: "Notes" },
  { id: "linkedin", label: "Outreach" },
];

/** Zulu-style clock. A console shows the time in one unambiguous zone. */
function stamp(iso: string | null): string {
  if (!iso) return "--:--:--Z";
  return `${new Date(iso).toISOString().slice(11, 19)}Z`;
}

export default function LifecyclePage() {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("status");
  const [data, setData] = useState<LifecycleDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async (force = false) => {
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (denied) router.push("/login");
  }, [denied, router]);

  const refresh = useCallback(() => void load(false), [load]);

  if (loading) {
    return (
      <div className="hud">
        <div className="hud-page">
          <p className="hud-empty">Establishing link…</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hud">
        <div className="hud-page">
          <div className="hud-alert">
            <h3>No signal</h3>
            <p className="hud-err">The lifecycle console could not load. Reload to retry.</p>
          </div>
        </div>
      </div>
    );
  }

  const c = data.counts;
  const li = data.linkedIn;
  const seatsTotal = li.seats.length;
  const seatsLive = seatsTotal - li.brokenSeats;
  // Only campaigns that would otherwise be running are "stranded". Counting
  // switched-off ones here would inflate the number and make the alert lie.
  const stranded = li.campaigns.filter((c) => c.verdict.severity === "blocked").length;

  return (
    <div className="hud">
      <div className="hud-page">
        <header className="hud-bar hud-in hud-in-1">
          <div className="hud-mark">
            <h1>Lifecycle</h1>
            <span className="hud-clock">
              {li.fetchedAt ? `SYNC ${stamp(li.fetchedAt)}` : "NO SYNC"}
            </span>
          </div>
          <div className="hud-bar-right">
            <button className="hud-btn" disabled={syncing} onClick={() => void load(true)}>
              {syncing ? "Syncing" : "Resync"}
            </button>
          </div>
        </header>

        <nav className="hud-channels hud-in hud-in-1">
          {CHANNELS.map((ch) => {
            const badge =
              ch.id === "linkedin" && c.campaignsNeedingRefresh > 0
                ? { n: c.campaignsNeedingRefresh, alert: true }
                : null;
            return (
              <button
                key={ch.id}
                className={`hud-channel ${channel === ch.id ? "on" : ""}`}
                onClick={() => setChannel(ch.id)}
              >
                {ch.label}
                {badge ? (
                  <span className={`hud-channel-count ${badge.alert ? "alert" : ""}`}>
                    {badge.n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {channel === "status" ? (
          <div className="hud-stack">
            {seatsTotal > 0 ? (
              <div className="hud-panel hud-array-panel hud-in hud-in-2">
                <div className="hud-panel-head">
                  <div>
                    <div className="hud-eyebrow">Network integrity</div>
                    <h2 className="hud-panel-title" style={{ marginTop: 6 }}>
                      LinkedIn seat array
                    </h2>
                  </div>
                  <div
                    className={`hud-integrity ${li.brokenSeats > 0 ? "degraded" : ""}`}
                  >
                    {seatsLive}
                    <small> / {seatsTotal}</small>
                  </div>
                </div>

                <SeatArray seats={li.seats} />

                <div className="hud-array-legend">
                  <span>
                    <b>{seatsLive}</b> sending
                  </span>
                  <span className={li.brokenSeats > 0 ? "crit" : ""}>
                    <b>{li.brokenSeats}</b> faulted
                  </span>
                  {stranded > 0 ? (
                    <span className="crit">
                      <b>{stranded}</b> campaigns stranded on faulted seats
                    </span>
                  ) : null}
                  {li.hiddenSeats > 0 ? (
                    <span>
                      <b>{li.hiddenSeats}</b> cancelled{" "}
                      {li.hiddenSeats === 1 ? "seat" : "seats"} hidden
                    </span>
                  ) : null}
                  <span style={{ marginLeft: "auto" }}>bar height = campaign load</span>
                </div>
              </div>
            ) : null}

            <div className="hud-readouts hud-in hud-in-2">
              <div className={`hud-readout ${c.campaignsNeedingRefresh > 0 ? "alert" : ""}`}>
                <b>{String(c.campaignsNeedingRefresh).padStart(2, "0")}</b>
                <span>Need work</span>
              </div>
              <div className="hud-readout live">
                <b>{String(c.linkedInLive).padStart(2, "0")}</b>
                <span>Live outreach</span>
              </div>
              <div className={`hud-readout ${c.pendingApprovals > 0 ? "warn" : ""}`}>
                <b>{String(c.pendingApprovals).padStart(2, "0")}</b>
                <span>Approvals open</span>
              </div>
              <div className="hud-readout">
                <b>{String(c.waitingOnUs).padStart(2, "0")}</b>
                <span>On us</span>
              </div>
              <div className="hud-readout">
                <b>{String(c.ghlLive).padStart(2, "0")}</b>
                <span>GHL workflows</span>
              </div>
            </div>

            {li.needsRefresh.length > 0 ? (
              <div className="hud-panel hud-in hud-in-3">
                <div className="hud-panel-head">
                  <h2 className="hud-panel-title">Priority queue</h2>
                  <span className="hud-eyebrow">Worst first</span>
                </div>
                <div className="hud-queue">
                  {li.needsRefresh.slice(0, 10).map((row, i) => (
                    <div key={row.id} className="hud-q">
                      <span className="hud-q-rank hud-num">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="hud-q-name">{row.name}</div>
                        <div className="hud-q-meta">
                          {row.seatName}
                          {row.clientName ? ` · ${row.clientName}` : ""}
                        </div>
                      </div>
                      <div className="hud-q-faults">
                        {row.verdict.reasons.map((r) => (
                          <span key={r.code} className={`hud-chip hud-chip-${r.severity === "refresh" ? "crit" : "warn"}`}>
                            {r.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {li.needsRefresh.length > 10 ? (
                  <button
                    className="hud-link"
                    style={{ marginTop: 12 }}
                    onClick={() => setChannel("linkedin")}
                  >
                    Open all {li.needsRefresh.length} in Outreach
                  </button>
                ) : null}
              </div>
            ) : null}

            {data.approvals.length > 0 ? (
              <div className="hud-panel hud-in hud-in-3">
                <div className="hud-panel-head">
                  <h2 className="hud-panel-title">Awaiting a decision</h2>
                  <span className="hud-eyebrow">Longest wait first</span>
                </div>
                {data.approvals.slice(0, 6).map((a) => (
                  <div key={a.id} className="hud-row">
                    <Link href={`/admin/campaigns/${a.id}`}>{a.title}</Link>
                    <span className="hud-row-meta">
                      {a.clientName} · {a.waitingDays}d ·{" "}
                      {a.status === "in_review" ? "client" : "us"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {data.liveAutomationsByPlatform.length > 0 ? (
              <div className="hud-panel hud-in hud-in-3">
                <div className="hud-panel-head">
                  <h2 className="hud-panel-title">Automations by platform</h2>
                </div>
                {data.liveAutomationsByPlatform.map((p) => (
                  <div key={p.platform} className="hud-row">
                    <span>{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
                    <span className="hud-row-meta">
                      {p.live} live / {p.total}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {channel === "linkedin" ? (
          <LinkedInPanel data={li} clients={data.clients} onChanged={refresh} />
        ) : null}

        {channel === "automations" ? (
          <AutomationsPanel
            automations={data.automations}
            ghl={data.ghl}
            clients={data.clients}
            onChanged={refresh}
          />
        ) : null}

        {channel === "sops" ? (
          <div className="hud-panel">
            <div className="hud-panel-head">
              <h2 className="hud-panel-title">Playbooks</h2>
              <Link href="/admin/hub" className="hud-link">
                Edit in Team Hub
              </Link>
            </div>
            {data.sops.length === 0 ? (
              <p className="hud-empty">No SOPs written yet.</p>
            ) : (
              data.sops.map((s) => (
                <div key={s.id} className="hud-row">
                  <span>
                    {s.link ? (
                      <a href={s.link} target="_blank" rel="noreferrer">{s.title}</a>
                    ) : (
                      s.title
                    )}
                  </span>
                  <span className="hud-row-meta">{s.category || "Uncategorised"}</span>
                </div>
              ))
            )}
          </div>
        ) : null}

        {channel === "knowledge" ? <KnowledgePanel /> : null}

        {channel === "notes" ? (
          <NotesPanel
            notes={data.notes}
            links={data.links}
            clients={data.clients}
            onChanged={refresh}
          />
        ) : null}

        {channel === "subjects" ? <SubjectBankPanel /> : null}

        {channel === "report" ? <ReportPanel clients={data.clients} /> : null}
      </div>
    </div>
  );
}
