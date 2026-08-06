"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = { key: string; label: string; color: string };

type Step = {
  id: string;
  title: string;
  kind: "manual" | "action" | "auto";
  actionKey: string;
  completed: boolean;
};

type ProspectSummary = {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  monetary_value: number;
  basecamp_project_id: string;
};

type Card = {
  prospect: ProspectSummary;
  steps: Step[];
  stage: string;
};

type OffBoardOpportunity = {
  id: string;
  name: string;
  contactName: string;
  monetaryValue: number;
};

type Data = {
  stages: Stage[];
  onBoard: Card[];
  offBoard: OffBoardOpportunity[];
  ghlConfigured: boolean;
  ghlError: string;
};

// Basecamp's own column colors, translated to a light wash + a solid dot so
// the board reads the same way the source card table does.
const COLOR_HEX: Record<string, string> = {
  white: "#c9ccd1",
  yellow: "#e0b400",
  orange: "#e08a2e",
  red: "#d64545",
  brown: "#8a6242",
  pink: "#d9679a",
  purple: "#8a5cd6",
  blue: "#3a8fd6",
};

function stageWash(color: string): string {
  const hex = COLOR_HEX[color];
  if (!hex) return "transparent";
  return `${hex}1a`; // ~10% alpha
}

function fmtMoney(n: number): string {
  if (!n) return "";
  return `$${n.toLocaleString()}`;
}

