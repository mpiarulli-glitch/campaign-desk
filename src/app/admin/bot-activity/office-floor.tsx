"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { grokBotHref, type BotIcon } from "@/lib/bot-activity-icons";
import {
  botHoverSummary,
  botPortraitSrc,
  doingTitle,
  forElapsed,
  heardLabel,
  isUntouchedSeed,
  type TeamStatus,
} from "@/lib/bot-activity-live";
import { countFloor, floorSummary, needsAttention, propForTask, type PropKind } from "@/lib/bot-activity-office";

export type FloorPose = "desk" | "away" | "celebrate" | "return";

type Waiting = {
  id: string;
  bot: string;
  title: string;
  detail: string;
  at: string;
  updatedAt?: string;
  chatHref: string | null;
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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function PropIcon({ kind }: { kind: PropKind }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let shape = (
    <g {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </g>
  );
  if (kind === "envelope") {
    shape = (
      <g {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 8l9 6 9-6" />
      </g>
    );
  } else if (kind === "flow") {
    shape = (
      <g {...common}>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h6a3 3 0 0 1 3 3v7" />
      </g>
    );
  } else if (kind === "clipboard") {
    shape = (
      <g {...common}>
        <rect x="7" y="4" width="10" height="16" rx="2" />
        <path d="M10 4V3h4v1M10 11h4M10 15h3" />
      </g>
    );
  } else if (kind === "globe") {
    shape = (
      <g {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16M12 4c2.5 2.8 2.5 13.2 0 16M12 4c-2.5 2.8-2.5 13.2 0 16" />
      </g>
    );
  } else if (kind === "search") {
    shape = (
      <g {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="M16 16l4 4" />
      </g>
    );
  }
  return (
    <svg className="ba-prop" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      {shape}
    </svg>
  );
}

function TokenFace({ name, icon }: { name: string; icon: BotIcon }) {
  const [showIcon, setShowIcon] = useState(false);
  return (
    <span className="ba-avatar ba-token-face">
      {showIcon ? (
        <span className="ba-token-fallback" aria-hidden="true">
          {icon.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={botPortraitSrc(name)} alt={name} width={44} height={44} onError={() => setShowIcon(true)} />
      )}
    </span>
  );
}

export function OfficeFloor({
  bots,
  waiting,
  work,
  lines,
  now,
  fly,
  celebrating,
  returning,
}: {
  bots: Bot[];
  waiting: Waiting[];
  work: Work[];
  lines: Line[];
  now: number;
  fly: ReadonlySet<string>;
  celebrating: ReadonlySet<string>;
  returning: ReadonlySet<string>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [shifts, setShifts] = useState<Record<string, { x: number; y: number }>>({});
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState("");
  const reduced = useReducedMotion();
  const counts = countFloor(
    bots.map((bot) => bot.name),
    waiting,
    work,
    lines,
    now
  );
  const visitors = bots.filter((bot) => fly.has(bot.name));

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function measure() {
      const root = stageRef.current;
      if (!root) return;
      const next: Record<string, { x: number; y: number }> = {};
      for (const slot of root.querySelectorAll<HTMLElement>("[data-slot]")) {
        const name = slot.dataset.slot || "";
        const pad = root.querySelector<HTMLElement>(`[data-pad="${CSS.escape(name)}"]`);
        if (!pad) continue;
        const from = slot.getBoundingClientRect();
        const to = pad.getBoundingClientRect();
        next[name] = {
          x: Math.round(to.left + to.width / 2 - (from.left + from.width / 2)),
          y: Math.round(to.top + to.height / 2 - (from.top + from.height / 2)),
        };
      }
      setShifts((prev) => {
        const keys = Object.keys(next);
        const same =
          keys.length === Object.keys(prev).length &&
          keys.every((key) => prev[key] && prev[key].x === next[key].x && prev[key].y === next[key].y);
        return same ? prev : next;
      });
      setReady(true);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [bots, visitors.length, fly]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen("");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className={`ba-floor ${ready ? "is-ready" : ""} ${reduced ? "is-reduced" : ""}`} aria-label="Office floor">
      <p className="ba-summary">{floorSummary(counts)}</p>
      <div className="ba-stage" ref={stageRef}>
        <div className="ba-desks">
          {bots.map((bot) => {
            const summary = botHoverSummary(bot.name, waiting, work, lines, now);
            const tone = toneOf(summary.status);
            const pose = poseFor(summary.status, bot.name, fly, celebrating, returning);
            const doing = doingTitle(bot.name, work, now);
            const elapsed = summary.heartbeat ? forElapsed(summary.heartbeat, now) : "";
            const prop = propForTask(`${doing} ${summary.task?.title || ""} ${summary.task?.detail || ""}`);
            const shift = shifts[bot.name];
            const moving = pose === "away" || (pose === "celebrate" && fly.has(bot.name));
            const transform = moving && shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined;
            const href = grokBotHref(bot.name);
            const heard = heardLabel(bot.name, waiting, work, lines, now);
            const short =
              summary.status === "Working"
                ? `doing: ${doing || summary.task?.title || "a task"}${elapsed ? ` · ${elapsed}` : ""}`
                : summary.status === "Stalled"
                  ? summary.line.replace(/^Stalled: last update /, "Last update ")
                  : heard;
            return (
              <article
                key={bot.name}
                className={`ba-desk is-${tone} ${pose === "return" ? "is-return" : ""}`}
                data-bot={bot.name}
              >
                <span className="ba-monitor" aria-hidden="true">
                  {summary.status === "Working" ? <PropIcon kind={prop} /> : null}
                </span>
                <span className="ba-token-slot" data-slot={bot.name}>
                  <span
                    className={`ba-token ${moving ? "is-away" : ""} ${celebrating.has(bot.name) ? "is-celebrate" : ""} ${summary.status === "Working" ? "is-working" : ""}`}
                    style={transform ? { transform } : undefined}
                  >
                    <TokenFace name={bot.name} icon={bot.icon} />
                    {summary.status === "Working" ? (
                      <span className="ba-typing" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                    {celebrating.has(bot.name) ? <span className="ba-check" aria-hidden="true" /> : null}
                  </span>
                </span>
                {href ? (
                  <a
                    className="ba-desk-name"
                    href={href}
                    onMouseEnter={() => setOpen(bot.name)}
                    onFocus={() => setOpen(bot.name)}
                  >
                    {bot.name}
                  </a>
                ) : (
                  <span className="ba-desk-name" tabIndex={0} onFocus={() => setOpen(bot.name)}>
                    {bot.name}
                  </span>
                )}
                <p className="ba-desk-line">{short}</p>
                {summary.status === "Idle" ? <span className="ba-think" aria-hidden="true" /> : null}
                {summary.status === "Stalled" ? <span className="ba-zzz" aria-hidden="true">zzz</span> : null}
                {open === bot.name ? (
                  <div className="ba-pop" role="tooltip">
                    <p className="ba-pop-text">
                      {needsAttention(summary.status) ? summary.request : summary.line || summary.status}
                    </p>
                    <p className="ba-pop-text">{heard}</p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        <div className="ba-michael" aria-label="Michael's desk">
          <div className="ba-michael-desk">
            <span className="ba-michael-name">Michael</span>
            <span className="ba-michael-monitor" aria-hidden="true" />
          </div>
          <div className="ba-visits">
            {visitors.length === 0 ? <p className="muted ba-michael-empty">No one is waiting.</p> : null}
            {visitors.map((bot) => {
              const summary = botHoverSummary(bot.name, waiting, work, lines, now);
              const href = chatHrefFor(bot.name, waiting);
              const request = summary.request.split("\n").filter((line) => line.trim()).slice(0, 3).join("\n");
              return (
                <div key={bot.name} className="ba-visit">
                  <span className="ba-pad" data-pad={bot.name} aria-hidden="true" />
                  <div className="ba-say">
                    <p className="ba-say-name">{bot.name}</p>
                    <p className="ba-say-text">{request}</p>
                    {href ? (
                      <a className="btn ba-open-chat" href={href}>
                        Open chat
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function poseFor(
  status: TeamStatus,
  name: string,
  fly: ReadonlySet<string>,
  celebrating: ReadonlySet<string>,
  returning: ReadonlySet<string>
): FloorPose {
  if (needsAttention(status) || fly.has(name)) return celebrating.has(name) ? "celebrate" : "away";
  if (celebrating.has(name)) return "celebrate";
  if (returning.has(name)) return "return";
  return "desk";
}

function toneOf(status: TeamStatus): string {
  if (status === "Blocked") return "blocked";
  if (status === "Waiting on you") return "waiting";
  if (status === "Working") return "working";
  if (status === "Stalled") return "stalled";
  return "idle";
}

function chatHrefFor(name: string, waiting: Waiting[]): string | null {
  const row = waiting.find((item) => item.bot === name && item.chatHref);
  return row?.chatHref || grokBotHref(name);
}

export function staleWaiting(item: { id: string; at: string; updatedAt?: string }): boolean {
  return isUntouchedSeed(item);
}
