"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AutomationsPanel } from "@/components/lifecycle/AutomationsPanel";
import { BoardPanel } from "@/components/lifecycle/BoardPanel";
import { SubjectBankPanel } from "@/components/lifecycle/SubjectBankPanel";
import { KnowledgePanel } from "@/components/lifecycle/KnowledgePanel";
import { LinkedInHub } from "@/components/lifecycle/LinkedInHub";
import { NotesPanel } from "@/components/lifecycle/NotesPanel";
import { ReportPanel } from "@/components/lifecycle/ReportPanel";
import { StatusBriefing } from "@/components/lifecycle/StatusBriefing";
import type { LifecycleDashboard } from "@/components/lifecycle/types";

type Channel =
  | "status"
  | "board"
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
// the pending count. Deliverables sits right after Status since it's the
// other tab someone opens daily: where every client stands this month.
const CHANNELS: Array<{ id: Channel; label: string }> = [
  { id: "status", label: "Status" },
  { id: "board", label: "Deliverables" },
  { id: "subjects", label: "Subject lines" },
  { id: "automations", label: "Automations" },
  { id: "report", label: "Account report" },
  { id: "sops", label: "Playbooks" },
  { id: "knowledge", label: "Knowledge" },
  { id: "notes", label: "Notes" },
  { id: "linkedin", label: "LinkedIn" },
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
              ch.id === "board" && (data.counts.myQueue > 0 || data.counts.behindQuota > 0)
                ? { n: data.counts.myQueue || data.counts.behindQuota, alert: data.counts.myQueue > 0 }
                : ch.id === "linkedin" && c.campaignsNeedingRefresh > 0
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
          <StatusBriefing
            data={data}
            onOpenBoard={() => setChannel("board")}
            onOpenLinkedIn={() => setChannel("linkedin")}
            onChanged={refresh}
          />
        ) : null}

        {channel === "board" ? <BoardPanel clients={data.clients} /> : null}

        {channel === "linkedin" ? (
          <LinkedInHub
            data={li}
            clients={data.clients}
            counts={data.counts}
            refreshSettings={data.refreshSettings}
            onChanged={refresh}
          />
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
