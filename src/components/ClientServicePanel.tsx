"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { cell, mapColumns, parseCsv } from "@/lib/csv";
import { isSnapshotAllowlisted } from "@/lib/snapshot-allowlist";

// The per-client panel behind a client name in the Client Services Hub.
//
// Three jobs in the order the week runs: queue the leads we want the client to
// confirm, log the wins worth telling them about, then send the ask that
// carries both. Everything here reuses endpoints that already existed, so the
// panel adds no new way to reach a client.

type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  source: string;
  received_on: string;
  notes: string;
  converted: "unknown" | "yes" | "no";
  client_note: string;
};

type Win = {
  id: string;
  body: string;
  happened_on: string;
};

export type PanelClient = {
  clientId: string;
  name: string;
  contactName: string;
  contactEmail: string;
  accountManager: string;
  hasBasecamp: boolean;
  paused: boolean;
  monthLabel: string;
  leadsWaiting: number;
  revenueIn: boolean;
  emailSentAt: string | null;
  basecampSentAt: string | null;
};

// Mirrors LEAD_SOURCE_OPTIONS in lib/snapshot.ts. Kept local because that
// module imports the database, and the snapshot page keeps its own copy for the
// same reason.
const LEAD_SOURCES: { value: string; label: string }[] = [
  { value: "form", label: "Filled a form" },
  { value: "call", label: "Called in" },
  { value: "other", label: "Other" },
];

/**
 * Headers we accept for a lead CSV, in priority order per field.
 *
 * Deliberately generous, because these files come from whatever the client
 * happened to export: a CRM, a form tool, or a sheet somebody typed by hand.
 * "First name", "first_name" and "fname" all normalise to the same key.
 */
const LEAD_COLUMNS = {
  firstName: ["firstname", "first", "fname", "givenname", "name"],
  lastName: ["lastname", "last", "lname", "surname", "familyname"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "phonenumber", "mobile", "cell", "telephone", "tel"],
  source: ["source", "how", "howtheycamein", "leadsource", "channel"],
  receivedOn: ["receivedon", "date", "datereceived", "camein", "createdat", "submitted"],
  notes: ["notes", "note", "comment", "comments", "detail", "details"],
} as const;

type CsvRow = {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  receivedOn: string;
  notes: string;
  problem: string;
};

