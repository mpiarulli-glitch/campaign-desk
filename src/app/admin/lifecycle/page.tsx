"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AutomationsPanel } from "@/components/lifecycle/AutomationsPanel";
import { BoardPanel } from "@/components/lifecycle/BoardPanel";
import { ClientHub } from "@/components/lifecycle/ClientHub";
import { SubjectBankPanel } from "@/components/lifecycle/SubjectBankPanel";
import { KnowledgePanel } from "@/components/lifecycle/KnowledgePanel";
import { LinkedInHub } from "@/components/lifecycle/LinkedInHub";
import { NotesPanel } from "@/components/lifecycle/NotesPanel";
import { ReportPanel } from "@/components/lifecycle/ReportPanel";
import { ToolsPanel } from "@/components/lifecycle/ToolsPanel";
import type { LifecycleDashboard } from "@/components/lifecycle/types";

type Tool =
  | "board"
  | "subjects"
  | "linkedin"
  | "automations"
  | "sops"
  | "knowledge"
  | "notes"
  | "report"
  | "tools";

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "board", label: "Deliverables board" },
  { id: "subjects", label: "Subject lines" },
  { id: "automations", label: "Automations" },
  { id: "report", label: "Account report" },
  { id: "tools", label: "GHL tools" },
  { id: "sops", label: "Playbooks" },
  { id: "knowledge", label: "Knowledge" },
  { id: "notes", label: "Notes" },
  { id: "linkedin", label: "LinkedIn" },
];

export default function LifecyclePage() {
  const router = useRouter();
  const [tool, setTool] = useState<Tool | null>(null);
  const [data, setData] = useState<LifecycleDashboard | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [denied, setDenied] = useState(false);

  const loadTools = useCallback(async (force = false) => {
    if (force) setSyncing(true);
    try {
      const res = await fetch(`/api/lifecycle${force ? "?refresh=1" : ""}`);
      if (res.status === 401) {
        setDenied(true);
        return;
      }
      if (res.ok) setData(await res.json());
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (tool && !data) void loadTools();
  }, [tool, data, loadTools]);

  useEffect(() => {
    if (denied) router.push("/login");
  }, [denied, router]);

  const refresh = useCallback(() => void loadTools(false), [loadTools]);

  return (
    <div className={`lh-page ${tool === "board" ? "hud hud-fill" : ""}`}>
      <header className="lh-page-bar">
        <div>
          <h1>Lifecycle</h1>
          <p className="muted">Email clients — contract, sends, and launch work.</p>
        </div>
        <div className="lh-page-bar-right">
          {tool ? (
            <>
              {tool === "linkedin" || tool === "tools" ? (
                <button
                  className="btn btn-secondary"
                  disabled={syncing}
                  onClick={() => void loadTools(true)}
                >
                  {syncing ? "Syncing" : "Resync"}
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={() => setTool(null)}>
                Back to clients
              </button>
            </>
          ) : (
            <label className="lh-tools-pick">
              <span className="sr-only">More tools</span>
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value as Tool;
                  if (v) setTool(v);
                }}
              >
                <option value="">More tools</option>
                {TOOLS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {tool === null ? <ClientHub /> : null}

      {tool && !data ? <p className="lh-empty">Loading…</p> : null}

      {tool && data ? (
        <div className={`hud ${tool === "board" ? "hud-fill" : ""}`}>
          <div className={`hud-page ${tool === "board" ? "hud-page-fill" : ""}`}>
            {tool === "board" ? <BoardPanel clients={data.clients} /> : null}
            {tool === "linkedin" ? (
              <LinkedInHub
                data={data.linkedIn}
                clients={data.clients}
                counts={data.counts}
                refreshSettings={data.refreshSettings}
                onChanged={refresh}
              />
            ) : null}
            {tool === "automations" ? (
              <AutomationsPanel
                automations={data.automations}
                ghl={data.ghl}
                clients={data.clients}
                onChanged={refresh}
              />
            ) : null}
            {tool === "sops" ? (
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
                          <a href={s.link} target="_blank" rel="noreferrer">
                            {s.title}
                          </a>
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
            {tool === "knowledge" ? <KnowledgePanel /> : null}
            {tool === "notes" ? (
              <NotesPanel
                notes={data.notes}
                links={data.links}
                clients={data.clients}
                onChanged={refresh}
              />
            ) : null}
            {tool === "subjects" ? <SubjectBankPanel /> : null}
            {tool === "report" ? <ReportPanel clients={data.clients} /> : null}
            {tool === "tools" ? <ToolsPanel /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
