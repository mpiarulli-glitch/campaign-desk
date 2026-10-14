"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DailyNote } from "@/components/hub/DailyNote";
import { AssignTodoPanel } from "@/components/AssignTodoPanel";
import { currentWeek } from "@/lib/week";

type Section = "resources" | "sops" | "training" | "sentiment";
type Sop = { id: string; title: string; category: string };
type Post = { id: string; title: string; kind: string; created_at: string };
type Course = { id: string; slug: string; title: string; kind: string; lesson_count: number };
type Checkin = { person: string; score: number };

const FACES = ["😞", "😕", "😐", "🙂", "😄"];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const ICONS: Record<string, React.ReactNode> = {
  todo: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  res: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  sop: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  train: <><path d="M12 2L2 7l10 5 10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></>,
  senti: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
};
function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

type DeckTarget =
  | { label: string; href: string; keys: string[] }
  | { label: string; section: Section; keys: string[] };

const DECK_TARGETS: DeckTarget[] = [
  { label: "Forecast", href: "/admin/forecast", keys: ["forecast", "hours", "capacity"] },
  { label: "Lifecycle", href: "/admin/lifecycle", keys: ["lifecycle", "clients", "accounts"] },
  { label: "Production", href: "/admin/production", keys: ["production", "shoot", "shoots"] },
  { label: "Campaigns", href: "/admin/campaigns", keys: ["campaign", "campaigns", "reviews"] },
  { label: "Onboarding", href: "/admin/onboarding", keys: ["onboarding", "new client"] },
  { label: "Calendar", href: "/admin/calendar", keys: ["calendar", "sends"] },
  { label: "Whiteboard", href: "/admin/whiteboard", keys: ["whiteboard", "board"] },
  { label: "Weekly Snapshots", href: "/admin/snapshot/desk", keys: ["snapshot", "snapshots", "weekly"] },
  { label: "SOPs", section: "sops", keys: ["sop", "sops"] },
  { label: "Training", section: "training", keys: ["training", "course", "courses"] },
  { label: "Team pulse", section: "sentiment", keys: ["pulse", "sentiment", "mood"] },
  { label: "Resources", section: "resources", keys: ["resources", "docs", "files"] },
];

const QUICK = DECK_TARGETS.filter((t) => "href" in t).slice(0, 4);

function matchTarget(raw: string): DeckTarget | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  return (
    DECK_TARGETS.find((t) => t.keys.some((k) => q === k || q.includes(k))) || null
  );
}

function usePacificClock(): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      setLabel(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Los_Angeles",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date())
      );
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return label;
}

