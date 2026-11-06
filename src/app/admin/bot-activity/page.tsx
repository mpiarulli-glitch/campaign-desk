"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { grokBotHref, type BotIcon } from "@/lib/bot-activity-icons";
import { CommandCenter, type CenterLens } from "./command-center";
import {
  BotActivityRefresh,
  authRedirectForStatus,
  fetchedLabel,
  isUntouchedSeed,
  nextBoardState,
  rowCountsLive,
} from "@/lib/bot-activity-live";
import { finishedBots, timelineStamp } from "@/lib/bot-activity-office";

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
type TimelineEntry = {
  id: string;
  bot: string;
  icon: BotIcon;
  when: string;
  text: string;
  at: string;
  postedAt?: string;
};
type Work = {
  id: string;
  bot: string;
  icon: BotIcon;
  title: string;
  detail: string;
  state: "progress" | "blocked" | "done";
  when: string;
  at: string;
  updatedAt?: string;
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

function BotName({ name }: { name: string }) {
  const href = grokBotHref(name);
  if (!href) return <span className="ba-bot">{name}</span>;
  return (
    <a className="ba-bot-link" href={href}>
      {name}
    </a>
  );
}

function WaitingColumn({
  board,
  botFilter,
  busy,
  now,
  onDismiss,
}: {
  board: Board;
  botFilter: string;
  busy: string;
  now: number;
  onDismiss: (item: Waiting) => void;
}) {
  const items = board.waiting.filter((item) => botFilter === "All bots" || item.bot === botFilter);
  return (
    <section className="ba-col ba-needs" aria-label="Needs you">
      <div className="ba-col-head">
        <h2 className="h2">Needs you</h2>
        <span className="muted">{items.length}</span>
      </div>
      {items.length === 0 ? <p className="muted">Nothing is waiting on you.</p> : null}
      <div className="ba-stack">
        {items.map((item) => {
          const href = item.chatHref || grokBotHref(item.bot);
          return (
            <article key={item.id} className="ba-card ba-bubble ba-wait-card">
              <div className="ba-bot-row">
                <BotName name={item.bot} />
                <span className="ba-bot-side">
                  <Icon k={item.icon} />
                </span>
              </div>
              <p className="ba-title">{item.title}</p>
              {item.detail ? <p className="ba-detail">{item.detail}</p> : null}
              {isUntouchedSeed(item) && !rowCountsLive(item, now) ? (
                <p className="ba-old">Old request · Not updated since {timelineStamp(item.at, now)}</p>
              ) : null}
              <div className="ba-wait-actions">
                {href ? (
                  <a className="btn ba-open-chat" href={href}>
                    Open chat
                  </a>
                ) : null}
                <button
                  type="button"
                  className="ba-dismiss"
                  onClick={() => onDismiss(item)}
                  disabled={busy === item.id}
                >
                  Dismiss
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}


function WorkCard({ item, now }: { item: Work; now: number }) {
  const seeded = isUntouchedSeed(item);
  return (
    <article className="ba-card">
      <div className="ba-bot-row">
        <BotName name={item.bot} />
        <span className="ba-bot-side">
          <span className={`ba-state ba-state-${item.state}`}>{stateLabel(item.state)}</span>
          <Icon k={item.icon} />
        </span>
      </div>
      <p className="ba-title">{item.title}</p>
      <p className="ba-detail">{item.detail}</p>
      <p className="ba-when">{seeded ? `Not updated since ${timelineStamp(item.at, now)}` : timelineStamp(item.at, now)}</p>
    </article>
  );
}

export default function BotActivityPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [stamp, setStamp] = useState("Live · Updated …");
  const [botFilter, setBotFilter] = useState("All bots");
  const [workView, setWorkView] = useState<"All" | "In progress" | "Finished">("All");
  const [lens, setLens] = useState<CenterLens>("all");
  const [tab, setTab] = useState<"needs" | "timeline" | "work">("needs");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [celebrating, setCelebrating] = useState<string[]>([]);
  const busyRef = useRef(busy);
  const epochRef = useRef(0);
  const prevBoard = useRef<Board | null>(null);
  const celebrateTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (!board) return;
    const prev = prevBoard.current;
    const lines = board.timeline.flatMap((day) => day.entries);
    const prevLines = prev ? prev.timeline.flatMap((day) => day.entries) : [];
    const names = finishedBots(
      prev ? { work: prev.work, lines: prevLines } : null,
      { work: board.work, lines },
      Date.now()
    );
    prevBoard.current = board;
    if (!names.length) return;
    setCelebrating(names);
    if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = window.setTimeout(() => setCelebrating([]), 1600);
  }, [board]);

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

  function focusLens(next: CenterLens) {
    const resolved = lens === next ? "all" : next;
    setLens(resolved);
    if (resolved === "pending") setTab("needs");
    if (resolved === "paused") setTab("work");
    const target = resolved === "running" ? "ba-cards" : resolved === "all" ? "" : "ba-lists";
    if (!target) return;
    window.requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  useEffect(() => {
    return () => {
      if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
    };
  }, []);

  return (
    <main className="container container-wide ba-page stark">
      {error ? <p className="error">{error}</p> : null}
      {!board && !error ? <p className="muted">Loading…</p> : null}

      {board ? (
        <>
          <CommandCenter
            bots={board.bots}
            waiting={board.waiting}
            work={board.work}
            lines={board.timeline.flatMap((day) => day.entries)}
            now={now}
            stamp={stamp}
            refreshFailed={refreshFailed}
            botFilter={botFilter}
            botNames={botNames}
            lens={lens}
            celebrating={new Set(celebrating)}
            busy={busy}
            expanded={expanded}
            onFilter={setBotFilter}
            onLens={focusLens}
            onExpanded={setExpanded}
            onDismiss={onDismiss}
          />
          <section id="ba-lists" ref={listRef} className="ba-lower ba-board">
            <div className="ba-tabs" role="tablist" aria-label="Activity lists">
              {(
                [
                  ["needs", "Needs you"],
                  ["timeline", "Timeline"],
                  ["work", "Work"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={`ba-tab ${tab === id ? "is-on" : ""}`}
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "needs" ? (
              <WaitingColumn board={board} botFilter={botFilter} busy={busy} now={now} onDismiss={onDismiss} />
            ) : null}
            {tab === "timeline" ? (
            <section className="ba-col ba-timeline">
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
                          <BotName name={entry.bot} />
                          <span className="ba-bot-side">
                            <span className="ba-when">
                              {isUntouchedSeed(entry)
                                ? `Not updated since ${timelineStamp(entry.at, now)}`
                                : timelineStamp(entry.at, now)}
                            </span>
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
            ) : null}
            {tab === "work" ? (
            <section className="ba-col ba-work">
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
                    <WorkCard key={item.id} item={item} now={now} />
                  ))}
                </div>
              ) : null}
              {showDone ? (
                <div className="ba-stack">
                  <div className="ba-day-label">Finished ({finished.length})</div>
                  {finished.length === 0 ? <p className="muted">Nothing finished.</p> : null}
                  {finished.map((item) => (
                    <WorkCard key={item.id} item={item} now={now} />
                  ))}
                </div>
              ) : null}
            </section>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
