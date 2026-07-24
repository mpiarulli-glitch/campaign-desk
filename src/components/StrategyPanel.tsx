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

type Strategy = {
  positioning: string;
  audience: string;
  goals: string;
  channels: string[];
  cadence_notes: string;
  onboarding_generated_at: string | null;
  recurring_generated_at: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "not yet";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function StrategyPanel({
  clientId,
  onGenerated,
}: {
  clientId: string;
  onGenerated?: () => void;
}) {
  const [s, setS] = useState<Strategy | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [genMsg, setGenMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/strategy`);
    if (res.ok) setS((await res.json()).strategy);
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Strategy>(key: K, value: Strategy[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function toggleChannel(slug: string) {
    if (!s) return;
    set("channels", s.channels.includes(slug) ? s.channels.filter((c) => c !== slug) : [...s.channels, slug]);
  }

  async function save() {
    if (!s) return;
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
      }),
    });
    if (res.ok) {
      setS((await res.json()).strategy);
      setSavedMsg("Saved.");
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
    if (data.skipped) {
      setGenMsg(data.reason || "Already generated.");
    } else {
      setGenMsg(`Added ${data.created} ${type} to-do${data.created === 1 ? "" : "s"}.`);
      onGenerated?.();
    }
    load();
    setTimeout(() => setGenMsg(""), 4000);
  }

  if (!s) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="acct-section">
        <div className="acct-section-head">
          <h2 className="acct-section-title">Strategy</h2>
          <span className="muted" style={{ fontSize: 12 }}>{savedMsg}</span>
        </div>
        <div className="card card-pad stack" style={{ gap: 14 }}>
          <label className="field">
            <span>Positioning</span>
            <textarea rows={2} value={s.positioning} onChange={(e) => set("positioning", e.target.value)} placeholder="How this brand is positioned and what makes it different." />
          </label>
          <label className="field">
            <span>Audience</span>
            <textarea rows={2} value={s.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Who we're marketing to." />
          </label>
          <label className="field">
            <span>Goals</span>
            <textarea rows={2} value={s.goals} onChange={(e) => set("goals", e.target.value)} placeholder="What success looks like for this account." />
          </label>
          <div className="field">
            <span>Channels</span>
            <div className="strat-channels">
              {CHANNELS.map((c) => (
                <label key={c.slug} className={`strat-channel ${s.channels.includes(c.slug) ? "is-on" : ""}`}>
                  <input type="checkbox" checked={s.channels.includes(c.slug)} onChange={() => toggleChannel(c.slug)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Cadence notes</span>
            <textarea rows={2} value={s.cadence_notes} onChange={(e) => set("cadence_notes", e.target.value)} placeholder="How often things go out, blackout dates, seasonal beats." />
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save strategy"}</button>
          </div>
        </div>
      </div>

      <div className="acct-section">
        <div className="acct-section-head">
          <h2 className="acct-section-title">Generate to-dos from this strategy</h2>
          <span className="muted" style={{ fontSize: 12 }}>{genMsg}</span>
        </div>
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <div className="strat-gen-row">
            <div>
              <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14 }}>Onboarding to-dos</p>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Full setup checklist plus channel-specific work. Last generated: {fmtWhen(s.onboarding_generated_at)}.
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => generate("onboarding")}>Generate onboarding</button>
          </div>
          <div className="strat-gen-row" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div>
              <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14 }}>Recurring to-dos</p>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                This month&apos;s repeating work per channel, due end of month. Last generated: {fmtWhen(s.recurring_generated_at)}.
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => generate("recurring")}>Generate this month</button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Generated to-dos land on this client&apos;s To-dos tab. Assign and set due dates from there.
          </p>
        </div>
      </div>
    </div>
  );
}
