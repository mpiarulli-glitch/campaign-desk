"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { grokBotHref, type BotIcon } from "@/lib/bot-activity-icons";
import {
  BotActivityRefresh,
  authRedirectForStatus,
  botHoverSummary,
  botPortraitSrc,
  fetchedLabel,
  forElapsed,
  nextBoardState,
  placePopover,
  retainReplyDrafts,
  teamRank,
  timeAgo,
  type BotHoverSummary,
  type PopoverPlace,
  type TeamStatus,
} from "@/lib/bot-activity-live";

type Reply = { id: string; body: string; at: string; when: string };
type Waiting = {
  id: string;
  bot: string;
  icon: BotIcon;
  chatHref: string | null;
  title: string;
  detail: string;
  when: string;
  at: string;
  replies: Reply[];
};
type TimelineEntry = { id: string; bot: string; icon: BotIcon; when: string; text: string; at: string };
type Work = {
  id: string;
  bot: string;
  icon: BotIcon;
  title: string;
  detail: string;
  state: "progress" | "blocked" | "done";
  when: string;
  at: string;
};
type Board = {
  updated: string;
  bots: Array<{ name: string; icon: BotIcon }>;
  waiting: Waiting[];
  timeline: Array<{ day: string; entries: TimelineEntry[] }>;
  work: Work[];
};

