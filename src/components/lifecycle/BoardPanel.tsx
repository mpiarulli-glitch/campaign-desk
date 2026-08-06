"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import type { BoardCard, BoardColumn, ClientRef } from "./types";

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return MONTH_FORMAT.format(new Date(Date.UTC(y, m - 1, 1)));
}

export function BoardPanel({ clients }: { clients: ClientRef[] }) {
  const [period, setPeriod] = useState(currentPeriod);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [addingClientId, setAddingClientId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/board?period=${p}`);
      if (!res.ok) {
        setError("Could not load the board.");
        return;
      }
      const data = await res.json();
      setColumns(data.columns || []);
      setCards(data.cards || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const c of cards) {
      const list = map.get(c.columnKey) ?? [];
      list.push(c);
      map.set(c.columnKey, list);
    }
    return map;
  }, [cards]);

  const totals = useMemo(() => {
    const quota = cards.reduce((n, c) => n + c.quota, 0);
    const delivered = cards.reduce((n, c) => n + c.delivered, 0);
    const missingQuota = cards.filter((c) => c.quota === 0).length;
    return { quota, delivered, missingQuota };
  }, [cards]);

  const availableClients = useMemo(() => {
    const carded = new Set(cards.map((c) => c.clientId));
    return clients.filter((c) => !carded.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, cards]);

  async function moveCard(cardId: string, columnKey: string) {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, columnKey: columnKey as BoardCard["columnKey"] } : c)));
    const res = await fetch(`/api/lifecycle/board/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnKey }),
    });
    if (!res.ok) void load(period);
  }

  // The quota is a client-level contract term, so every card for that client
  // (this month and any other) updates together.
  async function saveQuota(cardId: string, quota: number) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    setCards((prev) =>
      prev.map((c) => (c.clientId === card.clientId ? { ...c, quota } : c))
    );
    const res = await fetch(`/api/lifecycle/board/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quota }),
    });
    if (!res.ok) void load(period);
  }

  async function saveNotes(cardId: string, notes: string) {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, notes } : c)));
    await fetch(`/api/lifecycle/board/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  }

  async function removeCard(card: BoardCard) {
    if (!confirm(`Remove ${card.clientName}'s card for ${periodLabel(card.period)}?`)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    await fetch(`/api/lifecycle/board/cards/${card.id}`, { method: "DELETE" });
  }

  async function addCard() {
    if (!addingClientId) return;
    const res = await fetch("/api/lifecycle/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: addingClientId, period }),
    });
    setAddingClientId("");
    if (res.ok) void load(period);
  }

  async function addItem(cardId: string) {
    const label = (drafts[cardId] || "").trim();
    if (!label) return;
    const res = await fetch("/api/lifecycle/board/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, label }),
    });
    if (res.ok) {
      const data = await res.json();
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, manualItems: [...c.manualItems, data.item] } : c))
      );
      setDrafts((d) => ({ ...d, [cardId]: "" }));
    }
  }

  async function toggleItem(cardId: string, itemId: string, done: boolean) {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, manualItems: c.manualItems.map((i) => (i.id === itemId ? { ...i, done } : i)) }
          : c
      )
    );
    await fetch(`/api/lifecycle/board/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
  }

  async function removeItem(cardId: string, itemId: string) {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, manualItems: c.manualItems.filter((i) => i.id !== itemId) } : c
      )
    );
    await fetch(`/api/lifecycle/board/items/${itemId}`, { method: "DELETE" });
  }

  return (
    <div className="hud-stack" style={{ gap: 14 }}>
      <div className="hud-board-toolbar">
        <div className="hud-board-month">
          <button className="hud-btn hud-btn-quiet" onClick={() => setPeriod((p) => shiftPeriod(p, -1))}>
            ‹
          </button>
          <h2 className="hud-panel-title" style={{ minWidth: 160, textAlign: "center" }}>
            {periodLabel(period)}
          </h2>
          <button className="hud-btn hud-btn-quiet" onClick={() => setPeriod((p) => shiftPeriod(p, 1))}>
            ›
          </button>
          {period !== currentPeriod() ? (
            <button className="hud-link" onClick={() => setPeriod(currentPeriod())}>
              Back to this month
            </button>
          ) : null}
        </div>

        <div className="hud-board-add">
          <select value={addingClientId} onChange={(e) => setAddingClientId(e.target.value)}>
            <option value="">Add a client card…</option>
            {availableClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="hud-btn" disabled={!addingClientId} onClick={addCard}>
            Add
          </button>
        </div>
      </div>

      {error ? <p className="hud-err">{error}</p> : null}

      {!loading && cards.length > 0 ? (
        <div className="hud-board-summary">
          <span>
            <b>
              {totals.delivered}/{totals.quota}
            </b>{" "}
            emails delivered against contract this month
          </span>
          {totals.missingQuota > 0 ? (
            <span className="warn">
              {totals.missingQuota}{" "}
              {totals.missingQuota === 1 ? "client has" : "clients have"} no contracted
              volume set
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="hud-empty">Loading the board…</p>
      ) : cards.length === 0 ? (
        <p className="hud-empty">No clients on the board yet. Add one above.</p>
      ) : (
        <div className="hud-board-cols">
          {columns.map((col) => {
            const colCards = cardsByColumn.get(col.key) ?? [];
            return (
              <div
                key={col.key}
                className={`hud-board-col ${dragOverCol === col.key ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol((cur) => (cur === col.key ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setDragOverCol(null);
                  setDraggingId(null);
                  if (id) void moveCard(id, col.key);
                }}
              >
                <div className="hud-board-col-head">
                  <span>{col.label}</span>
                  <span className="hud-board-col-count">{colCards.length}</span>
                </div>

                {colCards.length === 0 ? (
                  <div className="hud-board-empty-col">Drop a card here</div>
                ) : (
                  colCards.map((card) => {
                    const total = card.campaigns.length;
                    // Progress is measured against the contract, not against
                    // what happens to be on the board, so a client with no
                    // quota on file shows a plain count instead of a bar.
                    const pct =
                      card.quota > 0
                        ? Math.min(100, (card.delivered / card.quota) * 100)
                        : 0;
                    const quotaState =
                      card.quota === 0
                        ? "none"
                        : card.delivered >= card.quota
                          ? "met"
                          : "open";
                    const suggestHint =
                      card.suggestedColumnKey !== card.columnKey
                        ? columns.find((c) => c.key === card.suggestedColumnKey)?.label
                        : null;
                    return (
                      <div
                        key={card.id}
                        className={`hud-board-card ${draggingId === card.id ? "dragging" : ""}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", card.id);
                          setDraggingId(card.id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                      >
                        <div className="hud-board-card-head">
                          <b>{card.clientName}</b>
                          <button className="hud-link" onClick={() => removeCard(card)}>
                            Remove
                          </button>
                        </div>

                        <div className="hud-board-card-row">
                          <select
                            value={card.columnKey}
                            onChange={(e) => void moveCard(card.id, e.target.value)}
                          >
                            {columns.map((c) => (
                              <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                          </select>
                          {suggestHint ? (
                            <button
                              className="hud-link"
                              title={`Suggested from this month's campaign statuses`}
                              onClick={() => void moveCard(card.id, card.suggestedColumnKey)}
                            >
                              Suggested: {suggestHint}
                            </button>
                          ) : null}
                        </div>

                        <div className={`hud-board-quota is-${quotaState}`}>
                          {card.quota > 0 ? (
                            <>
                              <div className="hud-board-quota-head">
                                <b>
                                  {card.delivered}/{card.quota}
                                </b>
                                <span>emails this month</span>
                              </div>
                              <div className="hud-progress">
                                <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </>
                          ) : (
                            <div className="hud-board-quota-head">
                              <b>{card.delivered}</b>
                              <span>sent, no contract volume set</span>
                            </div>
                          )}
                          <label className="hud-board-quota-edit">
                            <span>Contracted /mo</span>
                            <input
                              type="number"
                              min={0}
                              max={99}
                              defaultValue={card.quota || ""}
                              placeholder="0"
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                const next = Number(e.target.value || 0);
                                if (next !== card.quota) void saveQuota(card.id, next);
                              }}
                            />
                          </label>
                        </div>

                        {total > 0 ? (
                          <div className="hud-board-chip-row">
                            {card.campaigns.map((camp) => (
                              <Link
                                key={camp.id}
                                href={`/admin/campaigns/${camp.id}`}
                                className={`hud-board-camp-chip ${camp.delivered ? "" : "pending"}`}
                                title={`${camp.title} — ${camp.emailCount} email${camp.emailCount === 1 ? "" : "s"}`}
                              >
                                <StatusBadge status={camp.status} />
                                <span>{camp.title}</span>
                                {camp.emailCount > 1 ? (
                                  <em className="hud-board-camp-n">×{camp.emailCount}</em>
                                ) : null}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="hud-board-nocamp">No campaigns this month yet.</p>
                        )}

                        {card.manualItems.length > 0 ? (
                          <div className="hud-board-items">
                            {card.manualItems.map((item) => (
                              <label key={item.id} className="hud-board-item">
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  onChange={(e) => void toggleItem(card.id, item.id, e.target.checked)}
                                />
                                <span className={item.done ? "done" : ""}>{item.label}</span>
                                <button
                                  type="button"
                                  className="hud-board-item-del"
                                  onClick={() => void removeItem(card.id, item.id)}
                                  aria-label="Remove deliverable"
                                >
                                  ×
                                </button>
                              </label>
                            ))}
                          </div>
                        ) : null}

                        <div className="hud-board-item-add">
                          <input
                            value={drafts[card.id] || ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [card.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void addItem(card.id);
                            }}
                            placeholder="+ LinkedIn, SMS, landing page…"
                          />
                        </div>

                        <textarea
                          className="hud-board-notes"
                          rows={1}
                          defaultValue={card.notes}
                          placeholder="Notes for this client's month…"
                          onBlur={(e) => {
                            if (e.target.value !== card.notes) void saveNotes(card.id, e.target.value);
                          }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
