"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type {
  AccountAbTest,
  AccountBrandGuidelines,
  AccountCalendarItem,
  AccountIcp,
  AccountOffer,
  AccountOptInMethod,
  AccountPlaybook,
} from "@/lib/lifecycle-account-playbook";
import { HubFoldCard } from "./HubFoldCard";

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const OFFER_TYPE_LABELS: Record<string, string> = {
  core: "Core offer",
  lead_magnet: "Lead magnet",
  seasonal: "Seasonal / Promo",
  tripwire: "Intro / Tripwire",
  winback: "Winback",
  referral: "Referral",
};

const OPT_IN_CHANNEL_LABELS: Record<string, string> = {
  popup: "Popup / Modal",
  embedded_form: "Embedded form",
  checkout: "Checkout opt-in",
  landing_page: "Landing page",
  quiz: "Quiz / Assessment",
  sms_keyword: "SMS keyword",
  lead_ad: "Paid lead form",
  giveaway: "Giveaway",
};

const AB_VARIABLE_LABELS: Record<string, string> = {
  subject_line: "Subject line",
  preview_text: "Preview text",
  offer: "Offer / Hook",
  cta: "CTA copy / button",
  layout: "Design / Layout",
  plain_text_vs_html: "Plain text vs HTML",
  send_time: "Send day / time",
  from_name: "Sender name",
  segment: "Audience / Segment",
};

const AB_METRIC_LABELS: Record<string, string> = {
  open_rate: "Open rate",
  click_rate: "Click rate",
  reply_rate: "Reply rate",
  conversion_rate: "Conversion / Booking rate",
  revenue: "Revenue / RPR",
};

