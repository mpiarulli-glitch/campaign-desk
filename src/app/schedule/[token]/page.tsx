"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

type Data = {
  client: { name: string };
  window: { start: string; end: string } | null;
  status: CycleStatus;
  slots: string[];
  blackoutDates: string[];
  videographerBooked: string[];
  existingSend: {
    sendDate: string;
    sendTime: string;
    status: string;
    note: string;
  } | null;
};

type Brief = Record<string, string>;

// Parse a YYYY-MM-DD as UTC midnight so weekday/label math never drifts by tz.
function parseUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function dayName(ymd: string): string {
  return parseUtc(ymd).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}
function dayNumber(ymd: string): string {
  return parseUtc(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function longDate(ymd: string): string {
  return parseUtc(ymd).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
function slotLabel(hhmm: string): string {
  const h = Number(hhmm.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = parseUtc(start);
  const last = parseUtc(end);
  while (cur.getTime() <= last.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

const STATUS_HEADLINE: Record<string, string> = {
  requested: "Your request is in",
  planned: "You're booked",
  scheduled: "You're booked",
  sent: "This production has shipped",
};

export default function SchedulePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const [duration, setDuration] = useState<"half" | "full">("half");
  const [brief, setBrief] = useState<Brief>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const briefRef = useRef<HTMLDivElement | null>(null);

  const set = (key: string, value: string) =>
    setBrief((b) => ({ ...b, [key]: value }));

  async function load() {
    const res = await fetch(`/api/schedule/${token}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    load();
  }, [token]);

  const days = useMemo(
    () => (data?.window ? daysBetween(data.window.start, data.window.end) : []),
    [data]
  );
  const blackout = useMemo(
    () => new Set([...(data?.blackoutDates || []), ...(data?.videographerBooked || [])]),
    [data]
  );

  function choose(date: string, time: string) {
    setPick({ date, time });
    setError("");
    // Reveal + scroll to the brief once a slot is chosen.
    setTimeout(() => briefRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function submit() {
    if (!pick) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/schedule/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: pick.date,
        time: pick.time,
        duration,
        note: brief.additionalNotes || "",
        brief,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Could not book that slot.");
      briefRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    load();
  }

  function frame(children: React.ReactNode) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <Brand href="/" />
        </header>
        <main className="container stack sched-main">{children}</main>
      </div>
    );
  }

  if (notFound) {
    return frame(
      <div className="sched-notice">
        <h1 className="h1">Link not found</h1>
        <p className="muted">
          This scheduling link isn&apos;t valid anymore. Reach out to your account
          manager for a fresh one.
        </p>
      </div>
    );
  }
  if (!data) return frame(<p className="muted">Loading your calendar...</p>);

  const canBook = data.status === "due" || data.status === "not_due";

  if (!canBook && data.existingSend) {
    const s = data.existingSend;
    return frame(
      <>
        <p className="eyebrow">{data.client.name}</p>
        <div className="sched-confirmed">
          <div className="sched-confirmed-check">✓</div>
          <h1 className="h1">{STATUS_HEADLINE[s.status] || "Scheduled"}</h1>
          <p className="sched-confirmed-when">
            {longDate(s.sendDate)}
            {s.sendTime ? ` · ${slotLabel(s.sendTime)}` : ""}
          </p>
          {s.status === "requested" ? (
            <p className="muted">
              We&apos;ve got your details. Your account manager will confirm shortly.
            </p>
          ) : null}
        </div>

        <div className="sched-referral">
          <p className="sched-referral-eyebrow">Did you know?</p>
          <h2 className="sched-referral-title">Get paid to send business our way</h2>
          <p className="sched-referral-text">
            Know a company that could use better marketing? Refer them to the Empire
            Partner Program. We handle the consultation, onboarding, and all the work,
            and you earn a recurring share for the lifetime of the client.
          </p>

          <div className="sched-referral-stats">
            <div className="sched-referral-stat">
              <span className="sched-referral-num">5%</span>
              <span className="sched-referral-lbl">Revenue share on every referral</span>
            </div>
            <div className="sched-referral-stat">
              <span className="sched-referral-num">$5K</span>
              <span className="sched-referral-lbl">Average earned per referral</span>
            </div>
            <div className="sched-referral-stat">
              <span className="sched-referral-num">No cap</span>
              <span className="sched-referral-lbl">Refer as many as you want</span>
            </div>
          </div>

          <div className="sched-referral-how">
            <span>1. Refer a business</span>
            <span>2. We do the work</span>
            <span>3. You get paid, automatically</span>
          </div>

          <a
            className="sched-referral-btn"
            href="https://www.marketingempiregroup.com/empire-partner-program?rc=test-site"
            target="_blank"
            rel="noopener noreferrer"
          >
            Become a partner
          </a>
          <p className="sched-referral-fine">
            Recurring commissions for the life of the client. Join 50+ active partners.
          </p>
        </div>
      </>
    );
  }

  if (data.status === "not_configured" || data.status === "inactive") {
    return frame(
      <div className="sched-notice">
        <p className="eyebrow">{data.client.name}</p>
        <h1 className="h1">Scheduling isn&apos;t open yet</h1>
        <p className="muted">
          There&apos;s no production window open for you right now. Your account
          manager will reach out when it&apos;s time to book the next one.
        </p>
      </div>
    );
  }

  if (!data.window) return frame(<p className="muted">No window available.</p>);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/" />
      </header>
      <main className="container stack sched-main">
        <div className="sched-hero">
          <p className="eyebrow">{data.client.name}</p>
          <h1 className="h1">Book your next production</h1>
          <p className="sched-sub">
            Pick a date and start time, then tell us a bit about the production. Choose any
            weekday from{" "}
            <strong>
              {dayNumber(data.window.start)} – {dayNumber(data.window.end)}
            </strong>
            , 9 to 5.
          </p>
        </div>

        {/* Step 1 — slot grid */}
        <div className="sched-grid-card">
          <div
            className="sched-grid"
            style={{ gridTemplateColumns: `72px repeat(${days.length}, 1fr)` }}
          >
            <div className="sched-corner" />
            {days.map((d) => {
              const off = blackout.has(d);
              return (
                <div key={d} className={`sched-daycol ${off ? "is-off" : ""}`}>
                  <span className="sched-dow">{dayName(d)}</span>
                  <span className="sched-date">{dayNumber(d)}</span>
                </div>
              );
            })}
            {data.slots.map((slot) => (
              <div key={slot} className="sched-row-contents">
                <div className="sched-timelabel">{slotLabel(slot)}</div>
                {days.map((d) => {
                  const off = blackout.has(d);
                  const selected = pick?.date === d && pick?.time === slot;
                  return (
                    <button
                      key={d + slot}
                      type="button"
                      className={`sched-slot ${selected ? "is-selected" : ""}`}
                      disabled={off}
                      aria-pressed={selected}
                      aria-label={`${longDate(d)} at ${slotLabel(slot)}`}
                      onClick={() => choose(d, slot)}
                    >
                      {selected ? "✓" : ""}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Step 2 — production brief (appears after a slot is picked) */}
        {pick ? (
          <div ref={briefRef} className="brief stack">
            <div className="brief-selected">
              <div>
                <span className="brief-selected-label">Booking</span>
                <strong>
                  {longDate(pick.date)} · {slotLabel(pick.time)}
                </strong>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPick(null)}>
                Change slot
              </button>
            </div>

            <div className="brief-duration">
              <span className="brief-duration-label">Production length</span>
              <div className="brief-duration-opts">
                <button
                  type="button"
                  className={`brief-dur ${duration === "half" ? "is-on" : ""}`}
                  onClick={() => setDuration("half")}
                >
                  4 hours
                </button>
                <button
                  type="button"
                  className={`brief-dur ${duration === "full" ? "is-on" : ""}`}
                  onClick={() => setDuration("full")}
                >
                  Full day
                </button>
              </div>
              <span className="brief-duration-note">
                {duration === "full"
                  ? "Full day runs 9:00 AM to 5:30 PM."
                  : "A 4-hour production."}{" "}
                Every production ends at 5:30 PM.
              </span>
            </div>

            <p className="brief-intro muted">
              A videographer typically arrives 15–30 minutes early for setup. Only the
              location and on-site contact are required — the rest helps us plan the production.
            </p>

            {error ? <p className="error">{error}</p> : null}

            <BriefSection num="01" title="Essential details">
              <div className="field">
                <label>Production location(s) <span className="req">required</span></label>
                <textarea
                  value={brief.locations || ""}
                  onChange={(e) => set("locations", e.target.value)}
                  placeholder="Full address (business or residential). List every location, in order, if there's more than one."
                />
              </div>
              <div className="rev-form-grid">
                <div className="field">
                  <label>On-site contact name <span className="req">required</span></label>
                  <input
                    value={brief.onsiteContactName || ""}
                    onChange={(e) => set("onsiteContactName", e.target.value)}
                    placeholder="Who the crew asks for"
                  />
                </div>
                <div className="field">
                  <label>On-site contact phone <span className="req">required</span></label>
                  <input
                    value={brief.onsiteContactPhone || ""}
                    onChange={(e) => set("onsiteContactPhone", e.target.value)}
                    placeholder="Reachable on production day"
                  />
                </div>
              </div>
            </BriefSection>

            <BriefSection num="02" title="Access & environment">
              <div className="rev-form-grid">
                <div className="field">
                  <label>Location on production day</label>
                  <select
                    className="select-clean"
                    value={brief.locationState || ""}
                    onChange={(e) => set("locationState", e.target.value)}
                  >
                    <option value="">Select one</option>
                    <option>Clean & camera-ready</option>
                    <option>Busy / active during filming</option>
                    <option>Both / mixed</option>
                  </select>
                </div>
                <div className="field">
                  <label>Power access on site?</label>
                  <select
                    className="select-clean"
                    value={brief.powerAccess || ""}
                    onChange={(e) => set("powerAccess", e.target.value)}
                  >
                    <option value="">Select one</option>
                    <option>Yes, power available</option>
                    <option>No / unsure</option>
                  </select>
                </div>
                <div className="field">
                  <label>Time restrictions</label>
                  <input
                    value={brief.timeRestrictions || ""}
                    onChange={(e) => set("timeRestrictions", e.target.value)}
                    placeholder="Any times we should work around"
                  />
                </div>
                <div className="field">
                  <label>Parking</label>
                  <input
                    value={brief.parking || ""}
                    onChange={(e) => set("parking", e.target.value)}
                    placeholder="Where the crew should park"
                  />
                </div>
              </div>
            </BriefSection>

            <BriefSection num="03" title="People & permissions">
              <div className="field">
                <label>Who will be on camera or on site?</label>
                <input
                  value={brief.onCameraPeople || ""}
                  onChange={(e) => set("onCameraPeople", e.target.value)}
                  placeholder="Names of anyone who'll be around, so we know who to expect"
                />
              </div>
              <div className="rev-form-grid">
                <div className="field">
                  <label>Everyone on site is okay being filmed?</label>
                  <select
                    className="select-clean"
                    value={brief.participantsConsent || ""}
                    onChange={(e) => set("participantsConsent", e.target.value)}
                  >
                    <option value="">Select one</option>
                    <option>Yes</option>
                    <option>Some</option>
                    <option>Not sure yet</option>
                  </select>
                </div>
                <div className="field">
                  <label>Customers being filmed?</label>
                  <select
                    className="select-clean"
                    value={brief.mediaRelease || ""}
                    onChange={(e) => set("mediaRelease", e.target.value)}
                  >
                    <option value="">Select one</option>
                    <option>Yes, releases signed</option>
                    <option>Yes, not signed yet</option>
                    <option>No customers on camera</option>
                  </select>
                </div>
                <div className="field">
                  <label>Filming on private property?</label>
                  <select
                    className="select-clean"
                    value={brief.propertyApproval || ""}
                    onChange={(e) => set("propertyApproval", e.target.value)}
                  >
                    <option value="">Select one</option>
                    <option>Yes, approved</option>
                    <option>Yes, approval pending</option>
                    <option>No</option>
                  </select>
                </div>
              </div>
            </BriefSection>

            <BriefSection num="04" title="Safety compliance">
              <p className="brief-intro muted" style={{ margin: 0 }}>
                As we prepare for this production, please inform us of any specific OSHA
                regulations or safety gear required for your industry (hard hats, high
                visibility vests, etc). It&rsquo;s crucial that both our team and yours adhere
                to all safety guidelines to ensure a smooth and secure production process.
              </p>
              <div className="field">
                <label>Required safety gear or regulations</label>
                <input
                  value={brief.safetyCompliance || ""}
                  onChange={(e) => set("safetyCompliance", e.target.value)}
                  placeholder="e.g. hard hats, hi-vis vests, steel-toe boots, site check-in"
                />
              </div>
            </BriefSection>

            <BriefSection num="05" title="Anything you'd like us to capture?">
              <div className="field">
                <label>Shots or moments you&rsquo;d like</label>
                <textarea
                  value={brief.captureRequests || ""}
                  onChange={(e) => set("captureRequests", e.target.value)}
                  placeholder="Optional. A specific service, product, space, or team member you'd love to see featured."
                />
              </div>
              <div className="field">
                <label>Any offers or promotions to highlight?</label>
                <input
                  value={brief.offersPromotions || ""}
                  onChange={(e) => set("offersPromotions", e.target.value)}
                  placeholder="Optional. A current deal, promo, or seasonal offer you want featured."
                />
              </div>
              <div className="field">
                <label>Anything we should avoid?</label>
                <input
                  value={brief.avoidRequests || ""}
                  onChange={(e) => set("avoidRequests", e.target.value)}
                  placeholder="Optional. Areas, people, or details to keep off camera."
                />
              </div>
              <div className="field">
                <label>Anything else we should know?</label>
                <textarea
                  value={brief.additionalNotes || ""}
                  onChange={(e) => set("additionalNotes", e.target.value)}
                  placeholder="Optional. Anything that helps the production go smoothly."
                />
              </div>
            </BriefSection>

            <div className="brief-submit">
              <button className="btn" disabled={saving} onClick={submit}>
                {saving ? "Requesting..." : "Request this slot"}
              </button>
              <span className="muted">
                {longDate(pick.date)} · {slotLabel(pick.time)}
              </span>
            </div>
          </div>
        ) : (
          <p className="sched-hint muted">Tap a slot above to get started.</p>
        )}
      </main>
    </div>
  );
}

function BriefSection({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card card-pad stack brief-section">
      <div className="brief-head">
        <span className="brief-num">{num}</span>
        <h2 className="brief-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}