function Icon({ k }: { k: BotIcon }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let shape = (
    <g {...common}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </g>
  );
  if (k === "mail") {
    shape = (
      <g {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </g>
    );
  } else if (k === "bolt") {
    shape = (
      <g {...common}>
        <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
      </g>
    );
  } else if (k === "flow") {
    shape = (
      <g {...common}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6H14a3 3 0 0 1 3 3v6.5" />
      </g>
    );
  } else if (k === "clipboard") {
    shape = (
      <g {...common}>
        <rect x="6" y="4" width="12" height="17" rx="2" />
        <path d="M9 4V3h6v1M9 11h6M9 15h4" />
      </g>
    );
  } else if (k === "link") {
    shape = (
      <g {...common}>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </g>
    );
  } else if (k === "chat") {
    shape = (
      <g {...common}>
        <path d="M4 5h16v11H9l-5 4z" />
      </g>
    );
  } else if (k === "chart") {
    shape = (
      <g {...common}>
        <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />
      </g>
    );
  } else if (k === "news") {
    shape = (
      <g {...common}>
        <path d="M5 5h11v14H5z" />
        <path d="M16 8h3v9a2 2 0 0 1-2 2H7" />
        <path d="M8 9h5M8 13h5" />
      </g>
    );
  }
  return (
    <svg className="ba-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {shape}
    </svg>
  );
}

function stateLabel(state: Work["state"]): string {
  if (state === "done") return "Done";
  if (state === "blocked") return "Blocked";
  return "In progress";
}

function BotPortrait({ name, icon }: { name: string; icon: BotIcon }) {
  const src = botPortraitSrc(name);
  const [showIcon, setShowIcon] = useState(false);
  return (
    <span className="ba-avatar">
      {showIcon ? (
        <Icon k={icon} />
      ) : (
        // A missing public/bots file falls back to the icon. next/image cannot.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={72} height={72} onError={() => setShowIcon(true)} />
      )}
    </span>
  );
}

function TeamGrid({
  board,
  botFilter,
  now,
  drafts,
  busy,
  onDraft,
  onReply,
  onDismiss,
}: {
  board: Board;
  botFilter: string;
  now: number;
  drafts: Record<string, string>;
  busy: string;
  onDraft: (id: string, value: string) => void;
  onReply: (item: Waiting) => void;
  onDismiss: (item: Waiting) => void;
}) {
  const lines = board.timeline.flatMap((day) => day.entries);
  const cards = board.bots
    .map((bot) => ({
      bot,
      summary: botHoverSummary(bot.name, board.waiting, board.work, lines),
    }))
    .sort(
      (a, b) => teamRank(a.summary.status) - teamRank(b.summary.status) || a.bot.name.localeCompare(b.bot.name)
    );
  return (
    <section className="ba-team" aria-label="Team">
      <div className="ba-col-head">
        <h2 className="h2">Team</h2>
        <span className="muted">{board.bots.length}</span>
      </div>
      <div className="ba-team-grid">
        {cards.map(({ bot, summary }) => (
          <TeamCard
            key={bot.name}
            name={bot.name}
            icon={bot.icon}
            pressed={botFilter === bot.name}
            now={now}
            summary={summary}
            questions={board.waiting.filter((item) => item.bot === bot.name)}
            blockers={board.work.filter((item) => item.bot === bot.name && item.state === "blocked")}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onReply={onReply}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function TeamCard({
  name,
  icon,
  pressed,
  now,
  summary,
  questions,
  blockers,
  drafts,
  busy,
  onDraft,
  onReply,
  onDismiss,
}: {
  name: string;
  icon: BotIcon;
  pressed: boolean;
  now: number;
  summary: BotHoverSummary;
  questions: Waiting[];
  blockers: Work[];
  drafts: Record<string, string>;
  busy: string;
  onDraft: (id: string, value: string) => void;
  onReply: (item: Waiting) => void;
  onDismiss: (item: Waiting) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);
  const popHoverRef = useRef(false);
  const pinRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<PopoverPlace | null>(null);
  const task = summary.task;
  const ago = task ? timeAgo(task.at, now) : "";
  const elapsed = task ? forElapsed(task.at, now) : "";
  const href = grokBotHref(name);
  const tone =
    summary.status === "Blocked"
      ? "blocked"
      : summary.status === "Waiting on you"
        ? "waiting"
        : summary.status === "Working"
          ? "working"
          : "idle";
  const showBubble = questions.length > 0 || blockers.length > 0;
  const popId = `ba-pop-${name.replace(/\s+/g, "-")}`;
  const summarySig = [
    summary.status,
    task?.title ?? "",
    task?.detail ?? "",
    task?.at ?? "",
    summary.recent.map((item) => item.at + item.text).join(),
    summary.needs.map((item) => item.kind + item.at + item.title).join(),
  ].join("|");

  const requestClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const inside = !!active && (cardRef.current?.contains(active) || popRef.current?.contains(active));
      if (hoverRef.current || popHoverRef.current || pinRef.current || inside) return;
      setOpen(false);
    }, 140);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse") return;
      const target = event.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target) || popRef.current?.contains(target)) return;
      pinRef.current = false;
      hoverRef.current = false;
      popHoverRef.current = false;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const anchorEl = cardRef.current;
      const pop = popRef.current;
      if (!anchorEl || !pop) return;
      const anchor = anchorEl.getBoundingClientRect();
      const previous = pop.style.maxHeight;
      pop.style.maxHeight = "none";
      const natural = pop.offsetHeight;
      const width = pop.offsetWidth;
      pop.style.maxHeight = previous;
      const next = placePopover(
        { top: anchor.top, bottom: anchor.bottom, left: anchor.left, width: anchor.width },
        { width, height: natural },
        { width: window.innerWidth, height: window.innerHeight }
      );
      setBox((current) =>
        current && current.top === next.top && current.left === next.left && current.maxHeight === next.maxHeight
          ? current
          : next
      );
    }
    measure();
    const scroller = document.querySelector(".app-content");
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open, summarySig]);

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            id={popId}
            role="tooltip"
            className="ba-pop"
            style={
              box
                ? { top: box.top, left: box.left, maxHeight: box.maxHeight }
                : { top: 0, left: 8, visibility: "hidden" }
            }
            onMouseEnter={() => {
              popHoverRef.current = true;
              if (closeTimer.current) window.clearTimeout(closeTimer.current);
            }}
            onMouseLeave={() => {
              popHoverRef.current = false;
              requestClose();
            }}
          >
            <div className="ba-pop-head">
              <span className="ba-pop-name">{name}</span>
              <StatusChip status={summary.status} />
            </div>
            <p className="ba-pop-line">{summary.statusLine}</p>
            <p className="ba-pop-kicker">Now</p>
            {task ? (
              <>
                <p className="ba-pop-title">{task.title}</p>
                {task.detail ? <p className="ba-pop-detail">{task.detail}</p> : null}
                {ago ? <p className="ba-ago">{ago}</p> : null}
              </>
            ) : (
              <p className="ba-pop-detail">Nothing running.</p>
            )}
            <p className="ba-pop-kicker">Recent</p>
            {summary.recent.length === 0 ? <p className="ba-pop-detail">No recent activity.</p> : null}
            {summary.recent.map((item) => (
              <div key={item.at + item.text} className="ba-pop-recent">
                <p className="ba-pop-detail">{item.text}</p>
                <p className="ba-ago">{timeAgo(item.at, now)}</p>
              </div>
            ))}
            {summary.needs.length > 0 ? (
              <>
                <p className="ba-pop-kicker">Needs you</p>
                {summary.needs.map((item) => (
                  <div key={`${item.kind}-${item.at}-${item.title}`} className="ba-pop-need">
                    <p className="ba-pop-title">{item.kind === "blocker" ? "Blocker" : "Question"}</p>
                    <p className="ba-pop-detail">{item.title}</p>
                    {item.detail ? <p className="ba-pop-detail">{item.detail}</p> : null}
                  </div>
                ))}
              </>
            ) : null}
          </div>,
          document.body
        )
      : null;

  const face = (
    <>
      <span className="ba-member-top">
        <span className="ba-avatar-slot">
          <BotPortrait name={name} icon={icon} />
        </span>
        <span className="ba-member-id">
          <span className="ba-member-name">{name}</span>
          <StatusChip status={summary.status} />
        </span>
      </span>
      {summary.status === "Working" && task ? (
        <span className="ba-live">
          <span className="ba-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="ba-live-label">Working on: {task.title}</span>
          {elapsed ? <span className="ba-ago">{elapsed}</span> : null}
          <span className="ba-shimmer" aria-hidden="true" />
        </span>
      ) : null}
      {summary.status === "Idle" ? <span className="ba-task-detail">Nothing running.</span> : null}
      {href ? <span className="ba-open-label">Open chat</span> : null}
    </>
  );
  const bubbleText = showBubble ? (
    <>
      <span className="ba-bubble-kicker">Needs you</span>
      {blockers.map((item) => (
        <span key={item.id} className="ba-bubble-block">
          <span className="ba-pop-title">{item.title}</span>
          {item.detail ? <span className="ba-pop-detail">{item.detail}</span> : null}
        </span>
      ))}
      {questions.map((item) => (
        <span key={item.id} className="ba-bubble-ask">
          <span className="ba-pop-title">{item.title}</span>
          {item.detail ? <span className="ba-pop-detail">{item.detail}</span> : null}
        </span>
      ))}
    </>
  ) : null;

  return (
    <article
      ref={cardRef}
      data-bot={name}
      className={`ba-member is-${tone} ${pressed ? "is-on" : ""}`}
      aria-describedby={open ? popId : undefined}
      onMouseEnter={() => {
        hoverRef.current = true;
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
        requestClose();
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        pinRef.current = true;
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        pinRef.current = false;
        setOpen(false);
      }}
    >
      {href ? (
        <a className="ba-card-link" href={href} onFocus={() => setOpen(true)} onBlur={() => requestClose()}>
          {face}
        </a>
      ) : (
        <div className="ba-card-link" tabIndex={0} onFocus={() => setOpen(true)} onBlur={() => requestClose()}>
          {face}
        </div>
      )}
      {showBubble ? (
        <div className={`ba-bubble ${blockers.length > 0 ? "is-blocked" : "is-waiting"}`}>
          {href ? (
            <a className="ba-bubble-link" href={href}>
              {bubbleText}
            </a>
          ) : (
            <div className="ba-bubble-link">{bubbleText}</div>
          )}
          {questions.map((item) => (
            <form
              key={item.id}
              className="ba-reply-form"
              onSubmit={(event) => {
                event.preventDefault();
                onReply(item);
              }}
            >
              {item.replies.map((saved) => (
                <div key={saved.id} className="ba-reply">
                  <p className="ba-reply-body">{saved.body}</p>
                  <p className="ba-when">{saved.when}</p>
                </div>
              ))}
              <label className="field">
                <span className="ba-reply-label">Reply</span>
                <textarea
                  rows={2}
                  value={drafts[item.id] || ""}
                  onChange={(event) => onDraft(item.id, event.target.value)}
                />
              </label>
              <span className="ba-reply-actions">
                <button
                  type="submit"
                  className="btn btn-sm"
                  disabled={busy === item.id || !(drafts[item.id] || "").trim()}
                >
                  Save / Send
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDismiss(item)}
                  disabled={busy === item.id}
                >
                  Dismiss
                </button>
              </span>
            </form>
          ))}
        </div>
      ) : null}
      {popover}
    </article>
  );
}

