"use client";

import { useState } from "react";
import { TEAMS } from "@/lib/people";

// Reading a signed contract into the account's deliverables.
//
// The parse proposes and the admin decides. Every proposed row is editable and
// individually deselectable, and the contract line it came from sits underneath
// it, so checking the parse is reading two things side by side rather than
// trusting a machine with the scope of work. What gets saved is what is in this
// table when Add is pressed — not what the parser first guessed.

type Kind = "recurring" | "one_time";
type CadenceUnit = "weekly" | "monthly" | "quarterly";

type Candidate = {
  name: string;
  category: string;
  team: string;
  cadence: string;
  kind: Kind;
  cadenceUnit: CadenceUnit;
  sourceLine: string;
  confidence: "high" | "low";
  existingId: string | null;
  note?: string;
};

type Terms = {
  monthlyRetainer: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  termMonths: number | null;
};

type Parsed = {
  candidates: Candidate[];
  terms: Terms;
  foundScopeSection: boolean;
  warnings: string[];
  source: string;
  pages: number | null;
  text: string;
};

// A row under review: the candidate, plus whether it is going to be saved.
type Draft = Candidate & { include: boolean };

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];
const UNIT_LABEL: Record<CadenceUnit, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function money(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function ContractImportPanel({
  clientId,
  onAdded,
}: {
  clientId: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [applyTerms, setApplyTerms] = useState(false);
  const [saved, setSaved] = useState<{ created: number; skipped: number } | null>(null);

  function reset() {
    setParsed(null);
    setDrafts([]);
    setError("");
    setHint("");
    setSaved(null);
    setApplyTerms(false);
  }

  function receive(data: Parsed) {
    setParsed(data);
    setDrafts(
      data.candidates.map((c) => ({
        ...c,
        // A row the account already has starts unticked: the default should never
        // be to duplicate an existing deliverable.
        include: !c.existingId,
      }))
    );
  }

  async function uploadPdf(file: File) {
    reset();
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/snapshot/accounts/${clientId}/contract`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not read that contract.");
        // A scan has no text to read, so point at the way through rather than
        // leaving the admin at a dead end.
        if (data.looksScanned) setPasteMode(true);
        return;
      }
      receive(data);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitText() {
    if (!pasted.trim()) return;
    reset();
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshot/accounts/${clientId}/contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasted }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not read that text."); return; }
      receive(data);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function patch(index: number, changes: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, i) => (i === index ? { ...d, ...changes } : d)));
  }

  async function save() {
    const chosen = drafts.filter((d) => d.include && d.name.trim());
    if (!chosen.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/snapshot/accounts/${clientId}/contract`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverables: chosen.map((d) => ({
            name: d.name,
            category: d.category,
            team: d.team,
            cadence: d.cadence,
            kind: d.kind,
            cadenceUnit: d.cadenceUnit,
          })),
          terms: applyTerms ? parsed?.terms : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not add those deliverables."); return; }
      setSaved({ created: data.created, skipped: data.skipped });
      setParsed(null);
      setDrafts([]);
      onAdded();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const chosenCount = drafts.filter((d) => d.include && d.name.trim()).length;
  const terms = parsed?.terms;
  const hasTerms =
    !!terms && (terms.monthlyRetainer !== null || terms.contractStart || terms.contractEnd);

  if (!open) {
    return (
      <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <strong>Build deliverables from the contract</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Upload the signed agreement and the scope of work is read into a list you
            check before anything is added.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          Import contract
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>Import the contract</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Nothing is added until you have looked over the list.
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setOpen(false); reset(); }}
        >
          Close
        </button>
      </div>

      {!parsed ? (
        <>
          {!pasteMode ? (
            <div className="field">
              <label>Contract PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadPdf(file);
                }}
              />
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Works on any contract with selectable text. A scanned or photographed
                agreement has no text to read, so paste the scope of work instead.{" "}
                <button
                  className="link-button"
                  type="button"
                  onClick={() => { setPasteMode(true); setError(""); }}
                >
                  Paste text instead
                </button>
              </p>
            </div>
          ) : (
            <div className="field">
              <label>Scope of work</label>
              <textarea
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={
                  "Paste the scope of work, for example:\n\nSCOPE OF WORK\nEmail Marketing\n- 4 email campaigns per month\n- Initial Klaviyo setup\nSEO\n- 4 blog posts per month"
                }
              />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm" onClick={submitText} disabled={busy || !pasted.trim()}>
                  {busy ? "Reading…" : "Read this"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => { setPasteMode(false); setError(""); }}
                >
                  Upload a PDF instead
                </button>
              </div>
            </div>
          )}
          {busy && !pasteMode ? <p className="muted">Reading the contract…</p> : null}
        </>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {hint ? <p className="muted">{hint}</p> : null}

      {saved ? (
        <div className="import-result">
          <strong>
            {saved.created} deliverable{saved.created === 1 ? "" : "s"} added
            {saved.skipped ? `, ${saved.skipped} skipped as already there` : ""}
          </strong>
        </div>
      ) : null}

      {parsed ? (
        <>
          <div className="import-summary">
            <div>
              <span className="import-stat">{parsed.candidates.length}</span>
              <span className="muted"> deliverables found</span>
            </div>
            {parsed.source === "pdf" && parsed.pages ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {parsed.pages} page{parsed.pages === 1 ? "" : "s"} read
              </div>
            ) : null}
            {parsed.foundScopeSection ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Read from the scope-of-work section
              </div>
            ) : null}
          </div>

          {parsed.warnings.map((w, i) => (
            <p key={i} className="import-warn">{w}</p>
          ))}

          {drafts.length > 0 ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Untick anything that is not a deliverable, and correct the rest. What is
                  here when you press Add is what gets saved.
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setDrafts((ds) => {
                      const allOn = ds.every((d) => d.include);
                      return ds.map((d) => ({ ...d, include: !allOn }));
                    })
                  }
                >
                  {drafts.every((d) => d.include) ? "Untick all" : "Tick all"}
                </button>
              </div>

              {drafts.map((d, i) => (
                <div
                  key={`${d.sourceLine}-${i}`}
                  className={`contract-row ${d.include ? "" : "is-off"}`}
                >
                  <label className="contract-row-check">
                    <input
                      type="checkbox"
                      checked={d.include}
                      onChange={(e) => patch(i, { include: e.target.checked })}
                      aria-label={`Include ${d.name}`}
                    />
                  </label>
                  <div className="contract-row-fields">
                    <div className="contract-row-main">
                      <input
                        value={d.name}
                        onChange={(e) => patch(i, { name: e.target.value })}
                        placeholder="Deliverable"
                        aria-label="Deliverable name"
                      />
                      <input
                        value={d.category}
                        onChange={(e) => patch(i, { category: e.target.value })}
                        placeholder="Category"
                        aria-label="Category"
                      />
                      <select
                        value={d.team}
                        onChange={(e) => patch(i, { team: e.target.value })}
                        aria-label="Owning team"
                      >
                        <option value="">Any team</option>
                        {TEAMS.map((t) => (
                          <option key={t.slug} value={t.slug}>{t.label}</option>
                        ))}
                      </select>
                      <input
                        value={d.cadence}
                        onChange={(e) => patch(i, { cadence: e.target.value })}
                        placeholder="Cadence"
                        aria-label="Cadence as written"
                      />
                      <select
                        value={d.kind}
                        onChange={(e) => patch(i, { kind: e.target.value as Kind })}
                        aria-label="Kind"
                      >
                        <option value="recurring">Recurring</option>
                        <option value="one_time">One-time setup</option>
                      </select>
                      {d.kind === "recurring" ? (
                        <select
                          value={d.cadenceUnit}
                          onChange={(e) => patch(i, { cadenceUnit: e.target.value as CadenceUnit })}
                          title="How often this resets to Not started"
                          aria-label="Resets every"
                        >
                          {CADENCE_UNITS.map((u) => (
                            <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                          Done once
                        </span>
                      )}
                    </div>
                    <div className="contract-row-source">
                      <span className="muted">From the contract:</span> “{d.sourceLine}”
                      {d.existingId ? (
                        <span className="import-dupe-tag" style={{ marginLeft: 8 }}>
                          Already a deliverable
                        </span>
                      ) : null}
                      {d.note ? <span className="import-warn-inline"> {d.note}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {hasTerms ? (
            <div className="import-terms">
              <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={applyTerms}
                  onChange={(e) => setApplyTerms(e.target.checked)}
                />
                <span>
                  <strong>Also update the account&apos;s contract details</strong>
                  <span className="muted" style={{ display: "block", fontSize: 13 }}>
                    {[
                      terms?.monthlyRetainer !== null && terms?.monthlyRetainer !== undefined
                        ? `Retainer ${money(terms.monthlyRetainer)} a month`
                        : "",
                      terms?.contractStart ? `starts ${terms.contractStart}` : "",
                      terms?.contractEnd ? `ends ${terms.contractEnd}` : "",
                      terms?.termMonths ? `${terms.termMonths}-month term` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    . Check these against the contract before ticking — a figure read out
                    of the payment terms is the easiest thing to get wrong.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          <details className="import-details">
            <summary>The text that was read</summary>
            <pre className="import-raw">{parsed.text.slice(0, 20000)}</pre>
          </details>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={save} disabled={busy || chosenCount === 0}>
              {busy
                ? "Adding…"
                : `Add ${chosenCount} deliverable${chosenCount === 1 ? "" : "s"}`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={reset} disabled={busy}>
              Start over
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
