"use client";

import { useCallback, useEffect, useState } from "react";

const CHANNELS = [
  { slug: "email", label: "Email marketing" },
  { slug: "sms", label: "SMS marketing" },
  { slug: "social", label: "Social media" },
  { slug: "content", label: "Content / blog" },
  { slug: "ppc", label: "Paid ads" },
  { slug: "seo", label: "SEO" },
  { slug: "reviews", label: "Review management" },
  { slug: "automation", label: "CRM automation" },
];

type Plan = {
  thesis?: string;
  benchmarks?: string;
  kpis?: { n: string; l: string }[];
  audienceMoments?: { moment: string; meets: string }[];
  offers?: { tier: string; name: string; desc: string; color?: string }[];
  phases?: { name: string; months?: string; calls?: number; booked?: number; revenue?: string; costPerCall?: string; roi?: string }[];
  tiers?: { name: string; recommended?: boolean; media: string; calls: string; booked: string; revenue: string }[];
  channelRoles?: { name: string; role: string }[];
  rollout?: { phase: string; name: string; desc: string }[];
  lifecycleFlows?: { name: string; trigger?: string }[];
};

type Strategy = {
  positioning: string;
  audience: string;
  goals: string;
  channels: string[];
  cadence_notes: string;
  plan: Plan;
  onboarding_generated_at: string | null;
  recurring_generated_at: string | null;
};

