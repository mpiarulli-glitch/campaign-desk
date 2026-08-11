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
  dragging: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, columnKey: string) => void;
  onQuota: (id: string, quota: number) => void;
  onRemove: (card: BoardCard) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

/**
 * A card is its client, a count against contract, and the campaigns that
 * actually went out for approval this month. The stage picker and contracted
 * volume live behind the header toggle; a column can hold fifty of these, and
 * showing form fields on every one is unreadable.
 */
function Card({ card, ...h }: { card: BoardCard } & CardHandlers) {
  const pct = card.quota > 0 ? Math.min(100, (card.delivered / card.quota) * 100) : 0;
  const state =
    card.quota === 0 ? "none" : card.delivered >= card.quota ? "met" : "open";
  const suggestHint =
    card.suggestedColumnKey !== card.columnKey
      ? h.columns.find((c) => c.key === card.suggestedColumnKey)?.label
      : null;

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
      <div className="hud-board-card-head">
        <button
          type="button"
          className="hud-board-card-title"
          onClick={() => h.onToggle(card.id)}
          aria-expanded={h.isOpen}
        >
          <b>{card.clientName}</b>
        </button>
        <span className={`hud-board-count is-${state}`}>
          {card.quota > 0 ? `${card.delivered}/${card.quota}` : card.delivered || "—"}
        </span>
        <button
          type="button"
          className="hud-board-dismiss"
          onClick={() => h.onRemove(card)}
          title={`Remove ${card.clientName} from this month and every month after`}
          aria-label={`Remove ${card.clientName} from this month and every month after`}
        >
          ×
        </button>
      </div>

      {card.quota > 0 ? (
        <div className={`hud-progress is-${state}`}>
          <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {card.campaigns.length > 0 ? (
        <div className="hud-board-chip-row">
          {card.campaigns.map((camp) => {
            const parts = [
              camp.emailCount > 0
                ? `${camp.emailCount} email${camp.emailCount === 1 ? "" : "s"}`
                : "",
              camp.smsCount > 0 ? `${camp.smsCount} SMS` : "",
            ].filter(Boolean);
            return (
              <Link
                key={camp.id}
                href={`/admin/campaigns/${camp.id}`}
                className="hud-board-camp-chip"
                title={`${camp.title} — ${parts.join(" + ")}`}
              >
                <StatusBadge status={camp.status} />
                <span>{camp.title}</span>
                {camp.smsCount > 0 ? (
                  <em className="hud-board-camp-sms">SMS</em>
                ) : null}
                {camp.emailCount > 1 ? (
                  <em className="hud-board-camp-n">×{camp.emailCount}</em>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="hud-board-nocamp">None</p>
      )}

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

  // Removing dismisses the card rather than deleting it, so the board's
  // per-client re-seed cannot bring it back on the next load. It also carries
  // into every later month, which past months never see.
  const removeCard = useCallback(async (card: BoardCard) => {
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    const res = await fetch(`/api/lifecycle/board/cards/${card.id}`, { method: "DELETE" });
    if (!res.ok) void load(period);
  }, [load, period]);

  async function addCard() {
    if (!addingClientId) return;
    const wanted = addingClientId;
    setError("");
    const res = await fetch("/api/lifecycle/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: wanted, period }),
    });
    if (!res.ok) {
      setError("Could not add that client to the board.");
      return;
    }
    const data = await res.json();
    setAddingClientId("");
    setCards(data.cards || []);
    // A 200 that didn't actually put the client on the board is the failure
    // mode worth shouting about — it used to look like nothing happened.
    if (!(data.cards || []).some((c: BoardCard) => c.clientId === wanted)) {
      setError("That client could not be added. Reload and try again.");
    }
  }

  function handlersFor(card: BoardCard): CardHandlers {
    return {
      columns,
      isOpen: openCards.has(card.id),
      dragging: draggingId === card.id,
      onToggle: toggleCard,
      onMove: (id, key) => void moveCard(id, key),
      onQuota: (id, q) => void saveQuota(id, q),
      onRemove: (c) => void removeCard(c),
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

        {/* Every active client is seeded onto the board automatically, so this
            only has anything to offer once someone has been removed, or for a
            client the sweep skips. Saying so beats an empty dropdown. */}
        <div className="hud-board-add">
          {availableClients.length === 0 ? (
            <span className="hud-board-add-none">Every client is already on the board</span>
          ) : (
            <>
              <select
                value={addingClientId}
                onChange={(e) => setAddingClientId(e.target.value)}
              >
                <option value="">Add a client…</option>
                {availableClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button className="hud-btn" disabled={!addingClientId} onClick={addCard}>
                Add
              </button>
            </>
          )}
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