type CsvPreview = {
  fileName: string;
  rows: CsvRow[];
  unmatched: string[];
  missingFirstName: boolean;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce the date formats a spreadsheet actually produces into YYYY-MM-DD.
 * Anything unrecognised is returned untouched so the row can be flagged rather
 * than silently rewritten to the wrong day.
 */
function toYmd(raw: string): string {
  const v = raw.trim();
  if (!v || YMD.test(v)) return v;
  const us = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const [, a, b, c] = us;
    const year = c.length === 2 ? `20${c}` : c;
    return `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }
  return v;
}

function normSource(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "form";
  if (v.startsWith("call") || v.includes("phone")) return "call";
  if (v.startsWith("form") || v.includes("web")) return "form";
  return "other";
}

const CONVERTED_LABEL: Record<Lead["converted"], string> = {
  unknown: "Waiting on them",
  yes: "Converted",
  no: "Did not convert",
};

const CONVERTED_TONE: Record<Lead["converted"], string> = {
  unknown: "is-warn",
  yes: "is-good",
  no: "is-muted",
};

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDay(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ClientServicePanel({
  client,
  isAdmin,
  sendingOn,
  onClose,
  onSend,
  onChanged,
  sending,
}: {
  client: PanelClient;
  isAdmin: boolean;
  sendingOn: boolean;
  onClose: () => void;
  onSend: () => void;
  /** Adding a lead changes the client's outstanding count, so the hub's row and
   *  week totals have to be re-read rather than left showing stale numbers. */
  onChanged: () => void;
  sending: boolean;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [lead, setLead] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "form",
    receivedOn: todayYmd(),
    notes: "",
  });
  const [win, setWin] = useState({ body: "", happenedOn: todayYmd() });
  const [csv, setCsv] = useState<CsvPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/client-services?clientId=${client.clientId}`);
      if (!res.ok) {
        setError("Could not load this client.");
        return;
      }
      const data = await res.json();
      setLeads(data.leads || []);
      setWins(data.wins || []);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [client.clientId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes, which the app's other modals do not do yet and which is the
  // cheapest way to make a panel feel like a panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addLead(e: FormEvent) {
    e.preventDefault();
    if (!lead.firstName.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch(
      `/api/snapshot/accounts/${client.clientId}/leads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add that lead.");
      return;
    }
    const data = await res.json();
    setLeads((prev) => [data.lead, ...prev]);
    onChanged();
    setLead({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      source: "form",
      receivedOn: todayYmd(),
      notes: "",
    });
  }

  // Parse locally and show what will land before anything is written. lib/csv
  // is pure, so this needs no round trip and nothing reaches the server until
  // the person presses Import.
  function readFile(file: File) {
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseCsv(String(reader.result || ""));
      if (table.length < 2) {
        setError("That file has a header but no rows.");
        setCsv(null);
        return;
      }
      const [header, ...body] = table;
      const cols = mapColumns(header, LEAD_COLUMNS);
      const used = new Set(Object.values(cols).filter((i) => i >= 0));
      // A single "Name" column holding "Dana Ruiz" is common in exports. Split it
      // only when there is no separate last-name column to take the second half,
      // so a real first-name column containing a space is left alone.
      const splitFullName =
        cols.lastName < 0 &&
        cols.firstName >= 0 &&
        ["name", "fullname"].includes(
          (header[cols.firstName] || "").toLowerCase().replace(/[^a-z0-9]/g, "")
        );

      const rows: CsvRow[] = body.map((r, i) => {
        let firstName = cell(r, cols.firstName);
        let splitLast = "";
        if (splitFullName && firstName.includes(" ")) {
          const parts = firstName.split(/\s+/);
          firstName = parts.shift() || "";
          splitLast = parts.join(" ");
        }
        const receivedOn = toYmd(cell(r, cols.receivedOn));
        let problem = "";
        if (!firstName) problem = "No first name, will be skipped";
        else if (receivedOn && !YMD.test(receivedOn)) problem = `Date "${receivedOn}" is not a date I can read`;
        return {
          row: i + 1,
          firstName,
          lastName: splitLast || cell(r, cols.lastName),
          email: cell(r, cols.email),
          phone: cell(r, cols.phone),
          source: normSource(cell(r, cols.source)),
          receivedOn,
          notes: cell(r, cols.notes),
          problem,
        };
      });
      setCsv({
        fileName: file.name,
        rows,
        unmatched: header.filter((h, i) => h.trim() && !used.has(i)),
        missingFirstName: cols.firstName < 0,
      });
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  async function commitCsv() {
    if (!csv) return;
    const good = csv.rows.filter((r) => !r.problem);
    if (good.length === 0) return;
    setImporting(true);
    setError("");
    const res = await fetch(`/api/snapshot/accounts/${client.clientId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leads: good.map((r) => ({
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          phone: r.phone,
          source: r.source,
          receivedOn: r.receivedOn,
          notes: r.notes,
        })),
      }),
    });
    setImporting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "That import did not work.");
      return;
    }
    const d = await res.json();
    setLeads((prev) => [...(d.leads || []), ...prev]);
    onChanged();
    setCsv(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addWin(e: FormEvent) {
    e.preventDefault();
    if (!win.body.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/snapshot/win", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.clientId,
        body: win.body,
        happenedOn: win.happenedOn,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add that win.");
      return;
    }
    const data = await res.json();
    setWins((prev) => [data.win, ...prev]);
    setWin({ body: "", happenedOn: todayYmd() });
  }

  const unanswered = leads.filter((l) => l.converted === "unknown");
  const asked = Boolean(client.emailSentAt || client.basecampSentAt);
  const dead = !client.contactEmail.trim() && !client.hasBasecamp;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide card card-pad stack csp"
        role="dialog"
        aria-modal="true"
        aria-label={`${client.name} client services`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="csp-head">
          <div>
            <h2 className="csp-name">{client.name}</h2>
            <p className="csp-meta">
              {client.contactName || "No contact set"}
              {client.contactEmail ? ` · ${client.contactEmail}` : ""}
              {client.accountManager ? ` · ${client.accountManager}` : " · Unassigned"}
            </p>
          </div>
          <div className="csp-head-side">
            {isSnapshotAllowlisted(client.name) ? (
              <Link
                className="btn btn-ghost btn-sm"
                href={`/admin/snapshot/${client.clientId}`}
              >
                Full account
              </Link>
            ) : null}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {/* ---- 1. the ask itself */}
        <section className="csp-sec">
          <div className="csp-sec-head">
            <h3>This week&apos;s ask</h3>
            {client.paused ? <span className="cs-pill">Paused</span> : null}
          </div>
          <ul className="csp-ask">
            <li className={unanswered.length ? "is-open" : "is-done"}>
              {unanswered.length
                ? `${unanswered.length} lead${unanswered.length === 1 ? "" : "s"} for them to confirm`
                : "No leads waiting on them"}
            </li>
            <li className={client.revenueIn ? "is-done" : "is-open"}>
              {client.revenueIn
                ? "Revenue is in"
                : `${client.monthLabel} revenue still owed`}
            </li>
          </ul>

          {isAdmin ? (
            <div className="csp-send">
              <button
                className="btn btn-sm"
                onClick={onSend}
                disabled={sending || dead}
                title={
                  dead
                    ? "No contact email and no Basecamp project, so there is nowhere for the ask to go."
                    : undefined
                }
              >
                {sending
                  ? "Sending..."
                  : asked
                    ? "Send the snapshot again"
                    : "Send weekly snapshot"}
              </button>
              <span className="csp-send-note">
                {dead
                  ? "Add a contact email or a Basecamp project first."
                  : !sendingOn
                    ? "Sending is switched off, so this reports what it would have done."
                    : asked
                      ? "Already asked this week. Sending again re-sends the same ask."
                      : "Emails the contact and posts a Basecamp card where both are set."}
              </span>
            </div>
          ) : null}
        </section>

        {/* ---- 2. leads we want confirmed */}
        <section className="csp-sec">
          <div className="csp-sec-head">
            <h3>Leads to confirm</h3>
            <span className="csp-count">{unanswered.length} waiting</span>
          </div>

          {loading ? (
            <p className="muted">Loading...</p>
          ) : leads.length === 0 ? (
            <p className="muted csp-empty">
              No leads logged yet. Add the ones you want this client to confirm.
            </p>
          ) : (
            <ul className="csp-list">
              {leads.slice(0, 8).map((l) => (
                <li key={l.id}>
                  <span className="csp-list-main">
                    {l.first_name} {l.last_name}
                    {l.received_on ? (
                      <span className="csp-list-sub">{fmtDay(l.received_on)}</span>
                    ) : null}
                  </span>
                  <span className={`cs-pill ${CONVERTED_TONE[l.converted]}`}>
                    {CONVERTED_LABEL[l.converted]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* CSV upload. Sits above the manual form because a file is the fast
              path when a client sends a week's leads in one go. */}
          <div className="csp-csv">
            <div className="csp-csv-head">
              <div>
                <strong>Upload a CSV</strong>
                <p className="csp-csv-sub">
                  Any column order. First name is the only column that has to be
                  there. Nothing is saved until you have seen what will land.
                </p>
              </div>
              <label className="btn btn-secondary btn-sm csp-csv-pick">
                Choose file
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f);
                  }}
                />
              </label>
            </div>

            {csv ? (
              <div className="csp-csv-preview">
                <div className="csp-csv-stat">
                  <span>{csv.fileName}</span>
                  <span>
                    <strong>{csv.rows.filter((r) => !r.problem).length}</strong> will import
                    {csv.rows.some((r) => r.problem)
                      ? `, ${csv.rows.filter((r) => r.problem).length} skipped`
                      : ""}
                  </span>
                </div>

                {csv.missingFirstName ? (
                  <p className="csp-csv-warn">
                    No first name column found. Name one of the columns
                    &quot;First name&quot; and upload again.
                  </p>
                ) : null}

                {csv.unmatched.length ? (
                  <p className="csp-csv-note">
                    Ignored columns: {csv.unmatched.join(", ")}
                  </p>
                ) : null}

                <div className="csp-csv-rows">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Came in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csv.rows.slice(0, 8).map((r) => (
                        <tr key={r.row} className={r.problem ? "is-bad" : ""}>
                          <td>{r.row}</td>
                          <td>
                            {`${r.firstName} ${r.lastName}`.trim() || "-"}
                            {r.problem ? (
                              <span className="csp-csv-prob">{r.problem}</span>
                            ) : null}
                          </td>
                          <td>{r.email || "-"}</td>
                          <td>{r.phone || "-"}</td>
                          <td>{r.receivedOn || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csv.rows.length > 8 ? (
                    <p className="csp-csv-note">
                      Showing the first 8 of {csv.rows.length} rows.
                    </p>
                  ) : null}
                </div>

                <div className="csp-form-foot">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setCsv(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={commitCsv}
                    disabled={importing || csv.rows.every((r) => r.problem)}
                  >
                    {importing
                      ? "Importing..."
                      : `Import ${csv.rows.filter((r) => !r.problem).length} leads`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <form className="csp-form" onSubmit={addLead}>
            <div className="csp-grid">
              <label className="field">
                <span>First name</span>
                <input
                  value={lead.firstName}
                  onChange={(e) => setLead({ ...lead, firstName: e.target.value })}
                  placeholder="Required"
                />
              </label>
              <label className="field">
                <span>Last name</span>
                <input
                  value={lead.lastName}
                  onChange={(e) => setLead({ ...lead, lastName: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={lead.email}
                  onChange={(e) => setLead({ ...lead, email: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Phone</span>
                <input
                  value={lead.phone}
                  onChange={(e) => setLead({ ...lead, phone: e.target.value })}
                />
              </label>
              <label className="field">
                <span>How they came in</span>
                <select
                  className="select-clean"
                  value={lead.source}
                  onChange={(e) => setLead({ ...lead, source: e.target.value })}
                >
                  {LEAD_SOURCES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Came in on</span>
                <input
                  type="date"
                  value={lead.receivedOn}
                  onChange={(e) => setLead({ ...lead, receivedOn: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Note for the team, not the client</span>
              <input
                value={lead.notes}
                onChange={(e) => setLead({ ...lead, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <div className="csp-form-foot">
              <button
                className="btn btn-secondary btn-sm"
                type="submit"
                disabled={saving || !lead.firstName.trim()}
              >
                {saving ? "Adding..." : "Add lead"}
              </button>
            </div>
          </form>
        </section>

        {/* ---- 3. wins worth telling them about */}
        <section className="csp-sec">
          <div className="csp-sec-head">
            <h3>Wins</h3>
            <span className="csp-count">{wins.length} logged</span>
          </div>

          {loading ? (
            <p className="muted">Loading...</p>
          ) : wins.length === 0 ? (
            <p className="muted csp-empty">
              Nothing logged yet. Wins show up on the client&apos;s snapshot.
            </p>
          ) : (
            <ul className="csp-list">
              {wins.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <span className="csp-list-main">{w.body}</span>
                  {w.happened_on ? (
                    <span className="csp-list-sub">{fmtDay(w.happened_on)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form className="csp-form" onSubmit={addWin}>
            <label className="field">
              <span>What went well</span>
              <input
                value={win.body}
                onChange={(e) => setWin({ ...win, body: e.target.value })}
                placeholder="Booked 14 jobs off the spring campaign"
              />
            </label>
            <div className="csp-form-foot">
              <label className="field csp-date">
                <span>Happened on</span>
                <input
                  type="date"
                  value={win.happenedOn}
                  onChange={(e) => setWin({ ...win, happenedOn: e.target.value })}
                />
              </label>
              <button
                className="btn btn-secondary btn-sm"
                type="submit"
                disabled={saving || !win.body.trim()}
              >
                {saving ? "Adding..." : "Add win"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