export function HubHome({
  onOpen,
  isAdmin,
  person,
}: {
  onOpen: (s: Section) => void;
  isAdmin: boolean;
  person: string | null;
}) {
  const router = useRouter();
  const clock = usePacificClock();
  const [command, setCommand] = useState("");
  const [reply, setReply] = useState("");
  const [running, setRunning] = useState(false);
  const [teamPct, setTeamPct] = useState<number | null>(null);
  const [sops, setSops] = useState<Sop[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/hub/sops").then((r) => (r.ok ? r.json() : { sops: [] })).then((d) => setSops(d.sops || []));
    fetch("/api/hub/training").then((r) => (r.ok ? r.json() : { posts: [] })).then((d) => setPosts(d.posts || []));
    fetch("/api/hub/courses").then((r) => (r.ok ? r.json() : { courses: [] })).then((d) => setCourses(d.courses || []));
    fetch("/api/hub/sentiment")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { all?: Checkin[] | null; mine?: { score: number } | null }) => {
        setCheckins(d.all ?? null);
        setMyScore(d.mine?.score ?? null);
      });
    if (!isAdmin) return;
    fetch(`/api/forecast?week=${currentWeek()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { people?: Array<{ hours: number; capacity: number }> } | null) => {
        const people = d?.people || [];
        const hours = people.reduce((sum, p) => sum + (p.hours || 0), 0);
        const capacity = people.reduce((sum, p) => sum + (p.capacity || 0), 0);
        setTeamPct(capacity ? Math.round((hours / capacity) * 100) : null);
      })
      .catch(() => setTeamPct(null));
  }, [isAdmin]);

  const pulseAvg = checkins && checkins.length ? checkins.reduce((s, c) => s + c.score, 0) / checkins.length : null;
  const latestPost = posts[0] || null;
  const featuredCourse = courses[0] || null;
  const courseCount = courses.length;

  const firstName = person ? person.split("_")[0].replace(/^\w/, (c) => c.toUpperCase()) : null;

  const briefing = useMemo(() => {
    const who = firstName || "there";
    const bits = [`${greeting()}, ${who}. The house is online.`];
    if (teamPct != null) bits.push(`The team is ${teamPct}% forecasted this week.`);
    if (pulseAvg != null && checkins) {
      bits.push(
        `Pulse is ${pulseAvg.toFixed(1)} from ${checkins.length} check-in${checkins.length === 1 ? "" : "s"}.`
      );
    } else if (myScore != null) {
      bits.push(`Your pulse this month is ${myScore}.`);
    }
    if (sops.length) bits.push(`${sops.length} SOP${sops.length === 1 ? "" : "s"} on file.`);
    bits.push("Name a system, or a client, and I'll open it.");
    return bits.join(" ");
  }, [firstName, teamPct, pulseAvg, checkins, myScore, sops.length]);

  function openTarget(target: DeckTarget) {
    setReply(`Opening ${target.label}.`);
    if ("href" in target) router.push(target.href);
    else onOpen(target.section);
  }

  async function runCommand(e: React.FormEvent) {
    e.preventDefault();
    const raw = command.trim();
    if (!raw || running) return;
    const target = matchTarget(raw);
    if (target) {
      openTarget(target);
      return;
    }
    setRunning(true);
    setReply("Looking.");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      const data = res.ok ? await res.json() : { hits: [] };
      const hit = (data.hits || [])[0] as { title?: string; href?: string } | undefined;
      if (hit?.href && hit.title) {
        setReply(`Opening ${hit.title}.`);
        router.push(hit.href);
        return;
      }
      setReply("Nothing by that name. Try forecast, lifecycle, production, or a client.");
    } catch {
      setReply("I couldn't reach search. Try one of the systems below.");
    } finally {
      setRunning(false);
    }
  }

  const coreRead = pulseAvg != null ? pulseAvg.toFixed(1) : teamPct != null ? `${teamPct}%` : "ON";
  const coreLabel = pulseAvg != null ? "pulse" : teamPct != null ? "forecast" : "online";

  return (
    <div className="deck">
      <div className="deck-top">
        <div className="deck-brief">
          <p className="deck-kicker">
            <span className="deck-live" aria-hidden />
            Marketing Empire · Command
            {clock ? <span className="deck-clock">{clock} PT</span> : null}
          </p>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ""}.</h1>
          <p>{briefing}</p>
          <form className="deck-command" onSubmit={(e) => void runCommand(e)}>
            <label htmlFor="deck-command">Command</label>
            <div className="deck-command-row">
              <input
                id="deck-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Forecast, lifecycle, Swing Inn…"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" disabled={running || !command.trim()}>
                {running ? "…" : "Open"}
              </button>
            </div>
          </form>
          {reply ? <p className="deck-reply" role="status">{reply}</p> : null}
          <div className="deck-quick">
            {QUICK.map((t) => (
              <button key={t.label} type="button" onClick={() => openTarget(t)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="deck-core" aria-hidden="true">
          <span className="deck-ring r1" />
          <span className="deck-ring r2" />
          <span className="deck-ring r3" />
          <span className="deck-core-read">
            <b>{coreRead}</b>
            <span>{coreLabel}</span>
          </span>
        </div>
      </div>

      <div className="hq-bento">
        <DailyNote />

        {isAdmin ? (
          <div className="hq-assign span2">
            <AssignTodoPanel />
          </div>
        ) : null}

        {/* RESOURCES */}
        <div className="hq-card t-res" style={{ cursor: "default" }}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="res" /></span>
            <div><h3 className="hq-card-title">Resources</h3><p className="hq-card-desc">Forecasts · Docs · Files</p></div>
          </div>
          <div className="hq-res">
            <Link href="/admin/forecast">📊 Forecasts <span className="rgo">→</span></Link>
            <button onClick={() => onOpen("resources")}>📄 Docs & Files <span className="rgo">→</span></button>
          </div>
        </div>

        {/* SOPS */}
        <button className="hq-card t-sop" onClick={() => onOpen("sops")}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="sop" /></span>
            <div><h3 className="hq-card-title">SOPs</h3><p className="hq-card-desc">How we do things</p></div>
            <span className="hq-arrow">→</span>
          </div>
          <div className="hq-divider" />
          {sops.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No SOPs yet.</p>
          ) : (
            sops.slice(0, 3).map((s) => (
              <div key={s.id} className="hq-mini"><span className="hq-tag">{s.category || "General"}</span>{s.title}</div>
            ))
          )}
        </button>

        {/* TRAINING */}
        <button className="hq-card t-train" onClick={() => onOpen("training")}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="train" /></span>
            <div><h3 className="hq-card-title">Training</h3><p className="hq-card-desc">Courses, marketing & AI</p></div>
            <span className="hq-arrow">→</span>
          </div>
          <div className="hq-divider" />
          {featuredCourse ? (
            <>
              <span className="hq-tag" style={{ alignSelf: "flex-start" }}>Course</span>
              <p style={{ margin: "9px 0 2px", fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{featuredCourse.title}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {featuredCourse.lesson_count} lesson{featuredCourse.lesson_count === 1 ? "" : "s"}
                {courseCount > 1 ? ` · ${courseCount} courses` : ""}
              </p>
            </>
          ) : latestPost ? (
            <>
              <span className="hq-tag" style={{ alignSelf: "flex-start" }}>{latestPost.kind === "ai" ? "AI" : "Marketing"}</span>
              <p style={{ margin: "9px 0 0", fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{latestPost.title}</p>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Nothing posted yet.</p>
          )}
        </button>

        {/* SENTIMENT */}
        <button className="hq-card t-senti" onClick={() => onOpen("sentiment")}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="senti" /></span>
            <div><h3 className="hq-card-title">Team Pulse</h3><p className="hq-card-desc">This month&apos;s check-in</p></div>
            <span className="hq-arrow">→</span>
          </div>
          <div className="hq-divider" />
          {isAdmin && pulseAvg != null ? (
            <div className="hq-senti-row">
              <div className="hq-ring">
                <svg width="74" height="74">
                  <circle cx="37" cy="37" r="31" fill="none" stroke="var(--border)" strokeWidth="6" />
                  <circle cx="37" cy="37" r="31" fill="none" stroke="#c25d8a" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 31}
                    strokeDashoffset={2 * Math.PI * 31 * (1 - pulseAvg / 5)} />
                </svg>
                <div className="val">{pulseAvg.toFixed(1)}</div>
              </div>
              <div>
                <div className="muted">{checkins!.length} checked in</div>
                <div className="hq-faces">{FACES.map((f, i) => <span key={i} className={Math.round(pulseAvg) === i + 1 ? "on" : ""}>{f}</span>)}</div>
              </div>
            </div>
          ) : myScore != null ? (
            <div className="hq-senti-row">
              <div className="hq-faces" style={{ marginTop: 0 }}>{FACES.map((f, i) => <span key={i} className={myScore === i + 1 ? "on" : ""}>{f}</span>)}</div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>You haven&apos;t checked in this month. Tap to share how it&apos;s going.</p>
          )}
        </button>

      </div>
    </div>
  );
}