export default function OnboardingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPick, setAddPick] = useState("");
  const [actionBusy, setActionBusy] = useState<string>("");
  const [actionError, setActionError] = useState<{ prospectId: string; message: string } | null>(
    null
  );

  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    const res = await fetch("/api/onboarding");
    if (res.ok) {
      setData(await res.json());
      setError("");
    } else {
      setError("Could not load the board.");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const card of data?.onBoard || []) {
      const list = map.get(card.stage) || [];
      list.push(card);
      map.set(card.stage, list);
    }
    return map;
  }, [data]);

  function dragProps(prospectId: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragId(prospectId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", prospectId);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverStage(null);
      },
    };
  }

  function columnDropProps(stageKey: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overStage !== stageKey) setOverStage(stageKey);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOverStage((s) => (s === stageKey ? null : s));
      },
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        const prospectId = dragId || e.dataTransfer.getData("text/plain");
        setDragId(null);
        setOverStage(null);
        if (!prospectId || !data) return;
        const card = data.onBoard.find((c) => c.prospect.id === prospectId);
        if (!card || card.stage === stageKey) return;
        setData({
          ...data,
          onBoard: data.onBoard.map((c) =>
            c.prospect.id === prospectId ? { ...c, stage: stageKey } : c
          ),
        });
        const res = await fetch(`/api/onboarding/${prospectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: stageKey }),
        });
        if (!res.ok) {
          setError("Could not move that prospect.");
          load({ silent: true });
        }
      },
    };
  }

  async function addOpportunity() {
    if (!addPick) return;
    setAdding(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: addPick }),
    });
    setAdding(false);
    if (res.ok) {
      setAddPick("");
      load({ silent: true });
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not add that opportunity.");
    }
  }

  async function removeProspect(prospectId: string, name: string) {
    if (!confirm(`Take ${name} off the onboarding board? This deletes their checklist too.`)) return;
    setOpenCard(null);
    if (data) {
      setData({ ...data, onBoard: data.onBoard.filter((c) => c.prospect.id !== prospectId) });
    }
    await fetch(`/api/onboarding/${prospectId}`, { method: "DELETE" });
    load({ silent: true });
  }

  async function toggleStep(stepId: string, completed: boolean) {
    if (data) {
      setData({
        ...data,
        onBoard: data.onBoard.map((c) => ({
          ...c,
          steps: c.steps.map((s) => (s.id === stepId ? { ...s, completed } : s)),
        })),
      });
    }
    await fetch(`/api/onboarding/steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  }

  async function runAction(prospectId: string, actionKey: string, stepId: string) {
    setActionBusy(stepId);
    setActionError(null);
    const res = await fetch(`/api/onboarding/${prospectId}/actions/${actionKey}`, {
      method: "POST",
    });
    setActionBusy("");
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setActionError({ prospectId, message: d.error || "That didn't work." });
      return;
    }
    load({ silent: true });
  }

  return (
    <div>
      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Onboarding</p>
          <h1 className="h1">New Client Onboarding</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Pulled from the 🚀 Empire Launch Pipeline in GHL. Drag a prospect between stages.
            Pill-shaped buttons in a card actually do the thing when clicked.
          </p>
        </div>

        <div className="onb-toolbar">
          {!data?.ghlConfigured ? (
            <span className="onb-toolbar-note">GHL opportunities not configured yet</span>
          ) : data?.ghlError ? (
            <span className="onb-toolbar-note error" style={{ margin: 0 }}>
              GHL error: {data.ghlError}
            </span>
          ) : (
            <>
              <span className="onb-toolbar-label">Add from GHL</span>
              <select
                className="select-clean"
                value={addPick}
                onChange={(e) => setAddPick(e.target.value)}
              >
                <option value="">Pick an opportunity...</option>
                {(data?.offBoard || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.contactName ? ` — ${o.contactName}` : ""}
                    {o.monetaryValue ? ` (${fmtMoney(o.monetaryValue)})` : ""}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={addOpportunity} disabled={!addPick || adding}>
                {adding ? "Adding..." : "+ Add to board"}
              </button>
            </>
          )}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading board...</p>
        ) : (
          <div className="onb-board">
            {(data?.stages || []).map((stage) => {
              const cards = byStage.get(stage.key) || [];
              const isOver = overStage === stage.key;
              const isNotNow = stage.key === "not_now";
              const colorHex = COLOR_HEX[stage.color];
              return (
                <div
                  key={stage.key}
                  className={`onb-col ${isOver ? "is-over" : ""} ${isNotNow ? "is-notnow" : ""}`}
                  style={isOver ? undefined : { borderTopColor: colorHex || "var(--border-strong)" }}
                  {...columnDropProps(stage.key)}
                >
                  <div className="onb-col-head">
                    <span className="onb-dot" style={{ background: colorHex || "var(--border-strong)" }} />
                    <span className="onb-col-title">{stage.label}</span>
                    <span className="onb-col-count">{cards.length}</span>
                  </div>
                  <div className="onb-col-body" style={{ background: stageWash(stage.color) }}>
                    {cards.length === 0 ? (
                      <p className="muted onb-empty">Drop a prospect here</p>
                    ) : (
                      cards.map((card) => {
                        const open = openCard === card.prospect.id;
                        const done = card.steps.filter((s) => s.completed).length;
                        const pct = card.steps.length ? Math.round((done / card.steps.length) * 100) : 0;
                        const actionSteps = card.steps.filter((s) => s.kind === "action");
                        const trackedSteps = card.steps.filter((s) => s.kind !== "action");
                        return (
                          <div
                            key={card.prospect.id}
                            className={`onb-card ${dragId === card.prospect.id ? "is-dragging" : ""} ${open ? "is-open" : ""}`}
                            {...dragProps(card.prospect.id)}
                          >
                            <div
                              className="onb-card-top"
                              onClick={() => setOpenCard(open ? null : card.prospect.id)}
                            >
                              <span className="onb-card-name">{card.prospect.name}</span>
                              <span className="onb-chevron">›</span>
                            </div>
                            {card.prospect.contact_name || card.prospect.monetary_value ? (
                              <span className="onb-card-sub">
                                {card.prospect.contact_name}
                                {card.prospect.monetary_value
                                  ? `${card.prospect.contact_name ? " · " : ""}${fmtMoney(card.prospect.monetary_value)}`
                                  : ""}
                              </span>
                            ) : null}
                            <div className="onb-progress-track">
                              <div className="onb-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="onb-progress-label">
                              {done}/{card.steps.length} done
                            </span>
                            {open ? (
                              <div className="onb-card-steps">
                                {actionError?.prospectId === card.prospect.id ? (
                                  <p className="error" style={{ margin: "0 0 4px", fontSize: 12 }}>
                                    {actionError.message}
                                  </p>
                                ) : null}

                                <span className="onb-section-label">Quick actions</span>
                                {actionSteps.map((step) => (
                                  <button
                                    key={step.id}
                                    type="button"
                                    className={`onb-action ${step.completed ? "is-done" : ""}`}
                                    disabled={actionBusy === step.id}
                                    onClick={() =>
                                      !step.completed &&
                                      runAction(card.prospect.id, step.actionKey, step.id)
                                    }
                                  >
                                    <span className="onb-action-dot" />
                                    {actionBusy === step.id
                                      ? "Working..."
                                      : step.completed
                                        ? `${step.title} ✓`
                                        : step.title}
                                  </button>
                                ))}

                                <span className="onb-section-label">Checklist</span>
                                {trackedSteps.map((step) => (
                                  <label key={step.id} className="onb-step">
                                    <input
                                      type="checkbox"
                                      checked={step.completed}
                                      disabled={step.kind === "auto"}
                                      onChange={(e) => toggleStep(step.id, e.target.checked)}
                                    />
                                    <span className={step.completed ? "is-done" : ""}>
                                      {step.title}
                                    </span>
                                  </label>
                                ))}

                                <div className="onb-card-footer">
                                  {card.prospect.basecamp_project_id ? (
                                    <a
                                      className="onb-link"
                                      href={`https://3.basecamp.com/5338018/buckets/${card.prospect.basecamp_project_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Open Basecamp project ↗
                                    </a>
                                  ) : (
                                    <span />
                                  )}
                                  <button
                                    type="button"
                                    className="onb-link is-danger"
                                    onClick={() => removeProspect(card.prospect.id, card.prospect.name)}
                                  >
                                    Remove from board
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
