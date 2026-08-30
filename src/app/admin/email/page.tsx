"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Trend = {
  month: string;
  sends: number;
  delivered: number;
  openRate: number;
  clickRate: number;
};

type SubjectRow = {
  subject: string;
  sends: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  clients: string[];
  bestClient: string;
  latestSentAt: string;
};

type ClientRow = {
  clientId: string | null;
  clientName: string;
  sends: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  latestSentAt: string;
};

type SendRow = {
  id: string;
  clientName: string;
  campaignName: string;
  subject: string;
  sentAt: string;
  delivered: number;
  openRate: number;
  clickRate: number;
  source: string;
};

type Dashboard = {
  configured: boolean;
  lastSyncedAt: string | null;
  totals: {
    sends: number;
    clients: number;
    delivered: number;
    opened: number;
    clicked: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
  };
  trends: Trend[];
  topSubjects: SubjectRow[];
  bottomSubjects: SubjectRow[];
  clients: ClientRow[];
  recent: SendRow[];
  linkedLocations: number;
  unlinkedClients: number;
};

type SyncResult = {
  ok: boolean;
  configured: boolean;
  locationsScanned: number;
  campaignsUpserted: number;
  failures: Array<{ locationId: string; clientName: string; error: string }>;
  syncedAt: string;
  error?: string;
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function prettyMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function TrendChart({ trends }: { trends: Trend[] }) {
  const maxOpen = Math.max(...trends.map((t) => t.openRate), 1);
  if (!trends.length) {
    return <p className="ea-empty">No monthly trend yet — sync GHL sends to populate this.</p>;
  }
  return (
    <div className="ea-trend" role="img" aria-label="Open rate by month">
      {trends.map((t) => (
        <div key={t.month} className="ea-trend-col">
          <div className="ea-trend-bars">
            <div
              className="ea-trend-bar ea-trend-bar-open"
              style={{ height: `${Math.max(4, (t.openRate / maxOpen) * 100)}%` }}
              title={`Open ${pct(t.openRate)}`}
            />
            <div
              className="ea-trend-bar ea-trend-bar-click"
              style={{ height: `${Math.max(3, (t.clickRate / maxOpen) * 100)}%` }}
              title={`Click ${pct(t.clickRate)}`}
            />
          </div>
          <span className="ea-trend-label">{prettyMonth(t.month)}</span>
          <span className="ea-trend-val">{pct(t.openRate)}</span>
        </div>
      ))}
    </div>
  );
}

export default function EmailAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/email-analytics");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not load email analytics.");
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError("Could not load email analytics.");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setSyncNote("");
    try {
      const res = await fetch("/api/email-analytics/sync", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        sync?: SyncResult;
        dashboard?: Dashboard;
        error?: string;
      };
      if (body.dashboard) setData(body.dashboard);
      const sync = body.sync;
      if (!sync) {
        setSyncNote(body.error || "Sync failed.");
        return;
      }
      if (!sync.configured) {
        setSyncNote(sync.error || "GoHighLevel is not connected.");
        return;
      }
      const failBit =
        sync.failures.length > 0
          ? ` ${sync.failures.length} location${sync.failures.length === 1 ? "" : "s"} failed.`
          : "";
      setSyncNote(
        `Synced ${sync.campaignsUpserted} send${sync.campaignsUpserted === 1 ? "" : "s"} across ${sync.locationsScanned} location${sync.locationsScanned === 1 ? "" : "s"}.${failBit}`
      );
    } catch {
      setSyncNote("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const clientNames = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.recent.map((r) => r.clientName))].sort();
  }, [data]);

  const recent = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.recent.filter((r) => {
      if (clientFilter && r.clientName !== clientFilter) return false;
      if (!needle) return true;
      return [r.subject, r.campaignName, r.clientName].join(" ").toLowerCase().includes(needle);
    });
  }, [data, clientFilter, q]);

  if (error) {
    return (
      <div className="ea-page">
        <p className="ea-err">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ea-page">
        <p className="ea-empty">Loading email analytics…</p>
      </div>
    );
  }

  return (
    <div className="ea-page">
      <header className="ea-bar">
        <div>
          <p className="ea-eyebrow">GoHighLevel</p>
          <h1>Email analytics</h1>
          <p className="ea-sub">
            Subject lines that landed, who is actually engaging, and how opens are trending —
            pulled from GHL sends across linked clients.
          </p>
        </div>
        <div className="ea-bar-right">
          <button type="button" className="btn btn-secondary" disabled={syncing} onClick={() => void sync()}>
            {syncing ? "Syncing…" : "Sync from GHL"}
          </button>
          <Link href="/admin/lifecycle" className="btn btn-ghost">
            Lifecycle
          </Link>
        </div>
      </header>

      <div className="ea-meta">
        <span>
          {data.lastSyncedAt
            ? `Last synced ${prettyDate(data.lastSyncedAt)}`
            : "Not synced yet — run Sync from GHL to pull sends."}
        </span>
        <span>
          {data.linkedLocations} linked location{data.linkedLocations === 1 ? "" : "s"}
          {data.unlinkedClients > 0 ? ` · ${data.unlinkedClients} clients still unlinked` : ""}
        </span>
        {!data.configured ? (
          <span className="ea-warn">GHL OAuth is not configured in this environment.</span>
        ) : null}
        {syncNote ? <span className="ea-sync-note">{syncNote}</span> : null}
      </div>

      <section className="ea-readouts">
        <div className="ea-readout">
          <b>{data.totals.sends.toLocaleString()}</b>
          <span>sends cached</span>
        </div>
        <div className="ea-readout">
          <b>{pct(data.totals.openRate)}</b>
          <span>avg open rate</span>
        </div>
        <div className="ea-readout">
          <b>{pct(data.totals.clickRate)}</b>
          <span>avg click rate</span>
        </div>
        <div className="ea-readout">
          <b>{pct(data.totals.replyRate)}</b>
          <span>reply rate</span>
        </div>
        <div className="ea-readout">
          <b>{data.totals.delivered.toLocaleString()}</b>
          <span>delivered</span>
        </div>
        <div className="ea-readout">
          <b>{data.totals.clients}</b>
          <span>clients with sends</span>
        </div>
      </section>

      <div className="ea-grid">
        <section className="ea-panel ea-panel-wide">
          <div className="ea-panel-head">
            <h2>Open rate trend</h2>
            <p>Monthly open (tall) and click (short) rates across synced sends.</p>
          </div>
          <TrendChart trends={data.trends} />
        </section>

        <section className="ea-panel">
          <div className="ea-panel-head">
            <h2>Subject lines that worked</h2>
            <p>Ranked by open rate · at least 50 delivered so tiny tests cannot steal the top.</p>
          </div>
          {data.topSubjects.length === 0 ? (
            <p className="ea-empty">No ranked subjects yet. Sync sends that include a subject line.</p>
          ) : (
            <ol className="ea-rank">
              {data.topSubjects.map((row, i) => (
                <li key={`${row.subject}-${i}`}>
                  <div className="ea-rank-main">
                    <strong>{row.subject}</strong>
                    <span>
                      {row.clients.length === 1
                        ? row.clients[0]
                        : `${row.clients.length} clients · best on ${row.bestClient}`}
                      {" · "}
                      {row.sends} send{row.sends === 1 ? "" : "s"} · {row.delivered.toLocaleString()} delivered
                    </span>
                  </div>
                  <div className="ea-rank-rates">
                    <b>{pct(row.openRate)}</b>
                    <em>open</em>
                    <b>{pct(row.clickRate)}</b>
                    <em>click</em>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="ea-panel">
          <div className="ea-panel-head">
            <h2>Soft performers</h2>
            <p>Same sample floor, lowest open rates — candidates to rewrite or retire.</p>
          </div>
          {data.bottomSubjects.length === 0 ? (
            <p className="ea-empty">Not enough subject data yet.</p>
          ) : (
            <ol className="ea-rank ea-rank-soft">
              {data.bottomSubjects.map((row, i) => (
                <li key={`soft-${row.subject}-${i}`}>
                  <div className="ea-rank-main">
                    <strong>{row.subject}</strong>
                    <span>
                      {row.bestClient} · {row.delivered.toLocaleString()} delivered
                    </span>
                  </div>
                  <div className="ea-rank-rates">
                    <b>{pct(row.openRate)}</b>
                    <em>open</em>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="ea-panel ea-panel-wide">
          <div className="ea-panel-head">
            <h2>Who is really engaged</h2>
            <p>Clients ranked by open rate on synced GHL sends.</p>
          </div>
          {data.clients.length === 0 ? (
            <p className="ea-empty">No client engagement yet.</p>
          ) : (
            <div className="ea-table-wrap">
              <table className="ea-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="num">Sends</th>
                    <th className="num">Delivered</th>
                    <th className="num">Open</th>
                    <th className="num">Click</th>
                    <th className="num">Reply</th>
                    <th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.clientId || c.clientName}>
                      <td>
                        {c.clientId ? (
                          <Link href={`/admin/clients/${c.clientId}`}>{c.clientName}</Link>
                        ) : (
                          c.clientName
                        )}
                      </td>
                      <td className="num">{c.sends}</td>
                      <td className="num">{c.delivered.toLocaleString()}</td>
                      <td className="num">{pct(c.openRate)}</td>
                      <td className="num">{pct(c.clickRate)}</td>
                      <td className="num">{pct(c.replyRate)}</td>
                      <td>{prettyDate(c.latestSentAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="ea-panel ea-panel-wide">
          <div className="ea-panel-head">
            <h2>Recent sends</h2>
            <p>Individual GHL campaigns and bulk actions in the cache.</p>
          </div>
          <div className="ea-filters">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, campaign, client…"
            />
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">Every client</option>
              {clientNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {recent.length === 0 ? (
            <p className="ea-empty">
              {data.totals.sends === 0
                ? "Nothing cached yet. Hit Sync from GHL after locations are linked on Clients."
                : "Nothing matches that filter."}
            </p>
          ) : (
            <div className="ea-table-wrap">
              <table className="ea-table">
                <thead>
                  <tr>
                    <th>Subject / campaign</th>
                    <th>Client</th>
                    <th>Sent</th>
                    <th className="num">Delivered</th>
                    <th className="num">Open</th>
                    <th className="num">Click</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="ea-subject">
                          <strong>{r.subject || r.campaignName || "Untitled"}</strong>
                          {r.subject && r.campaignName ? <span>{r.campaignName}</span> : null}
                        </div>
                      </td>
                      <td>{r.clientName}</td>
                      <td>{prettyDate(r.sentAt)}</td>
                      <td className="num">{r.delivered.toLocaleString()}</td>
                      <td className="num">{pct(r.openRate)}</td>
                      <td className="num">{pct(r.clickRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