function StatusChip({ status }: { status: TeamStatus }) {
  const kind =
    status === "Blocked" ? "blocked" : status === "Waiting on you" ? "waiting" : status === "Working" ? "working" : "idle";
  return (
    <span className={`ba-chip ba-chip-${kind}`}>
      <span className={`ba-status-dot ${status === "Working" ? "is-live" : ""}`} aria-hidden="true" />
      {status}
    </span>
  );
}

function WorkCard({ item }: { item: Work }) {
  return (
    <article className="ba-card">
      <div className="ba-bot-row">
        <span className="ba-bot">{item.bot}</span>
        <span className="ba-bot-side">
          <span className={`ba-state ba-state-${item.state}`}>{stateLabel(item.state)}</span>
          <Icon k={item.icon} />
        </span>
      </div>
      <p className="ba-title">{item.title}</p>
      <p className="ba-detail">{item.detail}</p>
      <p className="ba-when">{item.when}</p>
    </article>
  );
}

export default function BotActivityPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [stamp, setStamp] = useState("Fetched …");
  const [botFilter, setBotFilter] = useState("All bots");
  const [workView, setWorkView] = useState<"All" | "In progress" | "Finished">("All");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const draftsRef = useRef(drafts);
  const busyRef = useRef(busy);
  const epochRef = useRef(0);
  draftsRef.current = drafts;
  busyRef.current = busy;

  useEffect(() => {
    let alive = true;
    const boardKey = { current: "" };
    const hasBoard = { current: false };
    const poller = new BotActivityRefresh<number>({
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id),
      run: async () => {
        const seen = epochRef.current;
        let res: Response;
        try {
          res = await fetch("/api/admin/bot-activity", { cache: "no-store" });
        } catch {
          if (!alive) return "fail";
          if (hasBoard.current) setRefreshFailed(true);
          else setError("Could not load bot activity.");
          return "fail";
        }
        if (!alive) return "ok";
        const redirect = authRedirectForStatus(res.status);
        if (redirect) {
          router.push(redirect);
          return "auth";
        }
        if (!res.ok) {
          if (hasBoard.current) setRefreshFailed(true);
          else setError("Could not load bot activity.");
          return "fail";
        }
        let data: Board;
        try {
          data = (await res.json()) as Board;
        } catch {
          if (!alive) return "fail";
          if (hasBoard.current) setRefreshFailed(true);
          else setError("Could not load bot activity.");
          return "fail";
        }
        if (!alive || epochRef.current !== seen) return "ok";
        const step = nextBoardState(boardKey.current, data);
        const label = fetchedLabel(new Date());
        if (!step.board) {
          setStamp((prev) => (prev === label ? prev : label));
          setRefreshFailed((prev) => (prev ? false : prev));
          return "ok";
        }
        const first = !hasBoard.current;
        boardKey.current = step.key;
        hasBoard.current = true;
        setBoard(step.board);
        setDrafts((current) => retainReplyDrafts(current));
        setStamp(label);
        setRefreshFailed(false);
        if (first) setError("");
        return "ok";
      },
    });

    function onVisibility() {
      const hidden = document.visibilityState === "hidden";
      void poller.setHidden(hidden);
      if (!hidden && alive) setNow(Date.now());
    }

    poller.setHidden(document.visibilityState === "hidden");
    void poller.start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const onDraft = useCallback((id: string, value: string) => {
    setDrafts((current) => (current[id] === value ? current : { ...current, [id]: value }));
  }, []);

  const onReply = useCallback(
    async (item: Waiting) => {
      const body = (draftsRef.current[item.id] || "").trim();
      if (!body || busyRef.current) return;
      setBusy(item.id);
      setError("");
      try {
        const res = await fetch("/api/admin/bot-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reply", id: item.id, body }),
        });
        const redirect = authRedirectForStatus(res.status);
        if (redirect) {
          router.push(redirect);
          return;
        }
        if (!res.ok) {
          setError("Could not save that reply.");
          return;
        }
        const data = (await res.json()) as { reply: Reply };
        epochRef.current += 1;
        setBoard((current) =>
          current
            ? {
                ...current,
                waiting: current.waiting.map((row) =>
                  row.id === item.id ? { ...row, replies: [...row.replies, data.reply] } : row
                ),
              }
            : current
        );
        setDrafts((current) => ({ ...current, [item.id]: "" }));
      } catch {
        setError("Could not save that reply.");
      } finally {
        setBusy("");
      }
    },
    [router]
  );

  const onDismiss = useCallback(
    async (item: Waiting) => {
      if (busyRef.current) return;
      setBusy(item.id);
      setError("");
      try {
        const res = await fetch("/api/admin/bot-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss", id: item.id }),
        });
        const redirect = authRedirectForStatus(res.status);
        if (redirect) {
          router.push(redirect);
          return;
        }
        if (!res.ok) {
          setError("Could not dismiss that item.");
          return;
        }
        epochRef.current += 1;
        setBoard((current) =>
          current ? { ...current, waiting: current.waiting.filter((row) => row.id !== item.id) } : current
        );
      } catch {
        setError("Could not dismiss that item.");
      } finally {
        setBusy("");
      }
    },
    [router]
  );

  const botNames = useMemo(() => {
    const names = (board?.bots || []).map((bot) => bot.name);
    if (botFilter !== "All bots" && !names.includes(botFilter)) names.push(botFilter);
    names.sort((a, b) => a.localeCompare(b));
    return ["All bots", ...names];
  }, [board, botFilter]);

  const timeline = useMemo(() => {
    if (!board) return [];
    return board.timeline
      .map((day) => ({
        ...day,
        entries: botFilter === "All bots" ? day.entries : day.entries.filter((entry) => entry.bot === botFilter),
      }))
      .filter((day) => day.entries.length > 0);
  }, [board, botFilter]);

  const timelineCount = timeline.reduce((n, day) => n + day.entries.length, 0);

  const inProgress = useMemo(() => {
    if (!board) return [];
    return board.work.filter(
      (item) => item.state !== "done" && (botFilter === "All bots" || item.bot === botFilter)
    );
  }, [board, botFilter]);

  const finished = useMemo(() => {
    if (!board) return [];
    return board.work.filter(
      (item) => item.state === "done" && (botFilter === "All bots" || item.bot === botFilter)
    );
  }, [board, botFilter]);

  const showProgress = workView === "All" || workView === "In progress";
  const showDone = workView === "All" || workView === "Finished";

  return (
    <main className="container container-wide ba-page stark">
      <div className="ba-head">
        <div>
          <h1 className="h1">Bot Activity</h1>
          <p className="muted ba-updated" aria-live="off">
            {stamp}
            {refreshFailed ? <span className="ba-refresh-note">{" · Couldn't refresh"}</span> : null}
          </p>
        </div>
        <div className="field ba-filter">
          <label htmlFor="ba-bot">Bot</label>
          <select id="ba-bot" value={botFilter} onChange={(event) => setBotFilter(event.target.value)}>
            {botNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {!board && !error ? <p className="muted">Loading…</p> : null}

      {board ? (
        <>
          <TeamGrid
            board={board}
            botFilter={botFilter}
            now={now}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onReply={onReply}
            onDismiss={onDismiss}
          />
          <div className="ba-lower">
            <section className="ba-col">
              <div className="ba-col-head">
                <h2 className="h2">Timeline</h2>
                <span className="muted">{timelineCount}</span>
              </div>
              {timelineCount === 0 ? <p className="muted">Nothing on the timeline.</p> : null}
              {timeline.map((day) => (
                <div key={day.day} className="ba-day">
                  <div className="ba-day-label">{day.day}</div>
                  <div className="ba-day-line">
                    {day.entries.map((entry) => (
                      <div key={entry.id} className="ba-tl">
                        <span className="ba-tl-dot" aria-hidden="true" />
                        <div className="ba-bot-row">
                          <span className="ba-bot">{entry.bot}</span>
                          <span className="ba-bot-side">
                            <span className="ba-when">{entry.when}</span>
                            <Icon k={entry.icon} />
                          </span>
                        </div>
                        <p className="ba-detail">{entry.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <section className="ba-col">
              <div className="ba-col-head">
                <h2 className="h2">In progress and finished</h2>
                <span className="muted">{inProgress.length + finished.length}</span>
              </div>
              <div className="view-toggle ba-toggle" role="group" aria-label="Work">
                {(["All", "In progress", "Finished"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`view-toggle-btn ${workView === option ? "is-on" : ""}`}
                    aria-pressed={workView === option}
                    onClick={() => setWorkView(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {showProgress ? (
                <div className="ba-stack">
                  <div className="ba-day-label">In progress ({inProgress.length})</div>
                  {inProgress.length === 0 ? <p className="muted">Nothing in progress.</p> : null}
                  {inProgress.map((item) => (
                    <WorkCard key={item.id} item={item} />
                  ))}
                </div>
              ) : null}
              {showDone ? (
                <div className="ba-stack">
                  <div className="ba-day-label">Finished ({finished.length})</div>
                  {finished.length === 0 ? <p className="muted">Nothing finished.</p> : null}
                  {finished.map((item) => (
                    <WorkCard key={item.id} item={item} />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
