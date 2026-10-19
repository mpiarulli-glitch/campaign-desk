"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountSnapshot, CombinedSnapshot, DashboardPayload, Preset } from "@/lib/klaviyo-revenue/types";
import { addDays } from "@/lib/klaviyo-revenue/window";
import { AccountsDialog } from "./AccountsDialog";
import { countDelta, formatCount, formatMoney, formatRate, formatWhen, rateDelta } from "./format";
import { TrendChart } from "./TrendChart";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "custom", label: "Custom" },
];

export function KlaviyoRevenueDashboard() {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>("30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(
    async (refresh = false) => {
      if (preset === "custom" && (!customStart || !customEnd)) return;
      if (refresh || dataRef.current) setRefreshing(true);
      else setLoading(true);
      setError("");
      const params = new URLSearchParams({ preset });
      if (preset === "custom") {
        params.set("start", customStart);
        params.set("end", customEnd);
      }
      if (refresh) params.set("refresh", "1");
      try {
        const res = await fetch(`/api/klaviyo-revenue?${params.toString()}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error || "Could not load Klaviyo.");
          return;
        }
        setData(body as DashboardPayload);
      } catch {
        setError("Could not load Klaviyo.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [preset, customStart, customEnd, router]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const selected = data?.accounts.find((account) => account.id === selectedId) ?? null;
  const view = data ? viewOf(data, selected) : null;

  function choosePreset(next: Preset) {
    if (next === "custom" && data && !customStart) {
      setCustomStart(data.window.start);
      setCustomEnd(addDays(data.window.end, -1));
    }
    setPreset(next);
  }

  const showEmpty = Boolean(data && !data.demo && data.accounts.length === 0);

  return (
    <div className="kr" aria-busy={loading || refreshing}>
      <header className="kr-hero">
        <div>
          <p className="kr-kicker">Marketing Empire Group</p>
          <h1>Klaviyo</h1>
          <p className="kr-lead">
            Bookings, form fills, email revenue, and the appointments a text brought back. Every connected account,
            then one account at a time.
          </p>
        </div>
        <div className="kr-hero-actions">
          <p className="kr-updated">
            {data?.fetchedAt ? `Updated ${formatWhen(data.fetchedAt)}` : "Not loaded yet"}
            {data?.fromCache ? " · cached" : ""}
            {data?.stale ? " · last good refresh" : ""}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(true)} disabled={refreshing || loading}>
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          {data?.canManage ? (
            <button type="button" className="btn btn-sm" onClick={() => setAccountsOpen(true)}>
              Accounts
            </button>
          ) : null}
        </div>
      </header>

      <div className="kr-controls">
        <div className="kr-seg" role="group" aria-label="Date window">
          {PRESETS.map((item) => (
            <button key={item.id} type="button" aria-pressed={preset === item.id} onClick={() => choosePreset(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="kr-dates">
            <label>
              <span className="sr-only">Start date</span>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <label>
              <span className="sr-only">End date</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
          </div>
        ) : (
          <p className="kr-updated">{data ? `${data.window.label} · vs the previous ${data.window.dayCount} days` : ""}</p>
        )}
      </div>

      {data?.demo ? (
        <div className="kr-banner">
          Sample data for four accounts, including two with no booking metric. Add a private API key under Accounts to
          replace it. Set <code>KLAVIYO_REVENUE_DEMO=1</code> only while no real accounts are connected.
        </div>
      ) : null}
      {error ? <div className="kr-note">{error}</div> : null}

      {loading && !data ? (
        <div className="kr-kpis" aria-hidden="true">
          <div className="kr-skel" />
          <div className="kr-skel" />
          <div className="kr-skel" />
          <div className="kr-skel" />
          <div className="kr-skel short" />
          <div className="kr-skel short" />
        </div>
      ) : null}

      {showEmpty ? (
        <div className="kr-empty">
          <h2>Connect the first account</h2>
          <p className="kr-lead">
            This is the one view across every Klaviyo account. Add a private key and the booking, form, and revenue
            metrics are picked from their names. If an account has no appointment event, bookings stay blank instead of
            showing a fake zero.
          </p>
          {data?.canManage ? (
            <button type="button" className="btn" onClick={() => setAccountsOpen(true)}>
              Add a Klaviyo account
            </button>
          ) : (
            <p>Ask Michael to connect the account keys.</p>
          )}
        </div>
      ) : null}

      {data && view && !showEmpty ? (
        <>
          {selected ? (
            <div className="kr-context">
              <button type="button" className="kr-chip" onClick={() => setSelectedId(null)}>
                All accounts
              </button>
              <strong>{selected.name}</strong>
              <span className="kr-meta">{selected.timezone}</span>
              {selected.error ? <span className="kr-error">{selected.error}</span> : null}
            </div>
          ) : null}

          <section className="kr-kpis" aria-label="Totals">
            <Kpi
              label="Booked appointments"
              info={data.method.booking}
              open={info === "booking"}
              onInfo={() => setInfo(info === "booking" ? null : "booking")}
              blank={view.booking.blank}
              value={view.booking.blank ? "Not tracked yet" : formatCount(view.booking.value)}
              detail={view.booking.detail}
              delta={view.booking.blank ? null : countDelta(view.booking.value, view.booking.previous)}
              foot={view.booking.foot}
            />
            <Kpi
              label="Form fills"
              info={data.method.forms}
              open={info === "forms"}
              onInfo={() => setInfo(info === "forms" ? null : "forms")}
              blank={view.forms.blank}
              value={view.forms.blank ? "Not tracked yet" : formatCount(view.forms.value)}
              detail={view.forms.detail}
              delta={view.forms.blank ? null : countDelta(view.forms.value, view.forms.previous)}
              foot={view.forms.foot}
            />
            <Kpi
              label="Email results"
              money
              info={data.method.email}
              open={info === "email"}
              onInfo={() => setInfo(info === "email" ? null : "email")}
              blank={view.email.blank}
              value={view.email.blank ? "Not tracked yet" : view.email.primary}
              detail={view.email.detail}
              delta={view.email.blank ? null : countDelta(view.email.revenue, view.email.previous)}
              foot={view.email.foot}
            />
            <Kpi
              label="SMS recovered"
              info={data.method.sms}
              open={info === "sms"}
              onInfo={() => setInfo(info === "sms" ? null : "sms")}
              blank={view.sms.blank}
              value={view.sms.blank ? "Not tracked yet" : formatCount(view.sms.recovered)}
              detail={view.sms.detail}
              delta={view.sms.blank ? null : countDelta(view.sms.recovered, view.sms.previous)}
              foot={view.sms.foot}
            />
          </section>

          <div className="kr-split">
            <section className="kr-panel">
              <TrendChart series={view.series} currency={view.currency} />
            </section>
            <section className="kr-panel">
              <div className="kr-panel-head">
                <h2>Form to booking</h2>
              </div>
              <Funnel sms={view.funnel} forms={view.forms} currency={view.currency} />
            </section>
          </div>

          {selected ? <DrillDown account={selected} currency={selected.currency} /> : null}

          <section className="kr-panel">
            <div className="kr-panel-head">
              <h2>Accounts</h2>
              <p>Select a row to open that account.</p>
            </div>
            <div className="kr-table-wrap">
              <table className="kr-table">
                <caption className="sr-only">Klaviyo accounts ranked by email revenue</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Booked</th>
                    <th scope="col">Forms</th>
                    <th scope="col">Email</th>
                    <th scope="col">SMS recovered</th>
                    <th scope="col">Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.accounts]
                    .sort((a, b) => (b.email.revenue ?? -1) - (a.email.revenue ?? -1))
                    .map((account) => (
                      <tr
                        key={account.id}
                        aria-selected={account.id === selectedId}
                        tabIndex={0}
                        onClick={() => setSelectedId(account.id === selectedId ? null : account.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedId(account.id === selectedId ? null : account.id);
                          }
                        }}
                      >
                        <td>
                          <div className="kr-name">{account.name}</div>
                          <div className="kr-meta">{account.error ? account.error : account.timezone}</div>
                        </td>
                        <td>{cellCount(account.booking.status, account.booking.count)}</td>
                        <td>{cellCount(account.forms.status, account.forms.count)}</td>
                        <td>
                          {account.email.status === "value" && account.email.revenue != null
                            ? formatMoney(account.email.revenue, account.currency)
                            : <span className="kr-muted">Not tracked</span>}
                        </td>
                        <td>{cellCount(account.sms.status, account.sms.recovered)}</td>
                        <td>
                          {account.sms.status === "untracked" ? (
                            <span className="kr-muted">Not tracked</span>
                          ) : (
                            formatRate(account.sms.recoveryRate)
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.notes.length ? (
            <ul className="kr-list">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {accountsOpen ? (
        <AccountsDialog
          onClose={() => setAccountsOpen(false)}
          onChanged={() => void load(true)}
        />
      ) : null}
    </div>
  );
}

function cellCount(status: string, value: number | null) {
  if (status === "untracked" || value == null) return <span className="kr-muted">Not tracked</span>;
  return formatCount(value);
}

function Kpi({
  label,
  value,
  detail,
  delta,
  foot,
  info,
  open,
  onInfo,
  blank,
  money,
}: {
  label: string;
  value: string;
  detail: string;
  delta: { text: string; tone: "up" | "down" | "flat" | "na" } | null;
  foot: string;
  info: string;
  open: boolean;
  onInfo: () => void;
  blank?: boolean;
  money?: boolean;
}) {
  return (
    <article className={`kr-kpi${blank ? " is-blank" : ""}${money ? " is-money" : ""}`}>
      <div className="kr-kpi-label">
        {label}
        <span className="kr-info">
          <button type="button" className="kr-info-btn" aria-expanded={open} aria-label={`How ${label} is calculated`} onClick={onInfo}>
            i
          </button>
          {open ? <span role="tooltip" className="kr-tip">{info}</span> : null}
        </span>
      </div>
      <strong>{value}</strong>
      {detail ? <em>{detail}</em> : null}
      {delta ? <span className={`kr-delta ${delta.tone}`}>{delta.text}</span> : null}
      {foot ? <p className="kr-foot">{foot}</p> : null}
    </article>
  );
}

function Funnel({
  sms,
  forms,
  currency,
}: {
  sms: CombinedSnapshot["sms"] | AccountSnapshot["sms"];
  forms: { blank: boolean; value: number };
  currency: string | null;
}) {
  if (sms.status === "untracked" || sms.recovered == null) {
    return (
      <div className="kr-callout">
        SMS recovery is not tracked yet. It needs a form metric, a booked-appointment metric, and a received-text
        metric on the same account. Form fills {forms.blank ? "are not tracked either" : `are ${formatCount(forms.value)}`}.
      </div>
    );
  }
  const fills = sms.formFills;
  const grossAbandoned = sms.abandoned + sms.recovered;
  const width = (value: number) => `${fills > 0 ? Math.max(4, Math.round((value / fills) * 100)) : 0}%`;
  return (
    <div className="kr-funnel">
      <FunnelRow label="Form fills" value={formatCount(fills)} width="100%" kind="ink" />
      <FunnelRow label="Booked direct" value={formatCount(sms.directBookings)} width={width(sms.directBookings)} kind="accent" />
      <FunnelRow label="Abandoned" value={formatCount(grossAbandoned)} width={width(grossAbandoned)} kind="ink" />
      <FunnelRow label="Recovered" value={formatCount(sms.recovered)} width={width(sms.recovered)} kind="warn" />
      <p className="kr-foot">
        Recovery rate {formatRate(sms.recoveryRate)} of abandoned fills.
        {sms.attributedValue != null ? ` Attributed value ${formatMoney(sms.attributedValue, currency)} on the booking event.` : ""}
        {sms.flowAttributedBookings != null
          ? ` Klaviyo SMS flows attribute ${formatCount(sms.flowAttributedBookings)} bookings (${formatMoney(sms.flowAttributedValue ?? 0, currency)}) in this window, including texts that did not follow a form.`
          : ""}
        {sms.truncated ? " This count stopped early at the event cap." : ""}
        {"untrackedNames" in sms && sms.untrackedNames.length
          ? ` Does not include ${sms.untrackedNames.join(", ")}.`
          : ""}
      </p>
    </div>
  );
}

function FunnelRow({ label, value, width, kind }: { label: string; value: string; width: string; kind: "ink" | "accent" | "warn" }) {
  return (
    <div className="kr-funnel-row">
      <span>{label}</span>
      <span className={`kr-bar ${kind}`}><i style={{ width }} /></span>
      <b>{value}</b>
    </div>
  );
}

function DrillDown({ account, currency }: { account: AccountSnapshot; currency: string }) {
  return (
    <section className="kr-panel">
      <div className="kr-panel-head">
        <h2>{account.name}</h2>
        <p>Mapped metrics</p>
      </div>
      <div className="kr-pills">
        <span className="kr-pill">Booking: {account.booking.metricName || "Not tracked"}</span>
        <span className="kr-pill">Form: {account.forms.metricName || "Not tracked"}</span>
        <span className="kr-pill">Email conversion: {account.email.metricName || "Not tracked"}</span>
        <span className="kr-pill">Text: {account.sms.metricName || "Not tracked"}</span>
      </div>
      {account.booking.status === "untracked" ? (
        <p className="kr-callout" style={{ marginTop: 12 }}>
          Booked appointments are not tracked on {account.name}. Map the custom metric from the booking tool, GoHighLevel,
          or the API under Accounts. Until then this account stays out of the booking total.
        </p>
      ) : null}
      <div className="kr-two" style={{ marginTop: 14 }}>
        <div>
          <h3 className="kr-section-title">Email campaigns</h3>
          <ReportList rows={account.email.campaigns} currency={currency} empty="No email campaign value in this window." />
        </div>
        <div>
          <h3 className="kr-section-title">Email flows</h3>
          <ReportList rows={account.email.flows} currency={currency} empty="No email flow value in this window." />
        </div>
      </div>
      {account.warnings.length ? (
        <ul className="kr-list">
          {account.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReportList({
  rows,
  currency,
  empty,
}: {
  rows: AccountSnapshot["email"]["campaigns"];
  currency: string;
  empty: string;
}) {
  if (!rows.length) return <p className="kr-foot">{empty}</p>;
  return (
    <ul className="kr-list">
      {rows.map((row) => (
        <li key={row.id}>
          <span>{row.name}</span>
          <b>
            {formatMoney(row.revenue, currency)} · {formatCount(row.conversions)}
          </b>
        </li>
      ))}
    </ul>
  );
}

type NumView = { blank: boolean; value: number; previous: number | null; detail: string; foot: string };

function viewOf(data: DashboardPayload, selected: AccountSnapshot | null) {
  if (selected) {
    const smsBlank = selected.sms.status === "untracked" || selected.sms.recovered == null;
    return {
      currency: selected.currency,
      series: seriesFromAccount(selected),
      funnel: selected.sms,
      booking: numView(
        selected.booking.status !== "value" || selected.booking.count == null,
        selected.booking.count ?? 0,
        selected.booking.previous,
        selected.booking.metricName || "",
        selected.booking.emailAttributed != null ? `${formatCount(selected.booking.emailAttributed)} attributed to email` : ""
      ),
      forms: numView(
        selected.forms.status !== "value" || selected.forms.count == null,
        selected.forms.count ?? 0,
        selected.forms.previous,
        selected.forms.metricName || "",
        ""
      ),
      email: {
        blank: selected.email.status !== "value" || selected.email.revenue == null,
        revenue: selected.email.revenue,
        previous: selected.email.previousRevenue,
        primary: selected.email.revenue == null ? "" : formatMoney(selected.email.revenue, selected.currency),
        detail: selected.email.conversions == null ? "" : `${formatCount(selected.email.conversions)} conversions · ${selected.email.metricName || "conversion"}`,
        foot: "",
      },
      sms: {
        blank: smsBlank,
        recovered: selected.sms.recovered ?? 0,
        previous: selected.sms.previousRecovered,
        detail: smsBlank ? "" : `${formatRate(selected.sms.recoveryRate)} of abandoned · ${formatMoney(selected.sms.attributedValue ?? 0, selected.currency)}`,
        foot: smsBlank ? "Needs a booking metric, a form metric, and a received-text metric." : rateDelta(selected.sms.recoveryRate, selected.sms.previousRecoveryRate).text,
      },
    };
  }
  const combined = data.combined;
  const names = (list: string[]) => (list.length ? `${list.join(", ")} not tracked` : "");
  return {
    currency: combined.currency,
    series: combined.series,
    funnel: combined.sms,
    booking: numView(
      combined.booking.status === "untracked" || combined.booking.count == null,
      combined.booking.count ?? 0,
      combined.booking.previous,
      combined.booking.status === "partial" ? "Partial" : "",
      names(combined.booking.untrackedNames)
    ),
    forms: numView(
      combined.forms.status === "untracked" || combined.forms.count == null,
      combined.forms.count ?? 0,
      combined.forms.previous,
      combined.forms.status === "partial" ? "Partial" : "",
      names(combined.forms.untrackedNames)
    ),
    email: {
      blank: combined.email.status === "untracked",
      revenue: combined.email.revenue,
      previous: combined.email.previousRevenue,
      primary: combined.mixedCurrency
        ? "Mixed currencies"
        : combined.email.revenue == null
          ? ""
          : formatMoney(combined.email.revenue, combined.currency),
      detail: combined.email.conversions == null ? "" : `${formatCount(combined.email.conversions)} conversions${combined.email.emailAttributedBookings != null ? ` · ${formatCount(combined.email.emailAttributedBookings)} email bookings` : ""}`,
      foot: names(combined.email.untrackedNames),
    },
    sms: {
      blank: combined.sms.status === "untracked" || combined.sms.recovered == null,
      recovered: combined.sms.recovered ?? 0,
      previous: combined.sms.previousRecovered,
      detail:
        combined.sms.recovered == null
          ? ""
          : `${formatRate(combined.sms.recoveryRate)} of abandoned${combined.sms.attributedValue != null ? ` · ${formatMoney(combined.sms.attributedValue, combined.currency)}` : ""}`,
      foot: [names(combined.sms.untrackedNames), combined.sms.truncated ? "Partial event pull" : ""].filter(Boolean).join(" · "),
    },
  };
}

function numView(blank: boolean, value: number, previous: number | null, detail: string, foot: string): NumView {
  return { blank, value, previous, detail, foot };
}

function seriesFromAccount(account: AccountSnapshot): CombinedSnapshot["series"] {
  const dates = new Set<string>();
  for (const point of [...account.forms.series, ...account.booking.series, ...account.email.series, ...account.sms.series]) {
    dates.add(point.date);
  }
  return [...dates].sort().map((date) => ({
    date,
    formFills: account.forms.status === "value" ? account.forms.series.find((point) => point.date === date)?.count ?? 0 : null,
    bookings: account.booking.status === "value" ? account.booking.series.find((point) => point.date === date)?.count ?? 0 : null,
    emailRevenue: account.email.status === "value" ? account.email.series.find((point) => point.date === date)?.sumValue ?? 0 : null,
    smsRecovered: account.sms.status !== "untracked" ? account.sms.series.find((point) => point.date === date)?.count ?? 0 : null,
  }));
}