const OFFER_COLORS: Record<string, string> = {
  repipe: "#06808d", drain: "#3f5bd6", gas: "#d64545", member: "#7a5cc4",
  teal: "#06808d", blue: "#3f5bd6", red: "#d64545", violet: "#7a5cc4", green: "#1f9d63", amber: "#b8820b",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "not yet";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ------------------------------------------------------------- chart */

function GrowthChart({ phases }: { phases: NonNullable<Plan["phases"]> }) {
  const withCalls = phases.filter((p) => typeof p.calls === "number");
  if (withCalls.length < 2) return null;
  const maxCalls = Math.max(...withCalls.map((p) => p.calls || 0));
  const top = Math.ceil(maxCalls / 50) * 50 || 50;
  const H = 210, W = 720, padL = 46, padB = 54, padT = 16;
  const plotH = H - padB - padT;
  const bandW = (W - padL) / withCalls.length;
  const y = (v: number) => padT + plotH * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Calls and booked jobs per phase">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} fontSize="11" fill="var(--text-muted)" textAnchor="end">{t}</text>
          </g>
        ))}
        {withCalls.map((p, i) => {
          const cx = padL + bandW * i + bandW / 2;
          const bw = Math.min(42, bandW / 3.2);
          const callsH = plotH * ((p.calls || 0) / top);
          const bookedH = plotH * ((p.booked || 0) / top);
          return (
            <g key={i}>
              <rect x={cx - bw - 3} y={y(p.calls || 0)} width={bw} height={callsH} rx="4" fill="#00b4c6" />
              <text x={cx - bw / 2 - 3} y={y(p.calls || 0) - 6} fontSize="13" fontWeight="700" fill="var(--text)" textAnchor="middle">{p.calls}</text>
              {typeof p.booked === "number" ? (
                <>
                  <rect x={cx + 3} y={y(p.booked)} width={bw} height={bookedH} rx="4" fill="#b8820b" />
                  <text x={cx + bw / 2 + 3} y={y(p.booked) - 6} fontSize="12" fontWeight="600" fill="#8f6300" textAnchor="middle">{p.booked}</text>
                </>
              ) : null}
              <text x={cx} y={H - 30} fontSize="12" fontWeight="600" fill="var(--text)" textAnchor="middle">{p.name}</text>
              {p.months ? <text x={cx} y={H - 14} fontSize="11" fill="var(--text-muted)" textAnchor="middle">{p.months}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="strat-legend">
        <span><i style={{ background: "#00b4c6" }} />Calls / month</span>
        <span><i style={{ background: "#b8820b" }} />Booked jobs / month</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- panel */

export function StrategyPanel({
  clientId,
  onGenerated,
}: {
  clientId: string;
  onGenerated?: () => void;
}) {
  const [s, setS] = useState<Strategy | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [genMsg, setGenMsg] = useState("");
  const [planText, setPlanText] = useState("");
  const [planErr, setPlanErr] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/strategy`);
    if (res.ok) {
      const st = (await res.json()).strategy as Strategy;
      setS(st);
      setPlanText(JSON.stringify(st.plan || {}, null, 2));
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  function set<K extends keyof Strategy>(key: K, value: Strategy[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function toggleChannel(slug: string) {
    if (!s) return;
    set("channels", s.channels.includes(slug) ? s.channels.filter((c) => c !== slug) : [...s.channels, slug]);
  }

  async function save() {
    if (!s) return;
    let plan: Plan | undefined;
    if (planText.trim()) {
      try {
        plan = JSON.parse(planText);
        setPlanErr("");
      } catch {
        setPlanErr("Plan data is not valid JSON — fix it or clear it before saving.");
        return;
      }
    } else {
      plan = {};
    }
    setSaving(true);
    setSavedMsg("");
    const res = await fetch(`/api/clients/${clientId}/strategy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positioning: s.positioning,
        audience: s.audience,
        goals: s.goals,
        channels: s.channels,
        cadenceNotes: s.cadence_notes,
        plan,
      }),
    });
    if (res.ok) {
      const st = (await res.json()).strategy as Strategy;
      setS(st);
      setPlanText(JSON.stringify(st.plan || {}, null, 2));
      setSavedMsg("Saved.");
      setEditing(false);
      setTimeout(() => setSavedMsg(""), 2500);
    }
    setSaving(false);
  }

  async function generate(type: "onboarding" | "recurring") {
    const already = type === "onboarding" ? s?.onboarding_generated_at : s?.recurring_generated_at;
    let force = false;
    if (already) {
      force = confirm(
        type === "onboarding"
          ? "Onboarding to-dos were already generated. Generate a fresh set anyway?"
          : "Recurring to-dos were already generated this period. Generate again anyway?"
      );
      if (!force) return;
    }
    setGenMsg("Generating…");
    const res = await fetch(`/api/clients/${clientId}/strategy/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, force }),
    });
    const data = await res.json();
    setGenMsg(data.skipped ? data.reason || "Already generated." : `Added ${data.created} ${type} to-do${data.created === 1 ? "" : "s"}.`);
    if (!data.skipped) onGenerated?.();
    load();
    setTimeout(() => setGenMsg(""), 4000);
  }

  if (!s) return <p className="muted">Loading…</p>;

  const plan = s.plan || {};
  const hasAnyText = s.positioning || s.audience || s.goals || s.cadence_notes;
  const isEmpty = !hasAnyText && s.channels.length === 0 && Object.keys(plan).length === 0;

  /* ----- edit mode ----- */
  if (editing) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <div className="acct-section">
          <div className="acct-section-head">
            <h2 className="acct-section-title">Edit strategy</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); load(); }}>Cancel</button>
          </div>
          <div className="card card-pad stack" style={{ gap: 14 }}>
            <label className="field"><span>Positioning</span>
              <textarea rows={3} value={s.positioning} onChange={(e) => set("positioning", e.target.value)} /></label>
            <label className="field"><span>Audience</span>
              <textarea rows={3} value={s.audience} onChange={(e) => set("audience", e.target.value)} /></label>
            <label className="field"><span>Goals</span>
              <textarea rows={3} value={s.goals} onChange={(e) => set("goals", e.target.value)} /></label>
            <div className="field"><span>Channels</span>
              <div className="strat-channels">
                {CHANNELS.map((c) => (
                  <label key={c.slug} className={`strat-channel ${s.channels.includes(c.slug) ? "is-on" : ""}`}>
                    <input type="checkbox" checked={s.channels.includes(c.slug)} onChange={() => toggleChannel(c.slug)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="field"><span>Cadence notes</span>
              <textarea rows={3} value={s.cadence_notes} onChange={(e) => set("cadence_notes", e.target.value)} /></label>
            <label className="field">
              <span>Plan data (advanced) — powers the charts, KPIs, offers, phases, tiers</span>
              <textarea
                rows={12}
                value={planText}
                onChange={(e) => setPlanText(e.target.value)}
                style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                spellCheck={false}
              />
            </label>
            {planErr ? <p className="error" style={{ margin: 0 }}>{planErr}</p> : null}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save strategy"}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ----- read mode ----- */
  return (
    <div className="strat-view">
      <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>{savedMsg}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit strategy</button>
      </div>

      {isEmpty ? (
        <div className="empty"><p>No strategy captured yet. Click “Edit strategy” to add it.</p></div>
      ) : null}

      {/* THESIS HERO */}
      {(plan.thesis || s.positioning || plan.kpis) ? (
        <div className="strat-thesis">
          <p className="strat-eyebrow">Strategy</p>
          {plan.thesis ? <h1>{plan.thesis}</h1> : null}
          {s.positioning ? <p>{s.positioning}</p> : null}
          {plan.kpis?.length ? (
            <div className="strat-kpis">
              {plan.kpis.map((k, i) => (
                <div className="strat-kpi" key={i}><div className="n">{k.n}</div><div className="l">{k.l}</div></div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* AUDIENCE + GOALS */}
      {(s.audience || plan.audienceMoments || s.goals) ? (
        <div className="strat-grid">
          {(s.audience || plan.audienceMoments) ? (
            <div className="strat-card">
              <h3 className="strat-sec-title">Who we reach</h3>
              {s.audience ? <p className="strat-body">{s.audience}</p> : null}
              {plan.audienceMoments?.length ? (
                <table className="strat-table" style={{ marginTop: 12 }}>
                  <tbody>
                    <tr><th>The moment</th><th>How the engine meets it</th></tr>
                    {plan.audienceMoments.map((m, i) => (<tr key={i}><td>{m.moment}</td><td>{m.meets}</td></tr>))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
          {s.goals ? (
            <div className="strat-card">
              <h3 className="strat-sec-title">Goals</h3>
              <p className="strat-body">{s.goals}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* OFFERS */}
      {plan.offers?.length ? (
        <div className="strat-card">
          <div className="strat-card-head"><h3 className="strat-sec-title">The offer ladder</h3></div>
          <div className="strat-offers">
            {plan.offers.map((o, i) => {
              const c = OFFER_COLORS[o.color || ""] || "#06808d";
              return (
                <div key={i} className="strat-offer" style={{ ["--c" as string]: c }}>
                  <span className="tier-tag" style={{ color: c }}>{o.tier}</span>
                  <h4>{o.name}</h4>
                  <p>{o.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* GROWTH PROJECTION */}
      {plan.phases?.length ? (
        <div className="strat-card">
          <div className="strat-card-head"><h3 className="strat-sec-title">Growth projection</h3></div>
          {plan.benchmarks ? <p className="strat-muted" style={{ marginTop: 0 }}>{plan.benchmarks}</p> : null}
          <GrowthChart phases={plan.phases} />
          <table className="strat-table" style={{ marginTop: 16 }}>
            <tbody>
              <tr>
                <th>Phase</th><th className="num">Calls / mo</th><th className="num">Booked / mo</th>
                <th className="num">Revenue / mo</th><th className="num">Cost / call</th><th className="num">Return</th>
              </tr>
              {plan.phases.map((p, i) => (
                <tr key={i}>
                  <td>{p.name} {p.months ? <span className="strat-muted">({p.months})</span> : null}</td>
                  <td className="num">{p.calls != null ? `~${p.calls}` : "—"}</td>
                  <td className="num">{p.booked != null ? `~${p.booked}` : "—"}</td>
                  <td className="num">{p.revenue || "—"}</td>
                  <td className="num">{p.costPerCall || "—"}</td>
                  <td className="num">{p.roi || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* EFFICIENCY (derived from phases) */}
      {plan.phases && plan.phases.length >= 2 && plan.phases[0].costPerCall && plan.phases[plan.phases.length - 1].costPerCall ? (
        <div className="strat-card">
          <h3 className="strat-sec-title">Efficiency improves as the engine matures</h3>
          <div className="strat-effic">
            <div className="strat-effic-box">
              <div className="lab">Cost per qualified call</div>
              <div className="row2">
                <span className="from">{plan.phases[0].costPerCall}</span>
                <span className="arr">→</span>
                <span className="to">{plan.phases[plan.phases.length - 1].costPerCall}</span>
              </div>
              <div className="sub">at launch → optimized</div>
            </div>
            {plan.phases[0].roi && plan.phases[plan.phases.length - 1].roi ? (
              <div className="strat-effic-box">
                <div className="lab">Return on media spend</div>
                <div className="row2">
                  <span className="from">{plan.phases[0].roi}</span>
                  <span className="arr">→</span>
                  <span className="to">{plan.phases[plan.phases.length - 1].roi}</span>
                </div>
                <div className="sub">early → optimized</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* CHANNELS */}
      {(plan.channelRoles?.length || s.channels.length) ? (
        <div className="strat-card">
          <div className="strat-card-head"><h3 className="strat-sec-title">The engine: each channel&apos;s job</h3></div>
          {plan.channelRoles?.length ? (
            <div className="strat-roles">
              {plan.channelRoles.map((r, i) => (
                <div key={i} className="strat-role">
                  <span className="rc">◎</span>
                  <span><b>{r.name}</b><small>{r.role}</small></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="strat-channels">
              {s.channels.map((slug) => {
                const c = CHANNELS.find((x) => x.slug === slug);
                return <span key={slug} className="strat-channel is-on">{c?.label || slug}</span>;
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* INVESTMENT TIERS */}
      {plan.tiers?.length ? (
        <div className="strat-card">
          <div className="strat-card-head"><h3 className="strat-sec-title">Investment levels</h3></div>
          <table className="strat-table">
            <tbody>
              <tr><th>Level</th><th className="num">Monthly media</th><th className="num">Calls / mo</th><th className="num">Booked / mo</th><th className="num">Est. revenue / mo</th></tr>
              {plan.tiers.map((t, i) => (
                <tr key={i}>
                  <td><b>{t.name}</b>{t.recommended ? <span className="strat-muted"> (recommended)</span> : null}</td>
                  <td className="num">{t.media}</td><td className="num">{t.calls}</td><td className="num">{t.booked}</td><td className="num">{t.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ROLLOUT */}
      {plan.rollout?.length ? (
        <div className="strat-card">
          <div className="strat-card-head"><h3 className="strat-sec-title">How it rolls out</h3></div>
          <div className="strat-rollout">
            {plan.rollout.map((r, i) => (
              <div key={i} className="strat-phase">
                {i < plan.rollout!.length - 1 ? <div className="track" /> : null}
                <div className="dot" />
                <div className="mo">{r.phase}</div>
                <h4>{r.name}</h4>
                <p>{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* LIFECYCLE + CADENCE */}
      {(plan.lifecycleFlows?.length || s.cadence_notes) ? (
        <div className="strat-grid">
          {plan.lifecycleFlows?.length ? (
            <div className="strat-card">
              <h3 className="strat-sec-title">Lifecycle automation</h3>
              {plan.lifecycleFlows.map((f, i) => (
                <div key={i} className="strat-flow"><b>{f.name}</b>{f.trigger ? <span className="trig">{f.trigger}</span> : null}</div>
              ))}
            </div>
          ) : null}
          {s.cadence_notes ? (
            <div className="strat-card">
              <h3 className="strat-sec-title">Cadence &amp; notes</h3>
              <p className="strat-body" style={{ whiteSpace: "pre-wrap" }}>{s.cadence_notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* GENERATE TO-DOS */}
      <div className="strat-card">
        <div className="strat-card-head">
          <h3 className="strat-sec-title">Generate to-dos from this strategy</h3>
          <span className="strat-muted">{genMsg}</span>
        </div>
        <div className="strat-gen-row">
          <div>
            <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14 }}>Onboarding to-dos</p>
            <p className="strat-muted" style={{ margin: 0 }}>Full setup checklist, segmented by department and assigned. Last generated: {fmtWhen(s.onboarding_generated_at)}.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => generate("onboarding")}>Generate onboarding</button>
        </div>
        <div className="strat-gen-row" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14 }}>Recurring to-dos</p>
            <p className="strat-muted" style={{ margin: 0 }}>This month&apos;s repeating work per department, due end of month. Last generated: {fmtWhen(s.recurring_generated_at)}.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => generate("recurring")}>Generate this month</button>
        </div>
      </div>
    </div>
  );
}
