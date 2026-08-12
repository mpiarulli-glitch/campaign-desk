"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Importing a client's editorial calendar spreadsheet.
//
// Three steps, in this order, because an import that silently gets a column wrong
// is worse than one that refuses to run: pick the client and file, read the
// preview of what will land, then commit. The commit sends the file text again
// rather than the parsed rows, so the server writes from the same parse it showed.

type Client = { id: string; name: string };
type Mode = "add" | "skip_duplicates" | "replace_range";

type Row = {
  line: number;
  sendDate: string;
  title: string;
  sendTime: string;
  status: string;
  assetType: string;
  audience: string;
  purpose: string;
  offer: string;
  subject: string;
  previewText: string;
  note: string;
  duplicateOf: string | null;
};

type Issue = { line: number; message: string };

type Preview = {
  rows: Row[];
  errors: Issue[];
  warnings: Issue[];
  matched: Record<string, string>;
  unmapped: string[];
  start: string;
  end: string;
  duplicateCount: number;
  existingInRange: number;
  protectedInRange: number;
};

type Batch = {
  batchId: string;
  count: number;
  firstDate: string;
  lastDate: string;
  importedAt: string;
};

type Result = {
  created: number;
  skipped: number;
  deleted: number;
  failed: number;
  start: string;
  end: string;
  approvalCleared: boolean;
  batchId: string;
};

const ASSET_LABEL: Record<string, string> = {
  social_post: "Social post",
  social_video_carousel: "Social video",
  email_campaign: "Email",
  crm_automation: "CRM / SMS",
  blog_post: "Blog",
};

// The order the review table reads in, matching how a planner scans a calendar.
const FIELD_LABELS: [keyof Row, string][] = [
  ["sendDate", "Date"],
  ["title", "Title"],
  ["assetType", "Type"],
  ["status", "Status"],
  ["audience", "Audience"],
  ["purpose", "Purpose"],
  ["offer", "Offer"],
  ["subject", "Subject"],
];

