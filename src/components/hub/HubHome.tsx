"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "../Avatar";
import { avatarFor } from "@/lib/team";

type Section = "chat" | "resources" | "sops" | "training" | "sentiment" | "hr";
type Member = { slug: string; label: string };
type Msg = { id: string; author_name: string; author_slug: string; is_client: number; body: string; created_at: string };
type Sop = { id: string; title: string; category: string };
type Post = { id: string; title: string; kind: string; created_at: string };
type Course = { id: string; slug: string; title: string; kind: string; lesson_count: number };
type Checkin = { person: string; score: number };

const FACES = ["😞", "😕", "😐", "🙂", "😄"];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function timeLabel(iso: string): string {
  const d = new Date();
  const t = new Date(iso);
  return t.toDateString() === d.toDateString()
    ? t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Highlight @mentions of known members in a preview line.
function withMentions(body: string, labels: string[]) {
  if (!labels.length) return body;
  const esc = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${esc.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<span key={i++} className="men">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

const ICONS: Record<string, React.ReactNode> = {
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  todo: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  res: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  sop: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  train: <><path d="M12 2L2 7l10 5 10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></>,
  senti: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
  hr: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
};
function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
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
  const [team, setTeam] = useState<Member[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sops, setSops] = useState<Sop[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [hrOpen, setHrOpen] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/team").then((r) => (r.ok ? r.json() : { team: [] })).then((d) => setTeam(d.team || []));
    fetch("/api/chat?room=team").then((r) => (r.ok ? r.json() : { messages: [] })).then((d) => setMsgs(d.messages || []));
    fetch("/api/hub/sops").then((r) => (r.ok ? r.json() : { sops: [] })).then((d) => setSops(d.sops || []));
    fetch("/api/hub/training").then((r) => (r.ok ? r.json() : { posts: [] })).then((d) => setPosts(d.posts || []));
    fetch("/api/hub/courses").then((r) => (r.ok ? r.json() : { courses: [] })).then((d) => setCourses(d.courses || []));
    fetch("/api/hub/sentiment")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { all?: Checkin[] | null; mine?: { score: number } | null }) => {
        setCheckins(d.all ?? null);
        setMyScore(d.mine?.score ?? null);
      });
    if (isAdmin) {
      fetch("/api/hub/hr").then((r) => (r.ok ? r.json() : { issues: [] })).then((d) =>
        setHrOpen((d.issues || []).filter((i: { status: string }) => i.status === "open").length)
      );
    }
  }, [isAdmin]);

  const labels = team.map((m) => m.label);

  const msgsToday = msgs.filter((m) => isToday(m.created_at)).length;
  const recentMsgs = msgs.slice(-3);


  const pulseAvg = checkins && checkins.length ? checkins.reduce((s, c) => s + c.score, 0) / checkins.length : null;
  const latestPost = posts[0] || null;
  const featuredCourse = courses[0] || null;
  const courseCount = courses.length;

  const firstName = person ? person.split("_")[0].replace(/^\w/, (c) => c.toUpperCase()) : null;

  return (
    <div>
      <div className="hq-hero">
        <p className="ops-eyebrow">Team HQ</p>
        <h1>{greeting()}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>
          The team&apos;s home base.{" "}
          {msgsToday > 0 ? <><b>{msgsToday} message{msgsToday === 1 ? "" : "s"}</b> today</> : null}
          {pulseAvg != null ? <>{msgsToday > 0 ? ", and" : ""} this month&apos;s pulse sits at <b>{pulseAvg.toFixed(1)}</b>.</> : "."}
        </p>
      </div>

      <div className="hq-pulse">
        <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#04808d" }} /><span className="n">{msgsToday}</span><span className="l">messages today</span></div>
        <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#c25d8a" }} /><span className="n">{pulseAvg != null ? pulseAvg.toFixed(1) : myScore != null ? myScore : "—"}</span><span className="l">team pulse</span></div>
        {isAdmin ? <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#5a6b7b" }} /><span className="n">{hrOpen ?? 0}</span><span className="l">HR open</span></div> : null}
      </div>

      <div className="hq-bento">
        {/* CHAT */}
        <button className="hq-card t-chat span2 tall" onClick={() => onOpen("chat")}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="chat" /></span>
            <div><h3 className="hq-card-title">Team Chat</h3><p className="hq-card-desc">The whole team, one thread</p></div>
            <span className="hq-arrow">→</span>
          </div>
          <div className="hq-divider" />
          {recentMsgs.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No messages yet. Start the thread.</p>
          ) : (
            recentMsgs.map((m) => (
              <div key={m.id} className="hq-msg">
                <Avatar label={m.author_name} src={m.is_client ? null : avatarFor(m.author_slug)} size={30} />
                <div className="body">
                  <div className="who">{m.author_name}</div>
                  <div className="txt">{withMentions(m.body, labels)}</div>
                </div>
                <span className="t">{timeLabel(m.created_at)}</span>
              </div>
            ))
          )}
          <div className="hq-chat-foot">Message the team…</div>
        </button>

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

        {/* HR */}
        <button className="hq-card t-hr" onClick={() => onOpen("hr")}>
          <div className="hq-card-head">
            <span className="hq-icon"><Icon name="hr" /></span>
            <div><h3 className="hq-card-title">HR</h3><p className="hq-card-desc">Raise something, privately</p></div>
          </div>
          <div className="hq-divider" />
          <p className="muted" style={{ margin: "0 0 14px" }}>
            {isAdmin && hrOpen != null && hrOpen > 0
              ? `${hrOpen} open issue${hrOpen === 1 ? "" : "s"} to review.`
              : "Escalate a concern or question. Anonymous if you want."}
          </p>
          <span className="hq-cta">{isAdmin ? "Review issues" : "Raise an issue"}</span>
        </button>
      </div>
    </div>
  );
}
