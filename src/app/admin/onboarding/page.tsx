"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = { key: string; label: string; color: string };

type Step = { id: string; title: string; completed: boolean };

type Card = {
  client: {
    id: string;
    name: string;
    tier: string;
    account_manager: string;
    business_model: string;
    contact_name: string;
  };
  steps: Step[];
  stage: string;
};

type OffBoardClient = { id: string; name: string };

type Data = {
  stages: Stage[];
  onBoard: Card[];
  offBoard: OffBoardClient[];
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

export default function OnboardingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPick, setAddPick] = useState("");

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

  function dragProps(clientId: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragId(clientId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", clientId);
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
        const clientId = dragId || e.dataTransfer.getData("text/plain");
        setDragId(null);
        setOverStage(null);
        if (!clientId || !data) return;
        const card = data.onBoard.find((c) => c.client.id === clientId);
        if (!card || card.stage === stageKey) return;
        setData({
          ...data,
          onBoard: data.onBoard.map((c) =>
            c.client.id === clientId ? { ...c, stage: stageKey } : c
          ),
        });
        const res = await fetch(`/api/onboarding/${clientId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: stageKey }),
        });
        if (!res.ok) {
          setError("Could not move that client.");
          load({ silent: true });
        }
      },
    };
  }

  async function addClient() {
    if (!addPick) return;
    setAdding(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: addPick }),
    });
    setAdding(false);
    if (res.ok) {
      setAddPick("");
      load({ silent: true });
    } else {
      setError("Could not add that client.");
    }
  }

  async function removeClient(clientId: string, name: string) {
    if (!confirm(`Take ${name} off the onboarding board? Their checklist is kept — adding them back later resumes it.`)) return;
    setOpenCard(null);
    if (data) {
      setData({ ...data, onBoard: data.onBoard.filter((c) => c.client.id !== clientId) });
    }
    await fetch(`/api/onboarding/${clientId}`, { method: "DELETE" });
    load({ silent: true });
  }

  async function toggleStep(clientId: string, stepId: string, completed: boolean) {
    if (data) {
      setData({
        ...data,
        onBoard: data.onBoard.map((c) =>
          c.client.id === clientId
            ? { ...c, steps: c.steps.map((s) => (s.id === stepId ? { ...s, completed } : s)) }
            : c
        ),
      });
    }
    await fetch(`/api/onboarding/steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  }

  return (
    <div>
      <div className="page-actions">
        <select
          className="select-clean"
          value={addPick}
          onChange={(e) => setAddPick(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">Add a client...</option>
          {(data?.offBoard || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={addClient} disabled={!addPick || adding}>
          {adding ? "Adding..." : "+ Add to board"}
        </button>
      </div>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Onboarding</p>
          <h1 className="h1">New Client Onboarding</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Drag a client between stages as they move through onboarding. Matches the New
            Client Onboarding board in Basecamp.
          </p>
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
              return (
                <div
                  key={stage.key}
                  className={`onb-col ${isOver ? "is-over" : ""} ${isNotNow ? "is-notnow" : ""}`}
                  {...columnDropProps(stage.key)}
                >
                  <div className="onb-col-head">
                    <span
                      className="onb-dot"
                      style={{ background: COLOR_HEX[stage.color] || "var(--border-strong)" }}
                    />
                    <span className="onb-col-title">{stage.label}</span>
                    <span className="onb-col-count">{cards.length}</span>
                  </div>
                  <div
                    className="onb-col-body"
                    style={{ background: stageWash(stage.color) }}
                  >
                    {cards.length === 0 ? (
                      <p className="muted onb-empty">Drop a client here</p>
                    ) : (
                      cards.map((card) => {
                        const open = openCard === card.client.id;
                        const done = card.steps.filter((s) => s.completed).length;
                        return (
                          <div
                            key={card.client.id}
                            className={`onb-card ${dragId === card.client.id ? "is-dragging" : ""}`}
                            {...dragProps(card.client.id)}
                          >
                            <div
                              className="onb-card-top"
                              onClick={() => setOpenCard(open ? null : card.client.id)}
                            >
                              <span className="onb-card-name">{card.client.name}</span>
                              <span className="onb-card-meta">
                                {done}/{card.steps.length}
                              </span>
                            </div>
                            {card.client.account_manager ? (
                              <span className="onb-card-sub">{card.client.account_manager}</span>
                            ) : null}
                            {open ? (
                              <div className="onb-card-steps">
                                {card.steps.map((step) => (
                                  <label key={step.id} className="onb-step">
                                    <input
                                      type="checkbox"
                                      checked={step.completed}
                                      onChange={(e) =>
                                        toggleStep(card.client.id, step.id, e.target.checked)
                                      }
                                    />
                                    <span className={step.completed ? "is-done" : ""}>
                                      {step.title}
                                    </span>
                                  </label>
                                ))}
                                <button
                                  className="btn btn-danger btn-sm"
                                  style={{ marginTop: 8 }}
                                  onClick={() => removeClient(card.client.id, card.client.name)}
                                >
                                  Remove from board
                                </button>
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
