"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BotIcon } from "@/lib/bot-activity-icons";

type Reply = { id: string; body: string; at: string; when: string };
type Waiting = {
  id: string;
  bot: string;
  icon: BotIcon;
  chatHref: string | null;
  title: string;
  detail: string;
  when: string;
  replies: Reply[];
};
type TimelineEntry = { id: string; bot: string; icon: BotIcon; when: string; text: string };
type Work = {
  id: string;
  bot: string;
  icon: BotIcon;
  title: string;
  detail: string;
  state: "progress" | "blocked" | "done";
  when: string;
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

export default function BotActivityPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [botFilter, setBotFilter] = useState("All bots");
  const [workView, setWorkView] = useState<"All" | "In progress" | "Finished">("All");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");

  useEffect(() => {
    let on = true;
    fetch("/api/admin/bot-activity")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (res.status === 403) {
          router.push("/admin/hub");
          return null;
        }
        if (!res.ok) throw new Error("load");
        return res.json() as Promise<Board>;
      })
      .then((data) => {
        if (on && data) setBoard(data);
      })
      .catch(() => {
        if (on) setError("Could not load bot activity.");
      });
    return () => {
      on = false;
    };
  }, [router]);

  const botNames = useMemo(() => {
    const names = (board?.bots || []).map((bot) => bot.name);
    names.sort((a, b) => a.localeCompare(b));
    return ["All bots", ...names];
  }, [board]);

  const match = (bot: string) => botFilter === "All bots" || bot === botFilter;

  const waiting = (board?.waiting || []).filter((item) => match(item.bot));
  const timeline = (board?.timeline || [])
    .map((day) => ({ ...day, entries: day.entries.filter((entry) => match(entry.bot)) }))
    .filter((day) => day.entries.length > 0);
  const timelineCount = timeline.reduce((n, day) => n + day.entries.length, 0);
  const inProgress = (board?.work || []).filter((item) => item.state !== "done" && match(item.bot));
  const finished = (board?.work || []).filter((item) => item.state === "done" && match(item.bot));
  const showProgress = workView === "All" || workView === "In progress";
  const showDone = workView === "All" || workView === "Finished";

  async function reply(item: Waiting) {
    const body = (drafts[item.id] || "").trim();
    if (!body || busy) return;
    setBusy(item.id);
    setError("");
    try {
      const res = await fetch("/api/admin/bot-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", id: item.id, body }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        router.push("/admin/hub");
        return;
      }
      if (!res.ok) {
        setError("Could not save that reply.");
        return;
      }
      const data = (await res.json()) as { reply: Reply };
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
  }

  async function dismiss(item: Waiting) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      const res = await fetch("/api/admin/bot-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", id: item.id }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        router.push("/admin/hub");
        return;
      }
      if (!res.ok) {
        setError("Could not dismiss that item.");
        return;
      }
      setBoard((current) =>
        current
          ? { ...current, waiting: current.waiting.filter((row) => row.id !== item.id) }
          : current
      );
    } catch {
      setError("Could not dismiss that item.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="container container-wide ba-page">
      <div className="ba-head">
        <div>
          <h1 className="h1">Bot Activity</h1>
          <p className="muted ba-updated">
            {board ? `Updated ${board.updated}.` : "Updated …"}
          </p>
        </div>
        <div className="field ba-filter">
          <label htmlFor="ba-bot">Bot</label>
          <select
            id="ba-bot"
            value={botFilter}
            onChange={(event) => setBotFilter(event.target.value)}
          >
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
        <div className="ba-grid">
          <section className="ba-col">
            <div className="ba-col-head">
              <h2 className="h2">Waiting on you</h2>
              <span className="muted">{waiting.length}</span>
            </div>
            <div className="ba-stack">
              {waiting.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
              {waiting.map((item) => (
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
                        onClick={() => dismiss(item)}
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
                      void reply(item);
                    }}
                  >
                    <label className="field">
                      <span className="ba-reply-label">Reply</span>
                      <textarea
                        rows={2}
                        value={drafts[item.id] || ""}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                        }
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
      ) : null}
    </main>
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
