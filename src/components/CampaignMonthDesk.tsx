"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  MONTH_DESK_NEXT_MONTH_RULE,
  MONTH_DESK_THIS_MONTH_RULE,
  deliverableText,
  sortDeskCards,
  type MonthDeskCard,
  type MonthDeskFolder,
  type MonthDeskTone,
} from "@/lib/campaign-month-desk";
import { formatPacificSend, isValidPeriod } from "@/lib/period";

type SummaryCard = Omit<MonthDeskCard, "months">;

type DeskPayload = {
  period: string;
  nextPeriod: string;
  canSetTarget: boolean;
  rules: { thisMonth: string; nextMonth: string };
  clients?: SummaryCard[];
  client?: MonthDeskCard;
};

const AVATAR_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#f59e0b",
  "#ec4899",
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function toneClass(tone: MonthDeskTone): string {
  if (tone === "complete") return "is-met";
  if (tone === "partial") return "is-partial";
  if (tone === "behind") return "is-behind";
  return "is-unset";
}

function readParams(): { client: string; month: string } {
  if (typeof window === "undefined") return { client: "", month: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    client: params.get("client") || "",
    month: params.get("month") || "",
  };
}

function writeParams(client: string, month: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "clients");
  if (client) url.searchParams.set("client", client);
  else url.searchParams.delete("client");
  if (month && client) url.searchParams.set("month", month);
  else url.searchParams.delete("month");
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.pushState(null, "", next);
}

