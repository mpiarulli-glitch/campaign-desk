"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import type { BoardCard, BoardColumn, ClientRef } from "./types";

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

/** Where cards wait before anyone picks them up. Not part of the pipeline. */
const TRIAGE = "triage";

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

interface CardHandlers {
  columns: BoardColumn[];
  isOpen: boolean;
  draft: string;
  dragging: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, columnKey: string) => void;
  onQuota: (id: string, quota: number) => void;
  onNotes: (id: string, notes: string) => void;
  onRemove: (card: BoardCard) => void;
  onDraft: (id: string, value: string) => void;
  onAddItem: (id: string) => void;
  onToggleItem: (cardId: string, itemId: string, done: boolean) => void;
  onRemoveItem: (cardId: string, itemId: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

/**
 * At rest a card is a name, a progress reading, and whatever is actually on it.
 * Every control lives behind the header toggle: a column can hold fifty of
 * these, and showing four form fields on each one is unreadable.
 */
function Card({ card, ...h }: { card: BoardCard } & CardHandlers) {
  const pct = card.quota > 0 ? Math.min(100, (card.delivered / card.quota) * 100) : 0;
  const state =
    card.quota === 0 ? "none" : card.delivered >= card.quota ? "met" : "open";
  const suggestHint =
    card.suggestedColumnKey !== card.columnKey
      ? h.columns.find((c) => c.key === card.suggestedColumnKey)?.label
      : null;
  const doneItems = card.manualItems.filter((i) => i.done).length;

  return (
    <div
      className={`hud-board-card ${h.dragging ? "dragging" : ""} ${h.isOpen ? "open" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        h.onDragStart(card.id);
      }}
      onDragEnd={h.onDragEnd}
    >
      <button
        type="button"
        className="hud-board-card-head"
        onClick={() => h.onToggle(card.id)}
        aria-expanded={h.isOpen}
      >
        <b>{card.clientName}</b>
        <span className={`hud-board-count is-${state}`}>
          {card.quota > 0 ? `${card.delivered}/${card.quota}` : card.delivered || "—"}
        </span>
      </button>

      {card.quota > 0 ? (
        <div className={`hud-progress is-${state}`}>
          <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {card.campaigns.length > 0 ? (
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
      ) : null}

      {card.manualItems.length > 0 ? (
        h.isOpen ? (
          <div className="hud-board-items">
            {card.manualItems.map((item) => (
              <label key={item.id} className="hud-board-item">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => h.onToggleItem(card.id, item.id, e.target.checked)}
                />
                <span className={item.done ? "done" : ""}>{item.label}</span>
                <button
                  type="button"
                  className="hud-board-item-del"
                  onClick={() => h.onRemoveItem(card.id, item.id)}
                  aria-label="Remove deliverable"
                >
                  ×
                </button>
              </label>
            ))}
          </div>
        ) : (
          <div className="hud-board-meta">
            {doneItems}/{card.manualItems.length} other deliverables
          </div>
        )
      ) : null}

      {!h.isOpen && card.notes ? (
        <div className="hud-board-meta note">{card.notes}</div>
      ) : null}

      {h.isOpen ? (
        <div className="hud-board-card-edit">
          <label className="hud-board-field">
            <span>Stage</span>
            <select
              value={card.columnKey}
              onChange={(e) => h.onMove(card.id, e.target.value)}
            >
              {h.columns.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="hud-board-field">
            <span>Contracted /mo</span>
            <input
              type="number"
              min={0}
              max={99}
              defaultValue={card.quota || ""}
              placeholder="0"
              onBlur={(e) => {
                const next = Number(e.target.value || 0);
                if (next !== card.quota) h.onQuota(card.id, next);
              }}
            />
          </label>

          {suggestHint ? (
            <button
              className="hud-link"
              title="Suggested from this month's campaign statuses"
              onClick={() => h.onMove(card.id, card.suggestedColumnKey)}
            >
              Move to {suggestHint}
            </button>
          ) : null}

          <input
            className="hud-board-add-item"
            value={h.draft}
            onChange={(e) => h.onDraft(card.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") h.onAddItem(card.id);
            }}
            placeholder="Add a deliverable, then Enter"
          />

          <textarea
            className="hud-board-notes"
            rows={2}
            defaultValue={card.notes}
            placeholder="Notes"
            onBlur={(e) => {
              if (e.target.value !== card.notes) h.onNotes(card.id, e.target.value);
            }}
          />

          <button className="hud-link hud-board-remove" onClick={() => h.onRemove(card)}>
            Remove from board
          </button>
        </div>
      ) : null}
    </div>
  );
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
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [triageOpen, setTriageOpen] = useState(true);
  const [search, setSearch] = useState("");

  const toggleCard = useCallback((id: string) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  // Triage is rendered as its own area above the board, so it is kept out of
  // the pipeline column list rather than shown as a first column.
  const pipelineColumns = useMemo(
    () => columns.filter((c) => c.key !== TRIAGE),
    [columns]
  );

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const c of cards) {
      const list = map.get(c.columnKey) ?? [];
      list.push(c);
      map.set(c.columnKey, list);
    }
    return map;
  }, [cards]);

  const triageCards = useMemo(() => {
    const all = cardsByColumn.get(TRIAGE) ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((c) => c.clientName.toLowerCase().includes(q)) : all;
  }, [cardsByColumn, search]);

  const totals = useMemo(() => {
    const quota = cards.reduce((n, c) => n + c.quota, 0);
    const delivered = cards.reduce((n, c) => n + c.delivered, 0);
    const inPlay = cards.filter((c) => c.columnKey !== TRIAGE).length;
    return { quota, delivered, inPlay };
  }, [cards]);

  const availableClients = useMemo(() => {
    const carded = new Set(cards.map((c) => c.clientId));
    return clients.filter((c) => !carded.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, cards]);

  const moveCard = useCallback(
    async (cardId: string, columnKey: string) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId ? { ...c, columnKey: columnKey as BoardCard["columnKey"] } : c
        )
      );
      const res = await fetch(`/api/lifecycle/board/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnKey }),
      });
      if (!res.ok) void load(period);
    },
    [load, period]
  );

  // The quota is a client-level contract term, so every card for that client
  // (this month and any other) updates together.
  const saveQuota = useCallback(
    async (cardId: string, quota: number) => {
      let clientId: string | null = null;
      setCards((prev) => {
        clientId = prev.find((c) => c.id === cardId)?.clientId ?? null;
        return prev.map((c) => (c.clientId === clientId ? { ...c, quota } : c));
      });
      const res = await fetch(`/api/lifecycle/board/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quota }),
      });
      if (!res.ok) void load(period);
    },
    [load, period]
  );

  const saveNotes = useCallback(async (cardId: string, notes: string) => {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, notes } : c)));
    await fetch(`/api/lifecycle/board/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  }, []);

  const removeCard = useCallback(async (card: BoardCard) => {
    if (!confirm(`Remove ${card.clientName}'s card for ${periodLabel(card.period)}?`)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    await fetch(`/api/lifecycle/board/cards/${card.id}`, { method: "DELETE" });
  }, []);

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

  const addItem = useCallback(
    async (cardId: string) => {
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
          prev.map((c) =>
            c.id === cardId ? { ...c, manualItems: [...c.manualItems, data.item] } : c
          )
        );
        setDrafts((d) => ({ ...d, [cardId]: "" }));
      }
    },
    [drafts]
  );

  const toggleItem = useCallback(async (cardId: string, itemId: string, done: boolean) => {
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
  }, []);

  const removeItem = useCallback(async (cardId: string, itemId: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, manualItems: c.manualItems.filter((i) => i.id !== itemId) } : c
      )
    );
    await fetch(`/api/lifecycle/board/items/${itemId}`, { method: "DELETE" });
  }, []);

  const setDraft = useCallback((id: string, value: string) => {
    setDrafts((d) => ({ ...d, [id]: value }));
  }, []);

  function handlersFor(card: BoardCard): CardHandlers {
    return {
      columns,
      isOpen: openCards.has(card.id),
      draft: drafts[card.id] || "",
      dragging: draggingId === card.id,
      onToggle: toggleCard,
      onMove: (id, key) => void moveCard(id, key),
      onQuota: (id, q) => void saveQuota(id, q),
      onNotes: (id, n) => void saveNotes(id, n),
      onRemove: (c) => void removeCard(c),
      onDraft: setDraft,
      onAddItem: (id) => void addItem(id),
      onToggleItem: (cid, iid, done) => void toggleItem(cid, iid, done),
      onRemoveItem: (cid, iid) => void removeItem(cid, iid),
      onDragStart: setDraggingId,
      onDragEnd: () => setDraggingId(null),
    };
  }

  function dropProps(key: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverCol(key);
      },
      onDragLeave: () => setDragOverCol((cur) => (cur === key ? null : cur)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        setDragOverCol(null);
        setDraggingId(null);
        if (id) void moveCard(id, key);
      },
    };
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
              This month
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
            emails delivered against contract
          </span>
          <span>
            <b>{totals.inPlay}</b> in the pipeline
          </span>
        </div>
      ) : null}

      {loading ? (
        <p className="hud-empty">Loading the board…</p>
      ) : cards.length === 0 ? (
        <p className="hud-empty">No clients on the board yet. Add one above.</p>
      ) : (
        <>
          <div
            className={`hud-triage ${triageOpen ? "open" : ""} ${
              dragOverCol === TRIAGE ? "drag-over" : ""
            }`}
            {...dropProps(TRIAGE)}
          >
            <div className="hud-triage-head">
              <button
                type="button"
                className="hud-triage-toggle"
                onClick={() => setTriageOpen((v) => !v)}
                aria-expanded={triageOpen}
              >
                <span className="hud-triage-chevron">{triageOpen ? "▾" : "▸"}</span>
                Triage
                <span className="hud-board-col-count">
                  {cardsByColumn.get(TRIAGE)?.length ?? 0}
                </span>
              </button>
              {triageOpen ? (
                <input
                  className="hud-triage-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a client…"
                />
              ) : null}
              <span className="hud-triage-hint">Drag one into a stage to start work</span>
            </div>

            {triageOpen ? (
              triageCards.length === 0 ? (
                <p className="hud-empty" style={{ margin: 0 }}>
                  {search ? "No client matches that." : "Triage is clear."}
                </p>
              ) : (
                <div className="hud-triage-grid">
                  {triageCards.map((card) => (
                    <Card key={card.id} card={card} {...handlersFor(card)} />
                  ))}
                </div>
              )
            ) : null}
          </div>

          <div className="hud-board-cols">
            {pipelineColumns.map((col) => {
              const colCards = cardsByColumn.get(col.key) ?? [];
              return (
                <div
                  key={col.key}
                  className={`hud-board-col ${dragOverCol === col.key ? "drag-over" : ""}`}
                  {...dropProps(col.key)}
                >
                  <div className="hud-board-col-head">
                    <span>{col.label}</span>
                    <span className="hud-board-col-count">{colCards.length}</span>
                  </div>

                  {colCards.length === 0 ? (
                    <div className="hud-board-empty-col">Drop a card here</div>
                  ) : (
                    colCards.map((card) => (
                      <Card key={card.id} card={card} {...handlersFor(card)} />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