const WINNER_LABELS: Record<AccountAbTest["winner"], string> = {
  pending: "Pending",
  a: "Variant A won",
  b: "Variant B won",
  tie: "Tie",
  inconclusive: "Inconclusive",
};

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function expandHex(raw: string): string {
  const h = raw.toLowerCase();
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

function brandHexes(colors: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of colors.match(HEX_RE) || []) {
    const hex = expandHex(raw);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function brandStyle(colors: string): CSSProperties {
  const hexes = brandHexes(colors);
  const heat =
    hexes.find((h) => {
      const l = luminance(h);
      return l > 0.08 && l < 0.92;
    }) ||
    hexes[0] ||
    "#d24719";
  const ink = hexes.find((h) => luminance(h) <= 0.18) || "#111111";
  return {
    ["--lh-heat" as string]: heat,
    ["--lh-ink" as string]: ink,
    ["--lh-on-heat" as string]: luminance(heat) > 0.62 ? "#161616" : "#fff7f2",
  };
}

export function AccountPlaybookPanels({
  clientId,
  memberIds = [],
  onOpenChange,
}: {
  clientId: string;
  memberIds?: string[];
  onOpenChange?: (open: boolean) => void;
}) {
  const [data, setData] = useState<AccountPlaybook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState<
    "brand" | "icps" | "offers" | "optins" | "calendar" | "testing" | "ab" | null
  >(null);

  const membersParam = memberIds.join(",");

  const load = useCallback(async () => {
    setError("");
    try {
      const qs = membersParam ? `?members=${encodeURIComponent(membersParam)}` : "";
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook${qs}`);
      if (!res.ok) {
        setError("Could not load account playbook.");
        return;
      }
      setData((await res.json()) as AccountPlaybook);
    } catch {
      setError("Could not load account playbook.");
    } finally {
      setLoading(false);
    }
  }, [clientId, membersParam]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    onOpenChange?.(page !== null);
  }, [page, onOpenChange]);

  if (loading && !data) {
    return <p className="lh-card-note">Loading account strategy &amp; testing logs…</p>;
  }

  if (!data) {
    return error ? <p className="lh-error">{error}</p> : null;
  }

  const pages = [
    { id: "brand" as const, label: "Brand", index: "01", line: data.brand.voiceTone ? "Voice, color, and the rules nothing ships without." : "Not written yet." },
    { id: "icps" as const, label: "Audiences", index: "02", line: data.icps.length ? `${data.icps.length} people we are writing to.` : "No audiences yet." },
    { id: "offers" as const, label: "Offers", index: "03", line: data.offers.length ? data.offers.map((o) => o.name).slice(0, 3).join(" · ") : "No offers yet." },
    { id: "optins" as const, label: "Capture", index: "04", line: data.optIns.length ? `${data.optIns.length} ways onto the list.` : "No capture yet." },
    { id: "calendar" as const, label: "Calendar", index: "05", line: data.campaignCalendar.length ? `${data.campaignCalendar.length} sends on the month grid.` : "Empty calendar." },
    { id: "testing" as const, label: "Test plan", index: "06", line: data.testingCalendar.length ? `${data.testingCalendar.length} experiments dated.` : "No tests queued." },
    { id: "ab" as const, label: "Results", index: "07", line: data.abTests.length ? `${data.abTests.length} tests in the log.` : "No results yet." },
  ];

  const palette = brandStyle(data.brand.colors);

  if (!page) {
    return (
      <div className="lh-studio-index lh-branded" style={palette}>
        {pages.map((p) => (
          <button key={p.id} type="button" className="lh-studio-cover" onClick={() => setPage(p.id)}>
            <span>{p.index}</span>
            <strong>{p.label}</strong>
            <em>{p.line}</em>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="lh-studio is-page lh-branded" style={palette}>
      <div className="lh-studio-stage">
      <button type="button" className="lh-studio-back" onClick={() => setPage(null)}>
        ← Pages
      </button>
      {page === "brand" ? (
      <BrandGuidelinesCard
        clientId={clientId}
        brand={data.brand}
        onSaved={() => void load()}
      />
      ) : null}
      {page === "icps" ? (
      <IcpsCard
        clientId={clientId}
        icps={data.icps}
        onChanged={() => void load()}
      />
      ) : null}
      {page === "offers" ? (
      <OffersCard
        clientId={clientId}
        offers={data.offers}
        onChanged={() => void load()}
      />
      ) : null}
      {page === "optins" ? (
      <OptInsCard
        clientId={clientId}
        optIns={data.optIns}
        onChanged={() => void load()}
      />
      ) : null}
      {page === "calendar" ? (
      <CalendarCard
        clientId={clientId}
        kind="campaign"
        title="Campaign calendar"
        subtitle="The month of sends. Dean Days, giveaways, and the emails that bring people through the door."
        items={data.campaignCalendar}
        onChanged={() => void load()}
      />
      ) : null}
      {page === "testing" ? (
      <CalendarCard
        clientId={clientId}
        kind="testing"
        title="Test plan"
        subtitle="Experiments queued before they earn a result."
        items={data.testingCalendar}
        onChanged={() => void load()}
      />
      ) : null}
      {page === "ab" ? (
      <AbTestingLogCard
        clientId={clientId}
        tests={data.abTests}
        onChanged={() => void load()}
      />
      ) : null}
      </div>
    </div>
  );
}

function BrandGuidelinesCard({
  clientId,
  brand,
  onSaved,
}: {
  clientId: string;
  brand: AccountBrandGuidelines;
  onSaved: () => void;
}) {
  const [voiceTone, setVoiceTone] = useState(brand.voiceTone);
  const [colors, setColors] = useState(brand.colors);
  const [fonts, setFonts] = useState(brand.fonts);
  const [logoAssetsUrl, setLogoAssetsUrl] = useState(brand.logoAssetsUrl);
  const [dosAndDonts, setDosAndDonts] = useState(brand.dosAndDonts);
  const [senderName, setSenderName] = useState(brand.senderName);
  const [replyToEmail, setReplyToEmail] = useState(brand.replyToEmail);
  const [footerNotes, setFooterNotes] = useState(brand.footerNotes);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setVoiceTone(brand.voiceTone);
    setColors(brand.colors);
    setFonts(brand.fonts);
    setLogoAssetsUrl(brand.logoAssetsUrl);
    setDosAndDonts(brand.dosAndDonts);
    setSenderName(brand.senderName);
    setReplyToEmail(brand.replyToEmail);
    setFooterNotes(brand.footerNotes);
  }, [brand]);

  const filledCount = [
    brand.voiceTone,
    brand.colors,
    brand.fonts,
    brand.logoAssetsUrl,
    brand.dosAndDonts,
    brand.senderName,
    brand.replyToEmail,
  ].filter((v) => v.trim().length > 0).length;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceTone,
          colors,
          fonts,
          logoAssetsUrl,
          dosAndDonts,
          senderName,
          replyToEmail,
          footerNotes,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not save brand guidelines.");
        return;
      }
      setSavedMsg("Saved");
      setEditing(false);
      setTimeout(() => setSavedMsg(""), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const swatches = brandHexes(colors);
  const shownSwatches = swatches.length ? swatches : brandHexes(brand.colors);

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title="Brand guidelines"
      actions={
        <span className="muted">
          {filledCount > 0 ? `${filledCount} fields set` : "Not set"}
        </span>
      }
    >
      {!editing ? (
        <div className="lh-kit">
          <div className="lh-kit-ribbon" aria-hidden="true">
            {(shownSwatches.length ? shownSwatches : ["var(--lh-heat)"]).map((hex) => (
              <i key={hex} style={{ background: hex }} />
            ))}
          </div>
          <div className="lh-kit-id">
            <p className="lh-kit-kicker">{brand.senderName || "This account"}</p>
            {voiceTone ? <blockquote className="lh-kit-voice">{voiceTone}</blockquote> : (
              <p className="lh-card-note">Voice is not written yet.</p>
            )}
            {fonts ? <p className="lh-kit-fonts">{fonts}</p> : null}
          </div>
          {shownSwatches.length ? (
            <div className="lh-kit-swatches">
              {shownSwatches.map((hex) => (
                <figure
                  key={hex}
                  style={{
                    background: hex,
                    color: luminance(hex) > 0.62 ? "#161616" : "#fff7f2",
                  }}
                >
                  <figcaption>{hex}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          <dl className="lh-kit-meta">
            {senderName ? (
              <>
                <dt>From</dt>
                <dd>{senderName}</dd>
              </>
            ) : null}
            {replyToEmail ? (
              <>
                <dt>Reply</dt>
                <dd>{replyToEmail}</dd>
              </>
            ) : null}
            {logoAssetsUrl ? (
              <>
                <dt>Kit</dt>
                <dd>
                  <a href={logoAssetsUrl} target="_blank" rel="noreferrer" className="lh-link">
                    Open brand kit ↗
                  </a>
                </dd>
              </>
            ) : null}
            {footerNotes ? (
              <>
                <dt>Footer</dt>
                <dd>{footerNotes}</dd>
              </>
            ) : null}
          </dl>
          {dosAndDonts ? (
            <section className="lh-kit-rules">
              <h3>Guardrails</h3>
              <p>{dosAndDonts}</p>
            </section>
          ) : null}
          <button type="button" className="lh-kit-edit" onClick={() => setEditing(true)}>
            Edit the kit
          </button>
        </div>
      ) : null}
      {editing ? (
      <form className="lh-pb-form" onSubmit={(e) => void save(e)}>
        <div className="lh-pb-grid-2">
          <label className="lh-field">
            <span>From / Sender name</span>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Dr. Sarah at Northline"
            />
          </label>
          <label className="lh-field">
            <span>Reply-to email</span>
            <input
              type="text"
              value={replyToEmail}
              onChange={(e) => setReplyToEmail(e.target.value)}
              placeholder="e.g. hello@northline.com"
            />
          </label>
          <label className="lh-field">
            <span>Brand colors (hex codes)</span>
            <input
              type="text"
              value={colors}
              onChange={(e) => setColors(e.target.value)}
              placeholder="e.g. Primary #1E3A8A · Accent #F59E0B · Bg #FAF8F5"
            />
          </label>
          <label className="lh-field">
            <span>Typography / Fonts</span>
            <input
              type="text"
              value={fonts}
              onChange={(e) => setFonts(e.target.value)}
              placeholder="e.g. Headings: Fraunces · Body: Inter"
            />
          </label>
        </div>

        <label className="lh-field">
          <span>Logo &amp; brand assets link</span>
          <input
            type="url"
            value={logoAssetsUrl}
            onChange={(e) => setLogoAssetsUrl(e.target.value)}
            placeholder="https://drive.google.com/... or Figma / Canva link"
          />
        </label>

        <label className="lh-field">
          <span>Voice &amp; tone</span>
          <textarea
            rows={3}
            value={voiceTone}
            onChange={(e) => setVoiceTone(e.target.value)}
            placeholder="How the brand sounds — e.g. Warm, direct, neighbourly, no corporate jargon."
          />
        </label>

        <label className="lh-field">
          <span>Copy guardrails (Do&rsquo;s &amp; Don&rsquo;ts)</span>
          <textarea
            rows={3}
            value={dosAndDonts}
            onChange={(e) => setDosAndDonts(e.target.value)}
            placeholder="Words to avoid, compliance rules, formatting preferences, sign-off style…"
          />
        </label>

        <label className="lh-field">
          <span>Footer / physical address / disclaimer notes</span>
          <input
            type="text"
            value={footerNotes}
            onChange={(e) => setFooterNotes(e.target.value)}
            placeholder="Required legal footer, business hours, or service area callout"
          />
        </label>

        {error ? <p className="lh-error">{error}</p> : null}
        <div className="lh-pb-actions">
          <button type="submit" className="btn btn-sm" disabled={saving}>
            {saving ? "Saving…" : "Save brand guidelines"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          {savedMsg ? <span className="lh-pb-saved">{savedMsg}</span> : null}
        </div>
      </form>
      ) : null}
    </HubFoldCard>
  );
}

function IcpsCard({
  clientId,
  icps,
  onChanged,
}: {
  clientId: string;
  icps: AccountIcp[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [desires, setDesires] = useState("");
  const [objections, setObjections] = useState("");
  const [triggers, setTriggers] = useState("");
  const [messagingAngle, setMessagingAngle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Add an ICP segment name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "icp",
          name,
          painPoints,
          desires,
          objections,
          triggers,
          messagingAngle,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not add ICP.");
        return;
      }
      setName("");
      setPainPoints("");
      setDesires("");
      setObjections("");
      setTriggers("");
      setMessagingAngle("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook?section=icp&id=${id}`, {
      method: "DELETE",
    });
    onChanged();
  }

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title="Audiences"
      actions={
        <span className="muted">
          {icps.length ? `${icps.length} profile${icps.length === 1 ? "" : "s"}` : "None yet"}
        </span>
      }
    >
      {icps.length === 0 && !adding ? (
        <p className="lh-card-note">
          Document who we&rsquo;re writing to — core personas, pain points, buying triggers, objections, and winning angles.
        </p>
      ) : (
        <div className="lh-pb-stack">
          {icps.map((icp, index) => (
            <article key={icp.id} className="lh-pb-item lh-persona">
              <div className="lh-pb-item-head">
                <h4>
                  <span className="lh-persona-num">{String(index + 1).padStart(2, "0")}</span>
                  {icp.name}
                </h4>
                <button
                  type="button"
                  className="lh-todo-remove"
                  onClick={() => void remove(icp.id)}
                >
                  Remove
                </button>
              </div>
              <div className="lh-facts">
                {icp.painPoints ? (
                  <div>
                    <span>Pain</span>
                    <p>{icp.painPoints}</p>
                  </div>
                ) : null}
                {icp.desires ? (
                  <div>
                    <span>Wants</span>
                    <p>{icp.desires}</p>
                  </div>
                ) : null}
                {icp.objections ? (
                  <div>
                    <span>Objections</span>
                    <p>{icp.objections}</p>
                  </div>
                ) : null}
                {icp.triggers ? (
                  <div>
                    <span>Triggers</span>
                    <p>{icp.triggers}</p>
                  </div>
                ) : null}
                {icp.messagingAngle ? (
                  <div className="is-wide">
                    <span>Write it like this</span>
                    <p>{icp.messagingAngle}</p>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {adding ? (
        <form className="lh-pb-form lh-pb-subform" onSubmit={(e) => void submit(e)}>
          <label className="lh-field">
            <span>Segment / Persona name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Busy homeowner (45–65) needing urgent roof repair"
              autoFocus
            />
          </label>
          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>Pain points</span>
              <textarea
                rows={2}
                value={painPoints}
                onChange={(e) => setPainPoints(e.target.value)}
                placeholder="What frustrates them right now?"
              />
            </label>
            <label className="lh-field">
              <span>Goals &amp; desires</span>
              <textarea
                rows={2}
                value={desires}
                onChange={(e) => setDesires(e.target.value)}
                placeholder="What outcome do they want?"
              />
            </label>
            <label className="lh-field">
              <span>Common objections</span>
              <textarea
                rows={2}
                value={objections}
                onChange={(e) => setObjections(e.target.value)}
                placeholder="Price, timing, trust, switching cost…"
              />
            </label>
            <label className="lh-field">
              <span>Buying triggers</span>
              <textarea
                rows={2}
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder="Seasonality, life event, urgent breakdown…"
              />
            </label>
          </div>
          <label className="lh-field">
            <span>Winning messaging angle / hook</span>
            <input
              type="text"
              value={messagingAngle}
              onChange={(e) => setMessagingAngle(e.target.value)}
              placeholder="Lead with same-day guarantee + local family-owned proof"
            />
          </label>
          {error ? <p className="lh-error">{error}</p> : null}
          <div className="lh-pb-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Adding…" : "Add ICP"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lh-checklist-add"
          onClick={() => setAdding(true)}
        >
          + Add ICP
        </button>
      )}
    </HubFoldCard>
  );
}

function OffersCard({
  clientId,
  offers,
  onChanged,
}: {
  clientId: string;
  offers: AccountOffer[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [offerType, setOfferType] = useState("core");
  const [details, setDetails] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [status, setStatus] = useState<AccountOffer["status"]>("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Add an offer name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "offer",
          name,
          offerType,
          details,
          promoCode,
          ctaUrl,
          status,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not add offer.");
        return;
      }
      setName("");
      setOfferType("core");
      setDetails("");
      setPromoCode("");
      setCtaUrl("");
      setStatus("active");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, nextStatus: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "offer", id, status: nextStatus }),
    });
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook?section=offer&id=${id}`, {
      method: "DELETE",
    });
    onChanged();
  }

  const activeCount = offers.filter((o) => o.status === "active").length;

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title="Offers"
      actions={
        <span className="muted">
          {offers.length ? `${activeCount} active · ${offers.length} total` : "None yet"}
        </span>
      }
    >
      {offers.length === 0 && !adding ? (
        <p className="lh-card-note">
          Track approved offers, discounts, promo codes, and booking CTAs we can rotate into campaigns and flows.
        </p>
      ) : (
        <div className="lh-pb-stack">
          {offers.map((offer) => (
            <article
              key={offer.id}
              className={`lh-pb-item lh-offer${
                offer.status === "active" && offers.find((o) => o.status === "active")?.id === offer.id
                  ? " is-lead"
                  : ""
              }`}
            >
              <div className="lh-pb-item-head">
                <div className="lh-pb-title-row">
                  <span className="lh-pb-tag">
                    {OFFER_TYPE_LABELS[offer.offerType] || offer.offerType}
                  </span>
                  <h4>{offer.name}</h4>
                  {offer.promoCode ? (
                    <code className="lh-pb-code">{offer.promoCode}</code>
                  ) : null}
                </div>
                <div className="lh-pb-item-controls">
                  <select
                    className="lh-pb-status-select"
                    value={offer.status}
                    onChange={(e) => void changeStatus(offer.id, e.target.value)}
                    aria-label={`Status for ${offer.name}`}
                  >
                    <option value="active">Active</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="paused">Paused</option>
                    <option value="retired">Retired</option>
                  </select>
                  <button
                    type="button"
                    className="lh-todo-remove"
                    onClick={() => void remove(offer.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {offer.details ? <p className="lh-pb-body">{offer.details}</p> : null}
              {offer.ctaUrl ? (
                <p className="lh-pb-meta">
                  <a href={offer.ctaUrl} target="_blank" rel="noreferrer" className="lh-link">
                    {offer.ctaUrl} ↗
                  </a>
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {adding ? (
        <form className="lh-pb-form lh-pb-subform" onSubmit={(e) => void submit(e)}>
          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>Offer headline</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. $99 Tune-Up + Free Safety Inspection"
                autoFocus
              />
            </label>
            <label className="lh-field">
              <span>Type</span>
              <select value={offerType} onChange={(e) => setOfferType(e.target.value)}>
                {Object.entries(OFFER_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="lh-field">
              <span>Promo code (optional)</span>
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="e.g. WELCOME15"
              />
            </label>
            <label className="lh-field">
              <span>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AccountOffer["status"])}
              >
                <option value="active">Active</option>
                <option value="upcoming">Upcoming</option>
                <option value="paused">Paused</option>
                <option value="retired">Retired</option>
              </select>
            </label>
          </div>
          <label className="lh-field">
            <span>Landing / Booking URL</span>
            <input
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="lh-field">
            <span>Terms, exclusions, or positioning notes</span>
            <textarea
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Valid for first-time customers, expires end of quarter…"
            />
          </label>
          {error ? <p className="lh-error">{error}</p> : null}
          <div className="lh-pb-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Adding…" : "Add offer"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lh-checklist-add"
          onClick={() => setAdding(true)}
        >
          + Add offer
        </button>
      )}
    </HubFoldCard>
  );
}

function OptInsCard({
  clientId,
  optIns,
  onChanged,
}: {
  clientId: string;
  optIns: AccountOptInMethod[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("popup");
  const [incentive, setIncentive] = useState("");
  const [destinationList, setDestinationList] = useState("");
  const [conversionRate, setConversionRate] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<AccountOptInMethod["status"]>("live");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Add an opt-in method name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "opt_in",
          name,
          channel,
          incentive,
          destinationList,
          conversionRate,
          url,
          status,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not add opt-in method.");
        return;
      }
      setName("");
      setChannel("popup");
      setIncentive("");
      setDestinationList("");
      setConversionRate("");
      setUrl("");
      setStatus("live");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, nextStatus: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "opt_in", id, status: nextStatus }),
    });
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook?section=opt_in&id=${id}`, {
      method: "DELETE",
    });
    onChanged();
  }

  const liveCount = optIns.filter((o) => o.status === "live").length;

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title="Capture"
      actions={
        <span className="muted">
          {optIns.length ? `${liveCount} live · ${optIns.length} total` : "None yet"}
        </span>
      }
    >
      {optIns.length === 0 && !adding ? (
        <p className="lh-card-note">
          How subscribers enter the list — popups, embedded forms, checkout checkboxes, lead magnets, and target lists/tags.
        </p>
      ) : (
        <div className="lh-pb-stack">
          {optIns.map((opt) => (
            <article key={opt.id} className="lh-pb-item lh-capture">
              <div className="lh-pb-item-head">
                <div className="lh-pb-title-row">
                  <span className="lh-pb-tag">
                    {OPT_IN_CHANNEL_LABELS[opt.channel] || opt.channel}
                  </span>
                  <h4>{opt.name}</h4>
                  {opt.conversionRate ? (
                    <span className="lh-pb-metric">{opt.conversionRate} CVR</span>
                  ) : null}
                </div>
                <div className="lh-pb-item-controls">
                  <select
                    className="lh-pb-status-select"
                    value={opt.status}
                    onChange={(e) => void changeStatus(opt.id, e.target.value)}
                    aria-label={`Status for ${opt.name}`}
                  >
                    <option value="live">Live</option>
                    <option value="testing">Testing</option>
                    <option value="draft">Draft</option>
                    <option value="paused">Paused</option>
                  </select>
                  <button
                    type="button"
                    className="lh-todo-remove"
                    onClick={() => void remove(opt.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="lh-facts">
                {opt.incentive ? (
                  <div>
                    <span>Hook</span>
                    <p>{opt.incentive}</p>
                  </div>
                ) : null}
                {opt.destinationList ? (
                  <div>
                    <span>Lands in</span>
                    <p>{opt.destinationList}</p>
                  </div>
                ) : null}
                {opt.url ? (
                  <div className="is-wide">
                    <span>Page</span>
                    <p>
                      <a href={opt.url} target="_blank" rel="noreferrer" className="lh-link">
                        {opt.url} ↗
                      </a>
                    </p>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {adding ? (
        <form className="lh-pb-form lh-pb-subform" onSubmit={(e) => void submit(e)}>
          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>Opt-in name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Exit-Intent 10% Off Popup"
                autoFocus
              />
            </label>
            <label className="lh-field">
              <span>Channel / Type</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {Object.entries(OPT_IN_CHANNEL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="lh-field">
              <span>Incentive / Lead magnet</span>
              <input
                type="text"
                value={incentive}
                onChange={(e) => setIncentive(e.target.value)}
                placeholder="e.g. 10% off first order / Free Buyer's Guide"
              />
            </label>
            <label className="lh-field">
              <span>Destination list / tag / trigger</span>
              <input
                type="text"
                value={destinationList}
                onChange={(e) => setDestinationList(e.target.value)}
                placeholder="e.g. Klaviyo Main List -> Welcome Series"
              />
            </label>
            <label className="lh-field">
              <span>Opt-in conversion rate (optional)</span>
              <input
                type="text"
                value={conversionRate}
                onChange={(e) => setConversionRate(e.target.value)}
                placeholder="e.g. 4.8%"
              />
            </label>
            <label className="lh-field">
              <span>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AccountOptInMethod["status"])}
              >
                <option value="live">Live</option>
                <option value="testing">Testing</option>
                <option value="draft">Draft</option>
                <option value="paused">Paused</option>
              </select>
            </label>
          </div>
          <label className="lh-field">
            <span>URL where it appears</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          {error ? <p className="lh-error">{error}</p> : null}
          <div className="lh-pb-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Adding…" : "Add opt-in method"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lh-checklist-add"
          onClick={() => setAdding(true)}
        >
          + Add opt-in method
        </button>
      )}
    </HubFoldCard>
  );
}

function MonthGrid({ items }: { items: AccountCalendarItem[] }) {
  const dated = items.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.plannedDate));
  const first = dated.map((item) => item.plannedDate).sort()[0];
  const initial = first ? first.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(initial);
  const [selected, setSelected] = useState(first || "");
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(year, mon - 1, 1);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const lead = start.getDay();
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function shift(delta: number) {
    const next = new Date(year, mon - 1 + delta, 1);
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setMonth(key);
    setSelected("");
  }

  function ymd(day: number) {
    return `${month}-${String(day).padStart(2, "0")}`;
  }

  const selectedItems = items.filter((item) => item.plannedDate === selected);
  const undated = items.filter((item) => !item.plannedDate);

  return (
    <div className="lh-cal">
      <div className="lh-cal-board">
        <div className="lh-cal-head">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <h3>{label}</h3>
          <button type="button" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="lh-cal-weekdays">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="lh-cal-grid">
          {cells.map((day, i) => {
            if (!day) return <div key={`e-${i}`} className="lh-cal-day is-empty" />;
            const key = ymd(day);
            const dayItems = items.filter((item) => item.plannedDate === key);
            return (
              <button
                key={key}
                type="button"
                className={`lh-cal-day${selected === key ? " is-on" : ""}${dayItems.length ? " has-work" : ""}`}
                onClick={() => setSelected(key)}
              >
                <b>{day}</b>
                {dayItems.slice(0, 3).map((item) => (
                  <em key={item.id}>{item.title}</em>
                ))}
              </button>
            );
          })}
        </div>
      </div>
      <aside className="lh-cal-aside">
        <p className="lh-cal-aside-kicker">
          {selected ? prettyDate(selected) : "This month"}
        </p>
        {selectedItems.length === 0 ? (
          <p className="lh-card-note">Nothing scheduled on this day.</p>
        ) : (
          selectedItems.map((item) => (
            <article key={item.id}>
              <h4>{item.title}</h4>
              {item.audienceOrTarget ? <p>{item.audienceOrTarget}</p> : null}
              {item.offerOrVariable ? <p>{item.offerOrVariable}</p> : null}
              {item.notes ? <p>{item.notes}</p> : null}
            </article>
          ))
        )}
        {undated.length > 0 ? (
          <div className="lh-cal-undated">
            <p className="lh-cal-aside-kicker">Not dated yet</p>
            {undated.map((item) => (
              <p key={item.id}>{item.title}</p>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function CalendarCard({
  clientId,
  kind,
  title,
  subtitle,
  items,
  onChanged,
}: {
  clientId: string;
  kind: "campaign" | "testing";
  title: string;
  subtitle: string;
  items: AccountCalendarItem[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [audienceOrTarget, setAudienceOrTarget] = useState("");
  const [offerOrVariable, setOfferOrVariable] = useState("");
  const [status, setStatus] = useState<AccountCalendarItem["status"]>("planned");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!itemTitle.trim()) {
      setError("Add a title.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "calendar",
          calendarKind: kind,
          title: itemTitle,
          plannedDate,
          audienceOrTarget,
          offerOrVariable,
          status,
          notes,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not add item.");
        return;
      }
      setItemTitle("");
      setPlannedDate("");
      setAudienceOrTarget("");
      setOfferOrVariable("");
      setStatus("planned");
      setNotes("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, nextStatus: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "calendar", id, status: nextStatus }),
    });
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook?section=calendar&id=${id}`, {
      method: "DELETE",
    });
    onChanged();
  }

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title={title}
      actions={
        <span className="muted">
          {items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "Empty"}
        </span>
      }
    >
      <p className="lh-card-note">{subtitle}</p>
      {kind === "campaign" || kind === "testing" ? <MonthGrid items={items} /> : null}
      {items.length > 0 && kind !== "campaign" && kind !== "testing" ? (
        <ul className="lh-pb-cal-list">
          {items.map((item) => (
            <li key={item.id} className="lh-pb-cal-row">
              <span className="lh-pb-cal-date">
                {item.plannedDate ? prettyDate(item.plannedDate) : "TBD"}
              </span>
              <div className="lh-pb-cal-main">
                <strong>{item.title}</strong>
                {(item.audienceOrTarget || item.offerOrVariable || item.notes) ? (
                  <span className="lh-pb-cal-sub">
                    {[item.audienceOrTarget, item.offerOrVariable, item.notes]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <select
                className="lh-pb-status-select"
                value={item.status}
                onChange={(e) => void changeStatus(item.id, e.target.value)}
                aria-label={`Status for ${item.title}`}
              >
                <option value="planned">Planned</option>
                <option value="drafting">Drafting</option>
                <option value="in_review">In review</option>
                <option value="scheduled">Scheduled</option>
                <option value="sent">Sent</option>
                <option value="completed">Completed</option>
              </select>
              <button
                type="button"
                className="lh-todo-remove"
                onClick={() => void remove(item.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <form className="lh-pb-form lh-pb-subform" onSubmit={(e) => void submit(e)}>
          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>{kind === "campaign" ? "Campaign topic / title" : "Test name / hypothesis"}</span>
              <input
                type="text"
                value={itemTitle}
                onChange={(e) => setItemTitle(e.target.value)}
                placeholder={
                  kind === "campaign"
                    ? "e.g. October Fall Maintenance Broadcast"
                    : "e.g. Welcome Email #1 — Short vs Story Hook"
                }
                autoFocus
              />
            </label>
            <label className="lh-field">
              <span>Planned date</span>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </label>
            <label className="lh-field">
              <span>{kind === "campaign" ? "Segment / Audience" : "Target flow or campaign"}</span>
              <input
                type="text"
                value={audienceOrTarget}
                onChange={(e) => setAudienceOrTarget(e.target.value)}
                placeholder={
                  kind === "campaign"
                    ? "e.g. 90-day engaged + past customers"
                    : "e.g. Abandoned Checkout Flow"
                }
              />
            </label>
            <label className="lh-field">
              <span>{kind === "campaign" ? "Offer / CTA" : "Variable under test"}</span>
              <input
                type="text"
                value={offerOrVariable}
                onChange={(e) => setOfferOrVariable(e.target.value)}
                placeholder={
                  kind === "campaign"
                    ? "e.g. $50 Off Seasonal Checkup"
                    : "e.g. Subject line curiosity vs urgency"
                }
              />
            </label>
          </div>
          <label className="lh-field">
            <span>Notes</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Angle, creative notes, or success metric…"
            />
          </label>
          {error ? <p className="lh-error">{error}</p> : null}
          <div className="lh-pb-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Adding…" : kind === "campaign" ? "Add to campaign calendar" : "Add to testing calendar"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lh-checklist-add"
          onClick={() => setAdding(true)}
        >
          + {kind === "campaign" ? "Add campaign to calendar" : "Add test to calendar"}
        </button>
      )}
    </HubFoldCard>
  );
}

function AbTestingLogCard({
  clientId,
  tests,
  onChanged,
}: {
  clientId: string;
  tests: AccountAbTest[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [campaignOrFlow, setCampaignOrFlow] = useState("");
  const [variable, setVariable] = useState("subject_line");
  const [hypothesis, setHypothesis] = useState("");
  const [variantA, setVariantA] = useState("");
  const [variantB, setVariantB] = useState("");
  const [metric, setMetric] = useState("open_rate");
  const [resultA, setResultA] = useState("");
  const [resultB, setResultB] = useState("");
  const [winner, setWinner] = useState<AccountAbTest["winner"]>("pending");
  const [takeaway, setTakeaway] = useState("");
  const [testedOn, setTestedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draftResultA, setDraftResultA] = useState("");
  const [draftResultB, setDraftResultB] = useState("");
  const [draftWinner, setDraftWinner] = useState<AccountAbTest["winner"]>("pending");
  const [draftTakeaway, setDraftTakeaway] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Add a test title.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "ab_test",
          title,
          campaignOrFlow,
          variable,
          hypothesis,
          variantA,
          variantB,
          metric,
          resultA,
          resultB,
          winner,
          takeaway,
          testedOn,
          status: winner !== "pending" ? "completed" : "running",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Could not log A/B test.");
        return;
      }
      setTitle("");
      setCampaignOrFlow("");
      setVariable("subject_line");
      setHypothesis("");
      setVariantA("");
      setVariantB("");
      setMetric("open_rate");
      setResultA("");
      setResultB("");
      setWinner("pending");
      setTakeaway("");
      setTestedOn("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function startEditing(t: AccountAbTest) {
    setEditingId(t.id);
    setDraftResultA(t.resultA);
    setDraftResultB(t.resultB);
    setDraftWinner(t.winner);
    setDraftTakeaway(t.takeaway);
  }

  async function saveResults(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "ab_test",
        id,
        resultA: draftResultA,
        resultB: draftResultB,
        winner: draftWinner,
        takeaway: draftTakeaway,
        status: draftWinner !== "pending" ? "completed" : "running",
      }),
    });
    setEditingId("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/lifecycle/hub/${clientId}/playbook?section=ab_test&id=${id}`, {
      method: "DELETE",
    });
    onChanged();
  }

  const completedCount = tests.filter((t) => t.winner !== "pending" || t.status === "completed").length;

  return (
    <HubFoldCard
      open
      className="lh-playbook-card"
      title="Results"
      actions={
        <span className="muted">
          {tests.length
            ? `${completedCount} with results · ${tests.length} total`
            : "No tests logged"}
        </span>
      }
    >
      {tests.length === 0 && !adding ? (
        <p className="lh-card-note">
          Log every A/B experiment on this account — variants A vs B, open/click/conversion results, winning variant, and key takeaway.
        </p>
      ) : (
        <div className="lh-pb-stack">
          {tests.map((t) => {
            const isEditing = editingId === t.id;
            return (
              <article key={t.id} className="lh-pb-item lh-ab-card">
                <div className="lh-pb-item-head">
                  <div className="lh-pb-title-row">
                    <span className="lh-pb-tag">
                      {AB_VARIABLE_LABELS[t.variable] || t.variable}
                    </span>
                    <h4>{t.title}</h4>
                    <span className={`lh-ab-winner is-${t.winner}`}>
                      {WINNER_LABELS[t.winner]}
                    </span>
                  </div>
                  <div className="lh-pb-item-controls">
                    {!isEditing ? (
                      <button
                        type="button"
                        className="lh-link"
                        onClick={() => startEditing(t)}
                      >
                        Update results
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="lh-todo-remove"
                      onClick={() => void remove(t.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {(t.campaignOrFlow || t.testedOn || t.metric) ? (
                  <p className="lh-pb-meta">
                    {[
                      t.campaignOrFlow,
                      AB_METRIC_LABELS[t.metric] ? `Metric: ${AB_METRIC_LABELS[t.metric]}` : "",
                      t.testedOn ? prettyDate(t.testedOn) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}

                {t.hypothesis ? (
                  <p className="lh-pb-body">
                    <strong>Hypothesis:</strong> {t.hypothesis}
                  </p>
                ) : null}

                <div className="lh-ab-variants">
                  <div className={`lh-ab-variant ${t.winner === "a" ? "is-winner" : ""}`}>
                    <span className="lh-ab-var-label">Variant A</span>
                    <p>{t.variantA || "—"}</p>
                    <strong className="lh-ab-var-res">{t.resultA || "No result yet"}</strong>
                  </div>
                  <div className={`lh-ab-variant ${t.winner === "b" ? "is-winner" : ""}`}>
                    <span className="lh-ab-var-label">Variant B</span>
                    <p>{t.variantB || "—"}</p>
                    <strong className="lh-ab-var-res">{t.resultB || "No result yet"}</strong>
                  </div>
                </div>

                {t.takeaway && !isEditing ? (
                  <p className="lh-ab-takeaway">
                    <strong>Takeaway:</strong> {t.takeaway}
                  </p>
                ) : null}

                {isEditing ? (
                  <div className="lh-pb-form lh-pb-subform">
                    <div className="lh-pb-grid-3">
                      <label className="lh-field">
                        <span>Variant A result</span>
                        <input
                          type="text"
                          value={draftResultA}
                          onChange={(e) => setDraftResultA(e.target.value)}
                          placeholder="e.g. 42.1% open (184 clicks)"
                        />
                      </label>
                      <label className="lh-field">
                        <span>Variant B result</span>
                        <input
                          type="text"
                          value={draftResultB}
                          onChange={(e) => setDraftResultB(e.target.value)}
                          placeholder="e.g. 48.6% open (230 clicks)"
                        />
                      </label>
                      <label className="lh-field">
                        <span>Winner</span>
                        <select
                          value={draftWinner}
                          onChange={(e) =>
                            setDraftWinner(e.target.value as AccountAbTest["winner"])
                          }
                        >
                          <option value="pending">Pending</option>
                          <option value="a">Variant A won</option>
                          <option value="b">Variant B won</option>
                          <option value="tie">Tie</option>
                          <option value="inconclusive">Inconclusive</option>
                        </select>
                      </label>
                    </div>
                    <label className="lh-field">
                      <span>Key learning / Takeaway</span>
                      <input
                        type="text"
                        value={draftTakeaway}
                        onChange={(e) => setDraftTakeaway(e.target.value)}
                        placeholder="What did we learn and how will we apply it to future sends?"
                      />
                    </label>
                    <div className="lh-pb-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void saveResults(t.id)}
                      >
                        Save results
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingId("")}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {adding ? (
        <form className="lh-pb-form lh-pb-subform" onSubmit={(e) => void submit(e)}>
          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>Test name</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Question vs Direct Benefit Subject Line"
                autoFocus
              />
            </label>
            <label className="lh-field">
              <span>Campaign or Flow</span>
              <input
                type="text"
                value={campaignOrFlow}
                onChange={(e) => setCampaignOrFlow(e.target.value)}
                placeholder="e.g. October Newsletter #2 / Welcome Flow Email 1"
              />
            </label>
            <label className="lh-field">
              <span>Variable tested</span>
              <select value={variable} onChange={(e) => setVariable(e.target.value)}>
                {Object.entries(AB_VARIABLE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="lh-field">
              <span>Primary metric</span>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                {Object.entries(AB_METRIC_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="lh-field">
            <span>Hypothesis</span>
            <input
              type="text"
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="e.g. Using a local city callout in the subject line will lift open rate by 5%+"
            />
          </label>

          <div className="lh-pb-grid-2">
            <label className="lh-field">
              <span>Variant A (Control)</span>
              <input
                type="text"
                value={variantA}
                onChange={(e) => setVariantA(e.target.value)}
                placeholder="Control subject line / offer / creative"
              />
            </label>
            <label className="lh-field">
              <span>Variant B (Challenger)</span>
              <input
                type="text"
                value={variantB}
                onChange={(e) => setVariantB(e.target.value)}
                placeholder="Challenger subject line / offer / creative"
              />
            </label>
            <label className="lh-field">
              <span>Variant A result (optional)</span>
              <input
                type="text"
                value={resultA}
                onChange={(e) => setResultA(e.target.value)}
                placeholder="e.g. 38.4% open · 2.1% click"
              />
            </label>
            <label className="lh-field">
              <span>Variant B result (optional)</span>
              <input
                type="text"
                value={resultB}
                onChange={(e) => setResultB(e.target.value)}
                placeholder="e.g. 44.9% open · 3.0% click"
              />
            </label>
            <label className="lh-field">
              <span>Winner</span>
              <select
                value={winner}
                onChange={(e) => setWinner(e.target.value as AccountAbTest["winner"])}
              >
                <option value="pending">Running / Pending</option>
                <option value="a">Variant A won</option>
                <option value="b">Variant B won</option>
                <option value="tie">Tie</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
            </label>
            <label className="lh-field">
              <span>Date tested</span>
              <input
                type="date"
                value={testedOn}
                onChange={(e) => setTestedOn(e.target.value)}
              />
            </label>
          </div>

          <label className="lh-field">
            <span>Takeaway / Next step</span>
            <input
              type="text"
              value={takeaway}
              onChange={(e) => setTakeaway(e.target.value)}
              placeholder="What did we learn from this test?"
            />
          </label>

          {error ? <p className="lh-error">{error}</p> : null}
          <div className="lh-pb-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Logging…" : "Log A/B test"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lh-checklist-add"
          onClick={() => setAdding(true)}
        >
          + Log A/B test
        </button>
      )}
    </HubFoldCard>
  );
}
