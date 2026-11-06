"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { grokBotHref, type BotIcon } from "@/lib/bot-activity-icons";
import {
  cardStatusLabel,
  cardTone,
  centerCounts,
  centerSubline,
  greeting,
  orbLabel,
} from "@/lib/bot-activity-center";
import {
  botHeartbeat,
  botPortraitSrc,
  currentAssignment,
  doingTitle,
  heardLabel,
  isUntouchedSeed,
  rowCountsLive,
  statusForBot,
  teamRank,
  timeAgo,
  type TeamStatus,
} from "@/lib/bot-activity-live";
import { needsAttention } from "@/lib/bot-activity-office";
import { formatClockPt, formatDayPt } from "@/lib/bot-activity-time";

type Waiting = {
  id: string;
  bot: string;
  icon: BotIcon;
  chatHref: string | null;
  title: string;
  detail: string;
  when: string;
  at: string;
  updatedAt?: string;
};
type Work = {
  id: string;
  bot: string;
  title: string;
  detail: string;
  state: "progress" | "blocked" | "done";
  at: string;
  updatedAt?: string;
};
type Line = { id: string; bot: string; text: string; at: string; postedAt?: string };
type Bot = { name: string; icon: BotIcon };

export type CenterLens = "all" | "running" | "pending" | "paused";

