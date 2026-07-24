"use client";

import { useEffect, useState } from "react";
import { Avatar } from "../Avatar";
import { avatarFor } from "@/lib/team";

type Checkin = { id: string; person: string; month: string; score: number; note: string };
type Member = { slug: string; label: string };

const FACES = ["😞", "😕", "😐", "🙂", "😄"];
const SCORE_LABEL = ["", "Struggling", "Rough", "Okay", "Good", "Great"];

export function SentimentSection({ isAdmin, person }: { isAdmin: boolean; person: string | null }) {
  const [month, setMonth] = useState("");
  const [mine, setMine] = useState<Checkin | null>(null);
  const [all, setAll] = useState<Checkin[] | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [score, setScore] = useState(0);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/hub/sentiment");
    if (res.ok) {
      const d = await res.json();
      setMonth(d.month);
      setMine(d.mine);
      setAll(d.all);
      if (d.mine) { setScore(d.mine.score); setNote(d.mine.note); }
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
    fetch("/api/team").then((r) => (r.ok ? r.json() : { team: [] })).then((d) => setTeam(d.team || []));
  }, []);

  async function submit() {
    if (!score) return;
    await fetch("/api/hub/sentiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, note }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    load();
  }

  const label = (slug: string) => team.find((m) => m.slug === slug)?.label || slug;
  const monthLabel = month
    ? new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";
  const avg = all && all.length ? (all.reduce((s, c) => s + c.score, 0) / all.length).toFixed(1) : null;

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 22 }}>
      {person ? (
        <div className="acct-section">
          <div className="acct-section-head"><h2 className="acct-section-title">Your check-in · {monthLabel}</h2>
            {saved ? <span className="muted" style={{ fontSize: 12 }}>Saved.</span> : null}
          </div>
          <div className="card card-pad stack" style={{ gap: 14 }}>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>How&apos;s work feeling this month? Honest read, only admins see it.</p>
            <div className="senti-faces">
              {FACES.map((f, i) => (
                <button
                  key={i}
                  className={`senti-face ${score === i + 1 ? "is-on" : ""}`}
                  onClick={() => setScore(i + 1)}
                  title={SCORE_LABEL[i + 1]}
                  type="button"
                >
                  <span>{f}</span>
                  <small>{SCORE_LABEL[i + 1]}</small>
                </button>
              ))}
            </div>
            <textarea rows={3} placeholder="Anything you want to add? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={submit} disabled={!score}>{mine ? "Update check-in" : "Submit check-in"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="acct-section">
          <div className="acct-section-head">
            <h2 className="acct-section-title">Team pulse · {monthLabel}</h2>
            {avg ? <span className="muted" style={{ fontSize: 13 }}>Avg {avg}/5 · {all!.length} in</span> : null}
          </div>
          {!all || all.length === 0 ? (
            <div className="empty"><p>No check-ins yet this month.</p></div>
          ) : (
            <div className="card card-pad stack" style={{ gap: 12 }}>
              {all.map((c) => (
                <div key={c.id} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <Avatar label={label(c.person)} src={avatarFor(c.person)} size={28} />
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 14 }}>{label(c.person)}</strong>
                      <span title={SCORE_LABEL[c.score]}>{FACES[c.score - 1]} {SCORE_LABEL[c.score]}</span>
                    </div>
                    {c.note ? <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>{c.note}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
