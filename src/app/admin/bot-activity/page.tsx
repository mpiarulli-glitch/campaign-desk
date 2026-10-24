"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BotIcon } from "@/lib/bot-activity-icons";
import {
  BotActivityRefresh,
  authRedirectForStatus,
  botPortraitSrc,
  currentAssignment,
  fetchedLabel,
  nextBoardState,
  retainReplyDrafts,
  statusForBot,
  timeAgo,
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

const NeedsYou = memo(function NeedsYou({
  items,
  drafts,
  busy,
  onDraft,
  onReply,
  onDismiss,
}: {
  items: Waiting[];
  drafts: Record<string, string>;
  busy: string;
  onDraft: (id: string, value: string) => void;
  onReply: (item: Waiting) => void;
  onDismiss: (item: Waiting) => void;
}) {
  return (
    <section className="ba-needs" aria-label="Needs you">
      <div className="ba-col-head">
        <h2 className="h2">Needs you</h2>
        <span className="muted">{items.length}</span>
      </div>
      {items.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
      <div className="ba-needs-row">
        {items.map((item) => (
          <article key={item.id} className="ba-card">
            <div className="ba-bot-row">
              {item.chatHref ? (
                <a className="ba-bot-link" href={item.chatHref}>
                  {item.bot} · reply in chat
                </a>
              ) : (
                <span className="ba-bot">{item.bot}</span>
              )}
              <span className="ba-bot-side">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDismiss(item)}
                  disabled={busy === item.id}
                >
                  Dismiss
                </button>
                <Icon k={item.icon} />
              </span>
            </div>
            <p className="ba-title">{item.title}</p>
            <p className="ba-detail">{item.detail}</p>
            <p className="ba-when">{item.when}</p>
            {item.replies.map((saved) => (
              <div key={saved.id} className="ba-reply">
                <p className="ba-reply-body">{saved.body}</p>
                <p className="ba-when">{saved.when}</p>
              </div>
            ))}
            <form
              className="ba-reply-form"
              onSubmit={(event) => {
                event.preventDefault();
                onReply(item);
              }}
            >
              <label className="field">
                <span className="ba-reply-label">Reply</span>
                <textarea
                  rows={2}
                  value={drafts[item.id] || ""}
                  onChange={(event) => onDraft(item.id, event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="btn btn-sm"
                disabled={busy === item.id || !(drafts[item.id] || "").trim()}
              >
                Save / Send
              </button>
            </form>
          </article>
        ))}
      </div>
    </section>
  );
});

function TeamGrid({
  board,
  botFilter,
  now,
  onPick,
}: {
  board: Board;
  botFilter: string;
  now: number;
  onPick: (name: string) => void;
}) {
  const lines = board.timeline.flatMap((day) => day.entries);
  return (
    <section className="ba-team" aria-label="Team">
      <div className="ba-col-head">
        <h2 className="h2">Team</h2>
        <span className="muted">{board.bots.length}</span>
      </div>
      <div className="ba-team-grid">
        {board.bots.map((bot) => {
          const status = statusForBot(bot.name, board.waiting, board.work);
          const task = currentAssignment(bot.name, board.work, lines);
          const ago = task ? timeAgo(task.at, now) : "";
          return (
            <button
              key={bot.name}
              type="button"
              className={`ba-member ${botFilter === bot.name ? "is-on" : ""}`}
              aria-pressed={botFilter === bot.name}
              onClick={() => onPick(bot.name)}
            >
              <span className="ba-member-top">
                <BotPortrait name={bot.name} icon={bot.icon} />
                <span className="ba-member-id">
                  <span className="ba-member-name">{bot.name}</span>
                  <StatusChip status={status} />
                </span>
              </span>
              {task ? (
                <>
                  <p className="ba-task-title">{task.title}</p>
                  {task.detail ? <p className="ba-task-detail">{task.detail}</p> : null}
                  {ago ? <p className="ba-ago">{ago}</p> : null}
                </>
              ) : (
                <p className="ba-task-detail">Nothing running.</p>
              )}
            </button>
          );
        })}
      </div>
    </section>
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

  const waiting = useMemo(() => {
    if (!board) return [];
    if (botFilter === "All bots") return board.waiting;
    return board.waiting.filter((item) => item.bot === botFilter);
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
          <NeedsYou
            items={waiting}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onReply={onReply}
            onDismiss={onDismiss}
          />
          <TeamGrid board={board} botFilter={botFilter} now={now} onPick={setBotFilter} />
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