function fmtDate(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CalendarImportModal({
  clients,
  initialClientId,
  onClose,
  onImported,
}: {
  clients: Client[];
  /** The client the calendar is filtered to, if any. Saves a step. */
  initialClientId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [clientId, setClientId] = useState(initialClientId);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<Mode>("skip_duplicates");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [showAllRows, setShowAllRows] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    if (!clientId) { setBatches([]); return; }
    const res = await fetch(`/api/calendar/import?clientId=${clientId}`);
    setBatches(res.ok ? (await res.json()).batches || [] : []);
  }, [clientId]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  // A new client means the previous preview's duplicate diff is about the wrong
  // account, so it has to go rather than mislead.
  useEffect(() => {
    setPreview(null);
    setResult(null);
  }, [clientId]);

  async function readFile(file: File) {
    setError("");
    setResult(null);
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    if (clientId) await runPreview(clientId, text);
  }

  async function runPreview(id: string, text: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id, csv: text }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not read that file."); setPreview(null); return; }
      setPreview(data.preview);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !clientId) return;
    if (
      mode === "replace_range" &&
      !confirm(
        `Replace the plan between ${fmtDate(preview.start)} and ${fmtDate(preview.end)}?\n\n` +
          `${preview.existingInRange} existing entr${preview.existingInRange === 1 ? "y" : "ies"} ` +
          `will be deleted and rebuilt from the file. Client productions are not touched.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, csv, mode, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not import."); return; }
      setResult(data.result);
      setPreview(null);
      await loadBatches();
      onImported();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(batchId: string) {
    if (!confirm("Remove every send from that import?")) return;
    setBusy(true);
    await fetch("/api/calendar/import", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, batchId }),
    });
    setBusy(false);
    setResult(null);
    await loadBatches();
    onImported();
  }

  const rows = preview?.rows || [];
  const visibleRows = showAllRows ? rows : rows.slice(0, 12);
  const willCreate =
    mode === "skip_duplicates" ? rows.length - (preview?.duplicateCount || 0) : rows.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide card card-pad stack" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <strong>Import an editorial calendar</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Upload the calendar sheet as CSV. Nothing is saved until you have seen
              what will land.
            </p>
          </div>
          <a className="btn btn-ghost btn-sm" href="/api/calendar/import/template" download>
            Download template
          </a>
        </div>

        <div className="field">
          <label>Client</label>
          <select
            className="select-clean"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Pick a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Calendar file</label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "center" }}>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
              style={{ flex: 1 }}
            />
            {csv && clientId ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => runPreview(clientId, csv)}
                disabled={busy}
              >
                Re-check
              </button>
            ) : null}
          </div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Needs a date column and a title column. Time, channel, status, audience,
            purpose, offer, subject, preview text, and notes are picked up when present.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {busy && !preview ? <p className="muted">Reading the file…</p> : null}

        {/* ------------------------------------------------------- the result */}
        {result ? (
          <div className="import-result">
            <strong>
              {result.created} send{result.created === 1 ? "" : "s"} added
              {result.skipped ? `, ${result.skipped} already there` : ""}
              {result.deleted ? `, ${result.deleted} replaced` : ""}
            </strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {fmtDate(result.start)} to {fmtDate(result.end)}.
              {/* A partial import must say so here, not only in the preview that is
                  now gone from the screen. */}
              {result.failed
                ? ` ${result.failed} row${result.failed === 1 ? "" : "s"} in the file could not be read and ${result.failed === 1 ? "was" : "were"} left out — fix ${result.failed === 1 ? "it" : "them"} in the sheet and upload again.`
                : ""}
              {result.approvalCleared
                ? " The client's approval was cleared, since the plan they signed off on has changed."
                : ""}
            </p>
          </div>
        ) : null}

        {/* ------------------------------------------------------ the preview */}
        {preview && rows.length > 0 ? (
          <>
            <div className="import-summary">
              <div>
                <span className="import-stat">{rows.length}</span>
                <span className="muted"> rows read{fileName ? ` from ${fileName}` : ""}</span>
              </div>
              <div>
                <span className="import-stat">{fmtDate(preview.start)}</span>
                <span className="muted"> to </span>
                <span className="import-stat">{fmtDate(preview.end)}</span>
              </div>
              {preview.duplicateCount > 0 ? (
                <div className="import-flag">
                  {preview.duplicateCount} already on the calendar
                </div>
              ) : null}
              {preview.protectedInRange > 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {preview.protectedInRange} production{preview.protectedInRange === 1 ? "" : "s"} in
                  this window will not be touched
                </div>
              ) : null}
            </div>

            {/* What each column was understood as. A wrong guess is visible here,
                which is the point of showing it before anything is written. */}
            {Object.keys(preview.matched).length > 0 ? (
              <details className="import-details">
                <summary>How the columns were read</summary>
                <div className="import-mapping">
                  {FIELD_LABELS.map(([field, label]) =>
                    preview.matched[field] ? (
                      <div key={field}>
                        <span className="muted">{preview.matched[field]}</span> → {label}
                      </div>
                    ) : null
                  )}
                </div>
                {preview.unmapped.length > 0 ? (
                  <p className="import-warn" style={{ margin: "8px 0 0" }}>
                    Not imported: {preview.unmapped.join(", ")}. Rename a column if one of
                    those should have come across.
                  </p>
                ) : null}
              </details>
            ) : null}

            {preview.errors.length > 0 ? (
              <div className="import-issues import-issues-error">
                <strong>
                  {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} cannot be
                  imported
                </strong>
                <ul>
                  {preview.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>Line {e.line}: {e.message}</li>
                  ))}
                  {preview.errors.length > 8 ? (
                    <li className="muted">and {preview.errors.length - 8} more</li>
                  ) : null}
                </ul>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  Fix these in the sheet and upload it again. The rows below will import
                  either way.
                </p>
              </div>
            ) : null}

            {preview.warnings.length > 0 ? (
              <div className="import-issues">
                <ul>
                  {preview.warnings.slice(0, 6).map((w, i) => (
                    <li key={i}>Line {w.line}: {w.message}</li>
                  ))}
                  {preview.warnings.length > 6 ? (
                    <li className="muted">and {preview.warnings.length - 6} more</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Audience</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.line} className={r.duplicateOf ? "is-duplicate" : ""}>
                      <td className="nowrap">{fmtDate(r.sendDate)}</td>
                      <td>
                        {r.title}
                        {r.sendTime ? <span className="muted"> · {r.sendTime}</span> : null}
                      </td>
                      <td className="nowrap">
                        {r.assetType ? (
                          ASSET_LABEL[r.assetType] || r.assetType
                        ) : (
                          <span className="muted">Not set</span>
                        )}
                      </td>
                      <td className="nowrap">{r.status}</td>
                      <td>{r.audience || <span className="muted">—</span>}</td>
                      <td className="nowrap">
                        {r.duplicateOf ? <span className="import-dupe-tag">Already there</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > visibleRows.length ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAllRows(true)}>
                Show all {rows.length} rows
              </button>
            ) : null}

            <div className="field">
              <label>What to do with the dates this file covers</label>
              <div className="stack" style={{ gap: 6 }}>
                <label className="import-radio">
                  <input
                    type="radio"
                    checked={mode === "skip_duplicates"}
                    onChange={() => setMode("skip_duplicates")}
                  />
                  <span>
                    <strong>Add what is new</strong>
                    <span className="muted">
                      {" "}Skips the {preview.duplicateCount} row
                      {preview.duplicateCount === 1 ? "" : "s"} already on the calendar. Best for
                      re-uploading a corrected sheet.
                    </span>
                  </span>
                </label>
                <label className="import-radio">
                  <input
                    type="radio"
                    checked={mode === "replace_range"}
                    onChange={() => setMode("replace_range")}
                  />
                  <span>
                    <strong>Replace this date range</strong>
                    <span className="muted">
                      {" "}Deletes the {preview.existingInRange} planned entr
                      {preview.existingInRange === 1 ? "y" : "ies"} between{" "}
                      {fmtDate(preview.start)} and {fmtDate(preview.end)} and rebuilds from the
                      file. Client productions are kept.
                    </span>
                  </span>
                </label>
                <label className="import-radio">
                  <input type="radio" checked={mode === "add"} onChange={() => setMode("add")} />
                  <span>
                    <strong>Add everything</strong>
                    <span className="muted"> Imports all {rows.length} rows, duplicates included.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={commit} disabled={busy || willCreate === 0}>
                  {busy
                    ? "Importing…"
                    : mode === "replace_range"
                      ? `Replace with ${rows.length} sends`
                      : `Import ${willCreate} send${willCreate === 1 ? "" : "s"}`}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
              </div>
              {willCreate === 0 ? (
                <span className="muted" style={{ fontSize: 13 }}>
                  Everything in this file is already on the calendar.
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        {/* --------------------------------------------------------- undo */}
        {batches.length > 0 ? (
          <details className="import-details">
            <summary>Recent imports</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {batches.map((b) => (
                <div key={b.batchId} className="import-batch">
                  <span>
                    {b.count} send{b.count === 1 ? "" : "s"}
                    <span className="muted">
                      {" "}· {fmtDate(b.firstDate)} to {fmtDate(b.lastDate)}
                    </span>
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => undo(b.batchId)}
                    disabled={busy}
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {!preview && !result ? (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