function ProgressFigure({
  kicker,
  done,
  target,
  tone,
  rule,
  prominent,
}: {
  kicker: string;
  done: number;
  target: number;
  tone: MonthDeskTone;
  rule: string;
  prominent?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const text = deliverableText(done, target);
  return (
    <div className={`cmd-fig ${prominent ? "is-prominent" : ""} ${toneClass(tone)}`}>
      <div className="cmd-fig-line">
        <span className="cmd-kicker">{kicker}</span>
        <span className={`cmd-num ${toneClass(tone)}`} title={rule}>
          {text}
        </span>
      </div>
      {target > 0 ? (
        <div
          className="cmd-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={Math.min(done, target)}
          aria-label={`${kicker} ${text}. ${rule}`}
        >
          <span className={`cmd-meter-fill ${toneClass(tone)}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <p className="cmd-rule">{rule}</p>
      )}
      {target > 0 ? <p className="cmd-rule">{rule}</p> : null}
    </div>
  );
}

function ClientMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <span className="snap-pick-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" width={44} height={44} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="snap-pick-logo is-initials" style={{ background: avatarColor(name) }}>
      {initials(name)}
    </span>
  );
}

export function CampaignMonthDesk() {
  const [cards, setCards] = useState<SummaryCard[]>([]);
  const [detail, setDetail] = useState<MonthDeskCard | null>(null);
  const [canSetTarget, setCanSetTarget] = useState(false);
  const [clientKey, setClientKey] = useState("");
  const [month, setMonth] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "attention">("attention");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [editingTarget, setEditingTarget] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [cardTargetKey, setCardTargetKey] = useState("");
  const [cardTargetDraft, setCardTargetDraft] = useState("");

  const loadSummary = useCallback(async () => {
    const res = await fetch("/api/campaigns/month-desk");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) {
      setError("Could not load clients.");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as DeskPayload;
    setCards(data.clients || []);
    setCanSetTarget(Boolean(data.canSetTarget));
    setLoading(false);
  }, []);

  const loadDetail = useCallback(async (key: string) => {
    const res = await fetch(`/api/campaigns/month-desk?client=${encodeURIComponent(key)}`);
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) {
      setError("Could not open that client.");
      setDetail(null);
      return;
    }
    const data = (await res.json()) as DeskPayload;
    setDetail(data.client || null);
    setCanSetTarget(Boolean(data.canSetTarget));
    setTargetDraft(String(data.client?.target || ""));
  }, []);

  useEffect(() => {
    const params = readParams();
    setClientKey(params.client);
    setMonth(params.month);
    void loadSummary();
    if (params.client) void loadDetail(params.client);

    const onPop = () => {
      const next = readParams();
      setClientKey(next.client);
      setMonth(next.month);
      if (next.client) void loadDetail(next.client);
      else setDetail(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadDetail, loadSummary]);

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? cards.filter((card) => card.name.toLowerCase().includes(q)) : cards;
    return sortDeskCards(matched, sort);
  }, [cards, query, sort]);

  function openClient(key: string) {
    setClientKey(key);
    setMonth("");
    setEditingTarget(false);
    writeParams(key, "");
    void loadDetail(key);
  }

  function closeClient() {
    setClientKey("");
    setMonth("");
    setDetail(null);
    setEditingTarget(false);
    writeParams("", "");
  }

  function openMonth(period: string) {
    setMonth(period);
    writeParams(clientKey, period);
  }

  async function saveCardTarget(card: SummaryCard) {
    if (!card.id) return;
    const next = Math.max(0, Math.round(Number(cardTargetDraft)));
    if (!Number.isFinite(next)) return;
    setSavingTarget(true);
    setError("");
    const res = await fetch(`/api/revenue/clients/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyEmailQuota: next }),
    });
    setSavingTarget(false);
    if (!res.ok) {
      setError("Could not save the monthly deliverables.");
      return;
    }
    setCardTargetKey("");
    await loadSummary();
  }

  async function saveTarget(raw: string) {
    if (!detail?.id) return;
    const next = Math.max(0, Math.round(Number(raw)));
    if (!Number.isFinite(next)) return;
    setSavingTarget(true);
    setError("");
    const res = await fetch(`/api/revenue/clients/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyEmailQuota: next }),
    });
    setSavingTarget(false);
    if (!res.ok) {
      setError("Could not save the monthly deliverables.");
      return;
    }
    setEditingTarget(false);
    await loadSummary();
    await loadDetail(detail.key);
  }

  const openFolder: MonthDeskFolder | null = useMemo(() => {
    if (!detail) return null;
    const selected =
      month && isValidPeriod(month)
        ? detail.months.find((folder) => folder.period === month)
        : detail.months.find((folder) => folder.role === "next");
    return selected || detail.months[0] || null;
  }, [detail, month]);

  if (clientKey) {
    const folder = openFolder;
    const rule =
      folder?.role === "next"
        ? MONTH_DESK_NEXT_MONTH_RULE
        : folder?.role === "current"
          ? MONTH_DESK_THIS_MONTH_RULE
          : "Filed by the month each campaign counts for.";
    return (
      <div className="cmd-desk">
        <div className="cmd-detail-head">
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeClient}>
            All clients
          </button>
          {detail ? (
            <div className="cmd-detail-title">
              <ClientMark name={detail.name} logoUrl={detail.logoUrl} />
              <div>
                <h2 className="h2">{detail.name}</h2>
                <p className="cmd-rule">
                  {MONTH_DESK_NEXT_MONTH_RULE}. {MONTH_DESK_THIS_MONTH_RULE}.
                </p>
              </div>
            </div>
          ) : (
            <h2 className="h2">Client</h2>
          )}
          {detail?.id && canSetTarget ? (
            <label className="cmd-target">
              <span>Monthly deliverables</span>
              <input
                type="number"
                min={0}
                step={1}
                value={editingTarget ? targetDraft : String(detail.target || "")}
                placeholder="Set target"
                aria-label={`Monthly deliverables for ${detail.name}`}
                disabled={savingTarget}
                onFocus={() => {
                  setEditingTarget(true);
                  setTargetDraft(detail.target ? String(detail.target) : "");
                }}
                onChange={(e) => setTargetDraft(e.target.value)}
                onBlur={() => void saveTarget(targetDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveTarget(targetDraft);
                  }
                }}
              />
            </label>
          ) : null}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {!detail ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="cmd-folders-layout">
            <div className="cmd-folders" aria-label="Months">
              <label className="cmd-jump">
                <span>Jump to month</span>
                <input
                  type="month"
                  value={folder?.period || detail.nextMonth.period}
                  aria-label="Jump to a month"
                  onChange={(e) => {
                    if (isValidPeriod(e.target.value)) openMonth(e.target.value);
                  }}
                />
              </label>
              {detail.months.map((item) => {
                const open = folder?.period === item.period;
                const fraction =
                  item.role === "next" || item.role === "current"
                    ? deliverableText(item.done, detail.target)
                    : `${item.campaignCount}`;
                return (
                  <button
                    key={item.period}
                    type="button"
                    className={`cmd-folder ${item.role === "next" ? "is-next" : ""} ${open ? "is-open" : ""}`}
                    aria-pressed={open}
                    onClick={() => openMonth(item.period)}
                  >
                    <span className="cmd-folder-name">{item.label}</span>
                    <span className="cmd-folder-role">
                      {item.role === "next"
                        ? "Next month"
                        : item.role === "current"
                          ? "This month"
                          : item.role === "later"
                            ? "Later"
                            : "Past"}
                    </span>
                    <span className="cmd-folder-count">{fraction}</span>
                    {item.needsApproval > 0 ? (
                      <span className="cmd-warn">
                        Needs approval by the 1st · {item.needsApproval}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <section className="cmd-month" aria-label={folder ? folder.label : "Month"}>
              {folder ? (
                <>
                  <header className="cmd-month-head">
                    <div>
                      <p className="eyebrow">
                        {folder.role === "next" ? "Next month" : folder.role === "current" ? "This month" : folder.label}
                      </p>
                      <h3 className="h2">{folder.label}</h3>
                    </div>
                    <p className="cmd-rule">{rule}</p>
                  </header>
                  {folder.needsApproval > 0 ? (
                    <p className="cmd-warn cmd-warn-block">
                      Needs approval by the 1st · {folder.needsApproval} not yet sent for
                      internal approval
                    </p>
                  ) : null}
                  {folder.campaigns.length === 0 ? (
                    <p className="muted">No campaigns count for {folder.label}.</p>
                  ) : (
                    <ul className="cmd-campaigns">
                      {folder.campaigns.map((campaign) => (
                        <li key={campaign.id}>
                          <Link href={`/admin/campaigns/${campaign.id}`} className="cmd-campaign">
                            <span className="cmd-campaign-title">{campaign.title}</span>
                            <StatusBadge
                              status={campaign.status}
                              approvedChannel={campaign.approved_channel}
                            />
                            <span className="cmd-campaign-send">
                              {campaign.sendAt
                                ? formatPacificSend(campaign.sendAt)
                                : "Not scheduled"}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="muted">Pick a month.</p>
              )}
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cmd-desk">
      <div className="cmd-bar">
        <label className="clist-field clist-search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Client name"
            aria-label="Search clients"
          />
        </label>
        <label className="clist-field">
          <span>Sort</span>
          <select
            className="campaign-filter-select"
            aria-label="Sort clients"
            value={sort}
            onChange={(e) => setSort(e.target.value === "name" ? "name" : "attention")}
          >
            <option value="attention">Needs attention first</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : visibleCards.length === 0 ? (
        <p className="lh-empty">No clients match.</p>
      ) : (
        <div className="snap-pick-grid">
          {visibleCards.map((card) => {
            return (
              <article key={card.key} className="snap-pick-card lh-pick-card cmd-card">
                <div
                  role="button"
                  tabIndex={0}
                  className="cmd-open"
                  onClick={() => openClient(card.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openClient(card.key);
                    }
                  }}
                >
                  <div className="snap-pick-card-head">
                    <ClientMark name={card.name} logoUrl={card.logoUrl} />
                    <div className="snap-pick-card-title">
                      <h3>{card.name}</h3>
                    </div>
                  </div>
                  <ProgressFigure
                    kicker="Next Month"
                    done={card.nextMonth.done}
                    target={card.nextMonth.target}
                    tone={card.nextMonth.tone}
                    rule={MONTH_DESK_NEXT_MONTH_RULE}
                    prominent
                  />
                  <ProgressFigure
                    kicker="This Month"
                    done={card.thisMonth.done}
                    target={card.thisMonth.target}
                    tone={card.thisMonth.tone}
                    rule={MONTH_DESK_THIS_MONTH_RULE}
                  />
                  {card.nextMonth.statuses.length > 0 ? (
                    <p className="cmd-statuses">
                      {card.nextMonth.statuses.map((status) => (
                        <span key={status.value}>
                          {status.count} {status.label}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="cmd-statuses cmd-statuses-empty">Nothing filed for next month</p>
                  )}
                  {card.nextMonth.needsApproval > 0 ? (
                    <p className="cmd-warn">
                      Needs approval by the 1st · {card.nextMonth.needsApproval}
                    </p>
                  ) : null}
                </div>
                {canSetTarget && card.id && card.target <= 0 ? (
                  <div className="snap-pick-card-foot">
                    {cardTargetKey === card.key ? (
                      <form
                        className="cmd-target-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveCardTarget(card);
                        }}
                      >
                        <input
                          type="number"
                          min={0}
                          step={1}
                          autoFocus
                          aria-label={`Monthly deliverables for ${card.name}`}
                          value={cardTargetDraft}
                          disabled={savingTarget}
                          onChange={(e) => setCardTargetDraft(e.target.value)}
                        />
                        <button type="submit" className="cmd-set-target" disabled={savingTarget}>
                          Save
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="cmd-set-target"
                        onClick={() => {
                          setCardTargetKey(card.key);
                          setCardTargetDraft("");
                        }}
                      >
                        Set target
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