function Portrait({ name, tone }: { name: string; tone: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`ba-avatar ba-portrait is-${tone}`}>
      {broken ? (
        <span aria-hidden="true">{name.slice(0, 1)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={botPortraitSrc(name)} alt={name} onError={() => setBroken(true)} />
      )}
      {tone === "running" ? (
        <span className="ba-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}

function Spark({ tone }: { tone: string }) {
  return (
    <svg className={`ba-spark is-${tone}`} viewBox="0 0 120 36" aria-hidden="true">
      <path
        d="M0 24 C 10 24, 16 12, 26 14 S 42 28, 54 18 S 74 8, 88 16 S 106 26, 120 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function matchesLens(status: TeamStatus, lens: CenterLens): boolean {
  if (lens === "all") return true;
  if (lens === "running") return status === "Working";
  if (lens === "pending") return needsAttention(status);
  return status === "Blocked" || status === "Stalled";
}

export function CommandCenter({
  bots,
  waiting,
  work,
  lines,
  now,
  stamp,
  refreshFailed,
  botFilter,
  botNames,
  lens,
  celebrating,
  busy,
  expanded,
  onFilter,
  onLens,
  onExpanded,
  onDismiss,
}: {
  bots: Bot[];
  waiting: Waiting[];
  work: Work[];
  lines: Line[];
  now: number;
  stamp: string;
  refreshFailed: boolean;
  botFilter: string;
  botNames: string[];
  lens: CenterLens;
  celebrating: ReadonlySet<string>;
  busy: string;
  expanded: boolean;
  onFilter: (name: string) => void;
  onLens: (lens: CenterLens) => void;
  onExpanded: (expanded: boolean) => void;
  onDismiss: (item: Waiting) => void;
}) {
  const names = bots.map((bot) => bot.name);
  const counts = centerCounts(names, waiting, work, lines, now);
  const iso = new Date(now).toISOString();
  const cards = bots
    .map((bot) => {
      const status = statusForBot(bot.name, waiting, work, lines, now);
      return { bot, status };
    })
    .filter(({ bot, status }) => {
      if (botFilter !== "All bots" && bot.name !== botFilter) return false;
      return matchesLens(status, lens);
    })
    .sort((a, b) => teamRank(a.status) - teamRank(b.status) || a.bot.name.localeCompare(b.bot.name));

  return (
    <section className="ba-center" aria-label="AI team">
      <div className="ba-hero-top">
        <div className="ba-title-block">
          <h1 className="ba-hello">{greeting(now)}</h1>
          <p className="ba-sub">{centerSubline(counts)}</p>
        </div>
        <div className="ba-clock">
          <strong>{formatDayPt(iso)}</strong>
          <span>{formatClockPt(iso)} PT</span>
          <p className="muted ba-updated" aria-live="off">
            <span className="ba-live-dot" aria-hidden="true" />
            <span>{stamp}</span>
            {refreshFailed ? <span className="ba-refresh-note">{" · Couldn't refresh"}</span> : null}
          </p>
        </div>
      </div>

      <div className="ba-meters">
        <button
          type="button"
          className={`ba-gauge ba-gauge-pending ${lens === "pending" ? "is-on" : ""}`}
          aria-pressed={lens === "pending"}
          onClick={() => onLens("pending")}
        >
          <span className="ba-gauge-ring" aria-hidden="true" />
          <span className="ba-gauge-num">{counts.pending}</span>
          <span className="ba-gauge-label">Pending</span>
        </button>

        <button
          type="button"
          className={`ba-orb ${counts.running > 0 ? "is-live" : "is-quiet"} ${lens === "running" ? "is-on" : ""}`}
          aria-pressed={lens === "running"}
          onClick={() => onLens("running")}
        >
          <span className="ba-orb-ring" aria-hidden="true" />
          <span className="ba-orb-core">
            <span className="ba-orb-num">{counts.running}</span>
            <span className="ba-orb-label">{orbLabel(counts.running)}</span>
            {counts.running > 0 ? (
              <span className="ba-orb-active">
                <i aria-hidden="true" />
                Active
              </span>
            ) : null}
          </span>
        </button>

        <button
          type="button"
          className={`ba-gauge ba-gauge-paused ${lens === "paused" ? "is-on" : ""}`}
          aria-pressed={lens === "paused"}
          onClick={() => onLens("paused")}
        >
          <span className="ba-gauge-ring" aria-hidden="true" />
          <span className="ba-gauge-num">{counts.paused}</span>
          <span className="ba-gauge-label">Paused</span>
        </button>
      </div>

      <div className="ba-active-head">
        <h2 className="ba-active-title">Active Bots</h2>
        <div className="ba-active-tools">
          <label className="ba-sr" htmlFor="ba-bot">
            Bot
          </label>
          <select id="ba-bot" value={botFilter} onChange={(event) => onFilter(event.target.value)}>
            {botNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ba-viewall"
            aria-pressed={expanded && lens === "all" && botFilter === "All bots"}
            onClick={() => {
              onFilter("All bots");
              if (lens !== "all") onLens("all");
              onExpanded(true);
            }}
          >
            View all
          </button>
        </div>
      </div>

      <div id="ba-cards" className={`ba-cards ${expanded ? "is-all" : ""}`}>
        {cards.length === 0 ? <p className="muted ba-cards-empty">No bots in this view.</p> : null}
        {cards.map(({ bot, status }) => (
          <BotCard
            key={bot.name}
            bot={bot}
            status={status}
            waiting={waiting}
            work={work}
            lines={lines}
            now={now}
            celebrating={celebrating.has(bot.name)}
            busy={busy}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function hoverUnavailable(): boolean {
  return window.matchMedia("(hover: none)").matches;
}

function CardPop({
  anchor,
  kind,
  label,
  onPointer,
  children,
}: {
  anchor: HTMLElement;
  kind: "needs" | "status";
  label: string;
  onPointer: (inside: boolean) => void;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, left: 0, width: 280 });

  useLayoutEffect(() => {
    const place = () => {
      const card = anchor.getBoundingClientRect();
      const height = popRef.current?.offsetHeight ?? 150;
      const width = Math.max(260, Math.round(card.width));
      let left = card.left + card.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = card.top - 10 - height;
      if (top < 8) top = card.top + 8;
      setBox((prev) => (prev.top === top && prev.left === left && prev.width === width ? prev : { top, left, width }));
    };
    place();
    const observer = new ResizeObserver(place);
    if (popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={popRef}
      className={`ba-pop is-${kind}`}
      role={kind === "needs" ? "dialog" : "tooltip"}
      aria-label={label}
      style={{ top: box.top, left: box.left, width: box.width }}
      onMouseEnter={() => onPointer(true)}
      onMouseLeave={() => onPointer(false)}
      onKeyDown={(event) => {
        if (event.key === "Tab" && event.shiftKey && event.target === popRef.current?.querySelector("a, button")) {
          event.preventDefault();
          anchor.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
}

function BotCard({
  bot,
  status,
  waiting,
  work,
  lines,
  now,
  celebrating,
  busy,
  onDismiss,
}: {
  bot: Bot;
  status: TeamStatus;
  waiting: Waiting[];
  work: Work[];
  lines: Line[];
  now: number;
  celebrating: boolean;
  busy: string;
  onDismiss: (item: Waiting) => void;
}) {
  const tone = cardTone(status);
  const task =
    (status === "Working" ? doingTitle(bot.name, work, now) : "") ||
    currentAssignment(bot.name, work, lines)?.title ||
    (status === "Idle" ? "Standing by" : "No fresh update");
  const heartbeat = botHeartbeat(bot.name, work, lines, now);
  const ago = timeAgo(heartbeat, now);
  const footer =
    status === "Working"
      ? `Last update ${ago || "just now"}`
      : heardLabel(bot.name, waiting, work, lines, now);
  const mine = waiting.filter((item) => item.bot === bot.name);
  const live = mine
    .filter((item) => rowCountsLive(item, now))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const old = mine
    .filter((item) => isUntouchedSeed(item) && !rowCountsLive(item, now))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const featured = live[0] || null;
  const oldOne = featured ? null : old[0] || null;
  const blocked = work.find((item) => item.bot === bot.name && item.state === "blocked" && rowCountsLive(item, now));
  const needs = Boolean(featured) || Boolean(blocked && needsAttention(status));
  const chat = grokBotHref(bot.name);
  const askHref = featured ? featured.chatHref || chat : chat;
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const visible = hover || pinned;

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function show() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setHover(true);
  }
  function hideSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(false), 140);
  }

  return (
    <>
      <a
        ref={cardRef}
        className={`ba-botcard is-${tone} ${celebrating ? "is-done" : ""}`}
        href={chat || "#"}
        aria-expanded={visible}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && document.querySelector(".ba-pop")?.contains(next)) return;
          hideSoon();
        }}
        onClick={(event) => {
          if (hoverUnavailable()) {
            event.preventDefault();
            setPinned((open) => !open);
            return;
          }
          if (!chat) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setHover(false);
            setPinned(false);
          }
          if (event.key === "Tab" && !event.shiftKey) {
            const first = document.querySelector<HTMLElement>(".ba-pop a, .ba-pop button");
            if (first) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {needs ? <span className="ba-badge" aria-hidden="true" /> : null}
        <div className="ba-botcard-top">
          <Portrait name={bot.name} tone={tone} />
          <div className="ba-botcard-id">
            <p className="ba-botcard-name">{bot.name}</p>
            <p className="ba-botcard-task">{task}</p>
          </div>
        </div>
        <p className={`ba-status is-${tone}`}>
          <i aria-hidden="true" />
          {cardStatusLabel(status)}
          {celebrating ? <span className="ba-just">Done</span> : null}
        </p>
        <Spark tone={tone} />
        <p className="ba-card-foot">{footer}</p>
      </a>
      {visible && cardRef.current
        ? needs
          ? (
            <CardPop anchor={cardRef.current} kind="needs" label={`Needs you, ${bot.name}`} onPointer={(inside) => (inside ? show() : hideSoon())}>
              <p className="ba-say-kicker">Needs you</p>
              <p className="ba-say-text">{featured?.title || blocked?.title}</p>
              {(featured?.detail || blocked?.detail) ? (
                <p className="ba-say-detail">{featured?.detail || blocked?.detail}</p>
              ) : null}
              {live.length > 1 ? <p className="ba-old">{live.length - 1} more in the list below</p> : null}
              <div className="ba-wait-actions">
                {askHref ? (
                  <a className="btn ba-open-chat" href={askHref}>
                    Open chat
                  </a>
                ) : null}
                {featured ? (
                  <button
                    type="button"
                    className="ba-dismiss"
                    onClick={() => onDismiss(featured)}
                    disabled={busy === featured.id}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </CardPop>
          )
          : (
            <CardPop anchor={cardRef.current} kind="status" label={bot.name} onPointer={(inside) => (inside ? show() : hideSoon())}>
              <p className="ba-say-kicker">{cardStatusLabel(status)}</p>
              <p className="ba-say-text">{task}</p>
              <p className="ba-old">{footer}</p>
              {oldOne ? (
                <div className="ba-wait-actions">
                  <p className="ba-old">Old request · {oldOne.title}</p>
                  <button
                    type="button"
                    className="ba-dismiss"
                    onClick={() => onDismiss(oldOne)}
                    disabled={busy === oldOne.id}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </CardPop>
          )
        : null}
    </>
  );
}
