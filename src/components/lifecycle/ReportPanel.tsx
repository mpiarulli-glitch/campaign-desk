"use client";

import { useCallback, useEffect, useState } from "react";
import { PLATFORM_LABELS, type AccountReport, type ClientRef } from "./types";

const WINDOWS = [3, 6, 12];

export function ReportPanel({ clients }: { clients: ClientRef[] }) {
  const [clientId, setClientId] = useState("");
  const [months, setMonths] = useState(6);
  const [report, setReport] = useState<AccountReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/report/${clientId}?months=${months}`);
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not build that report.");
        setReport(null);
        return;
      }
      setReport((await res.json()).report);
    } catch {
      setError("Could not build that report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, months]);

  useEffect(() => {
    if (clientId) void run();
  }, [clientId, months, run]);

  return (
    <div className="hud-stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Pick an account…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {WINDOWS.map((m) => (
            <option key={m} value={m}>Last {m} months</option>
          ))}
        </select>
        <button className="hud-btn" disabled={!clientId || loading} onClick={run}>
          {loading ? "Building…" : "Run report"}
        </button>
      </div>

      {error ? <p className="hud-err">{error}</p> : null}

      {!report ? (
        <p className="hud-empty">Pick an account to see email performance, automations and LinkedIn together.</p>
      ) : (
        <div className="hud-stack">
          <div className="hud-panel">
            <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>{report.clientName}</h2>
            <div className="hud-readouts">
              <div className="hud-readout"><b>{report.email.campaignsSent.toLocaleString()}</b><span>emails sent</span></div>
              <div className="hud-readout"><b>{report.email.recipients.toLocaleString()}</b><span>recipients</span></div>
              <div className="hud-readout"><b>{report.email.openRate.toFixed(1)}%</b><span>open rate</span></div>
              <div className="hud-readout"><b>{report.email.clickRate.toFixed(1)}%</b><span>click rate</span></div>
              {/* Revenue readout removed 2026-07-31: no revenue figures in the app. */}
              <div className="hud-readout"><b>{report.email.leads.toLocaleString()}</b><span>leads</span></div>
            </div>
            <p className="hud-empty" style={{ fontSize: 12 }}>
              Email figures cover {report.email.months} month
              {report.email.months === 1 ? "" : "s"} of recorded data in the last {months}.
            </p>
          </div>

          <div className="hud-panel">
            <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>LinkedIn</h2>
            {report.linkedIn.campaigns.length === 0 ? (
              <p className="hud-empty">
                No Skylead campaigns are assigned to this account yet. Assign them from the LinkedIn tab.
              </p>
            ) : (
              <>
                <div className="hud-readouts">
                  <div className="hud-readout"><b>{report.linkedIn.live}</b><span>live campaigns</span></div>
                  <div className="hud-readout"><b>{report.linkedIn.connectionsRequested.toLocaleString()}</b><span>requests</span></div>
                  <div className="hud-readout"><b>{report.linkedIn.acceptanceRate.toFixed(1)}%</b><span>accepted</span></div>
                  <div className="hud-readout"><b>{report.linkedIn.replies.toLocaleString()}</b><span>replies</span></div>
                  <div className="hud-readout"><b>{report.linkedIn.responseRate.toFixed(1)}%</b><span>reply rate</span></div>
                  <div className="hud-readout"><b>{report.linkedIn.needsRefresh}</b><span>need refresh</span></div>
                </div>
                <p className="hud-empty" style={{ fontSize: 12 }}>
                  Skylead reports lifetime totals, so these are not limited to the last {months} months.
                </p>
              </>
            )}
          </div>

          <div className="hud-grid hud-grid-2">
            <div className="hud-panel">
              <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>Automations</h2>
              {report.automations.length === 0 ? (
                <p className="hud-empty">None logged for this account.</p>
              ) : (
                report.automations.map((a) => (
                  <div key={a.id} className="hud-row">
                    <span>{a.name}</span>
                    <span className="hud-empty">
                      {PLATFORM_LABELS[a.platform] ?? a.platform} · {a.status}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="hud-panel">
              <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>Open approvals</h2>
              {report.approvals.length === 0 ? (
                <p className="hud-empty">Nothing waiting.</p>
              ) : (
                report.approvals.map((a) => (
                  <div key={a.id} className="hud-row">
                    <a href={`/admin/campaigns/${a.id}`}>{a.title}</a>
                    <span className="hud-empty">{a.waitingDays}d</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {report.notes.length > 0 || report.links.length > 0 ? (
            <div className="hud-grid hud-grid-2">
              <div className="hud-panel">
                <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>Notes</h2>
                {report.notes.map((n) => (
                  <div key={n.id} className="hud-row">
                    <span>{n.title || "Untitled note"}</span>
                    <span className="hud-empty">{new Date(n.updated_at).toLocaleDateString()}</span>
                  </div>
                ))}
                {report.notes.length === 0 ? <p className="hud-empty">None.</p> : null}
              </div>
              <div className="hud-panel">
                <h2 className="hud-panel-title" style={{ marginBottom: 14 }}>Links</h2>
                {report.links.map((l) => (
                  <div key={l.id} className="hud-row">
                    <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
                    <span className="hud-empty">{l.category}</span>
                  </div>
                ))}
                {report.links.length === 0 ? <p className="hud-empty">None.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
