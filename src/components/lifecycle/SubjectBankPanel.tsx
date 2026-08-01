"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Every subject line the agency has written, searchable across the whole book.
//
// The point is reuse: when you sit down to write for one client, the lines that
// already worked for the other fifty should be one search away rather than
// something you re-derive from memory.

type SubjectLine = {
  id: string;
  subject: string;
  previewText: string;
  clientId: string | null;
  clientName: string;
  source: "calendar" | "review";
  date: string;
  status: string;
  purpose: string;
  offer: string;
  audience: string;
  monthOpenRate: number | null;
};

type Bank = {
  lines: SubjectLine[];
  clients: string[];
  totals: { lines: number; fromCalendar: number; fromReview: number; withOpenRate: number };
};

export function SubjectBankPanel() {
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [client, setClient] = useState("");
  const [sort, setSort] = useState<"recent" | "open">("recent");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lifecycle/subjects");
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not load subject lines.");
        return;
      }
      setBank(await res.json());
    } catch {
      setError("Could not load subject lines.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (!bank) return [];
    const needle = q.trim().toLowerCase();
    const rows = bank.lines.filter((l) => {
      if (client && l.clientName !== client) return false;
      if (!needle) return true;
      // Search the strategy around the line too, so "winback" or "$89" finds it
      // even when the words aren't in the subject itself.
      return [l.subject, l.previewText, l.purpose, l.offer, l.audience, l.clientName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    if (sort === "open") {
      // Lines with no rate sink rather than sorting as zero, which would put
      // unmeasured work at the bottom as though it had failed.
      return [...rows].sort((a, b) => (b.monthOpenRate ?? -1) - (a.monthOpenRate ?? -1));
    }
    return rows;
  }, [bank, q, client, sort]);

  async function copy(line: SubjectLine) {
    try {
      await navigator.clipboard.writeText(line.subject);
      setCopied(line.id);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      /* clipboard blocked; the text is on screen to copy by hand */
    }
  }

  if (error) return <p className="hud-err">{error}</p>;
  if (!bank) return <p className="hud-empty">Loading subject lines.</p>;

  return (
    <div className="hud-stack">
      <div className="hud-panel">
        <div className="hud-readouts">
          <div className="hud-readout">
            <b>{bank.totals.lines}</b>
            <span>subject lines</span>
          </div>
          <div className="hud-readout">
            <b>{bank.totals.fromCalendar}</b>
            <span>from the calendar</span>
          </div>
          <div className="hud-readout">
            <b>{bank.totals.fromReview}</b>
            <span>from review packages</span>
          </div>
          <div className="hud-readout">
            <b>{bank.totals.withOpenRate}</b>
            <span>with a month open rate</span>
          </div>
        </div>
        <p className="hud-empty" style={{ fontSize: 12 }}>
          Open rate is the account&rsquo;s rate for the month the line went out, not this
          email&rsquo;s. Per-email stats aren&rsquo;t stored here, so read it as the context the
          line ran in rather than a score for the line.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subjects, preview text, offers…"
          style={{ minWidth: 280, flex: 1 }}
        />
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Every client</option>
          {bank.clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "open")}>
          <option value="recent">Newest first</option>
          <option value="open">Best month open rate</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="hud-panel">
          <p className="hud-empty">
            {bank.totals.lines === 0
              ? "No subject lines recorded yet. They come from the send calendar and from review packages."
              : "Nothing matches that search."}
          </p>
        </div>
      ) : (
        shown.map((l) => (
          <div key={l.id} className="hud-panel" style={{ padding: "14px 18px" }}>
            <div className="hud-camp-top">
              <div style={{ minWidth: 0 }}>
                <div className="hud-q-name">{l.subject}</div>
                {l.previewText ? (
                  <div className="hud-camp-sub">{l.previewText}</div>
                ) : null}
                <div className="hud-camp-sub" style={{ marginTop: 6 }}>
                  {l.clientName}
                  {l.date ? ` · ${l.date}` : ""}
                  {l.purpose ? ` · ${l.purpose}` : ""}
                  {l.offer ? ` · ${l.offer}` : ""}
                </div>
              </div>
              <div className="hud-q-faults" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {l.monthOpenRate !== null ? (
                  <span className="hud-chip hud-chip-ok">{l.monthOpenRate.toFixed(1)}%</span>
                ) : null}
                <span className="hud-chip hud-chip-idle">
                  {l.source === "calendar" ? l.status || "calendar" : "review"}
                </span>
                <button type="button" className="hud-btn hud-btn-quiet" onClick={() => copy(l)}>
                  {copied === l.id ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
