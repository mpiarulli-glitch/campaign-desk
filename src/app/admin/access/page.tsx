"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  slug: string;
  label: string;
  role: "admin" | "forecast";
  active: boolean;
  lastLoginAt: string | null;
};

type Cap = {
  key: string;
  label: string;
  group: "page" | "tool";
  blurb: string;
  fixed: boolean;
  allowed: boolean;
  byDefault: boolean;
  overridden: boolean;
};

type Detail = {
  person: string;
  role: "admin" | "forecast";
  capabilities: Cap[];
  forecast: {
    stored: string[] | null;
    everyone: boolean;
    subjects: string[];
  };
};

const ROLE_LABEL: Record<Account["role"], string> = {
  admin: "Admin",
  forecast: "User",
};

function fmt(iso: string | null): string {
  if (!iso) return "Never signed in";
  return `Last in ${new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export default function AccessPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [roster, setRoster] = useState<Array<{ slug: string; label: string }>>([]);
  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async (person?: string) => {
    const qs = person ? `?person=${encodeURIComponent(person)}` : "";
    const res = await fetch(`/api/admin/access${qs}`);
    if (res.status === 403) {
      setDenied(true);
      return;
    }
    if (!res.ok) {
      setError("Could not load permissions.");
      return;
    }
    const data = await res.json();
    setAccounts(data.accounts);
    setRoster(data.roster || []);
    if (data.person) setDetail(data as Detail);
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) {
          router.push("/login");
          return;
        }
        load();
      })
      .catch(() => setError("Could not reach the server."));
  }, [router, load]);

  // Pick the first account once the roster lands, so the page opens on somebody
  // rather than on an empty right-hand column.
  useEffect(() => {
    if (!selected && accounts?.length) setSelected(accounts[0].slug);
  }, [accounts, selected]);

  useEffect(() => {
    if (selected) {
      setDetail(null);
      load(selected);
    }
  }, [selected, load]);

  async function post(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setError("");
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: selected, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That did not work.");
      } else {
        setDetail(data as Detail);
        setSaved(new Date().toLocaleTimeString());
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy("");
  }

  const pages = useMemo(
    () => detail?.capabilities.filter((c) => c.group === "page") || [],
    [detail]
  );
  const tools = useMemo(
    () => detail?.capabilities.filter((c) => c.group === "tool") || [],
    [detail]
  );

  const account = accounts?.find((a) => a.slug === selected) || null;
  const changedCount = detail?.capabilities.filter((c) => c.overridden).length || 0;

  if (denied) {
    return (
      <div className="ops-scope">
        <div className="ops-page">
          <div className="ops-page-head">
            <div>
              <p className="ops-eyebrow">Team</p>
              <h1 className="ops-title">Permissions.</h1>
              <p className="ops-sub">
                Only the owner account can change what people can reach. Ask
                Michael if you need something opened up.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Team</p>
            <h1 className="ops-title">Permissions.</h1>
            <p className="ops-sub">
              Pick a person, then decide what they see. Anything left on Default
              follows their role, so it moves with the app instead of freezing
              at whatever today&apos;s answer happens to be.
            </p>
          </div>
          {detail ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={Boolean(busy) || changedCount === 0}
              onClick={() => {
                if (
                  confirm(
                    `Put ${account?.label || selected} back on the default access for their role?`
                  )
                ) {
                  post({ action: "reset" }, "reset");
                }
              }}
            >
              {busy === "reset" ? "Resetting..." : "Reset to default"}
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="ops-panel" style={{ padding: 16, marginBottom: 16 }}>
            <p className="error" style={{ margin: 0 }}>
              {error}
            </p>
          </div>
        ) : null}

        <div className="acc-layout">
          {/* ------------------------------------------------- who ---------- */}
          <div className="ops-panel acc-people">
            <div className="ops-panel-head">
              <h2>People</h2>
            </div>
            <div className="ops-panel-body" style={{ padding: 0 }}>
              {!accounts ? (
                <p className="muted" style={{ padding: 16 }}>
                  Loading...
                </p>
              ) : (
                accounts.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className={`acc-person ${selected === a.slug ? "is-on" : ""}`}
                    onClick={() => setSelected(a.slug)}
                  >
                    <span className="acc-person-name">
                      {a.label}
                      {a.active ? "" : " · disabled"}
                    </span>
                    <span className="acc-person-meta">
                      {ROLE_LABEL[a.role]} · {fmt(a.lastLoginAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ------------------------------------------------ what ---------- */}
          <div className="acc-detail">
            {!detail ? (
              <div className="ops-panel" style={{ padding: 20 }}>
                <p className="muted" style={{ margin: 0 }}>
                  {accounts ? "Loading permissions..." : " "}
                </p>
              </div>
            ) : (
              <>
                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Pages {account ? `· ${account.label}` : ""}</h2>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {changedCount
                        ? `${changedCount} changed from default`
                        : "All on default"}
                      {saved ? ` · saved ${saved}` : ""}
                    </span>
                  </div>
                  <div className="ops-panel-body" style={{ padding: 0 }}>
                    {pages.map((cap) => (
                      <CapRow
                        key={cap.key}
                        cap={cap}
                        busy={busy === cap.key}
                        onSet={(allowed) =>
                          post({ action: "set", capability: cap.key, allowed }, cap.key)
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Tools</h2>
                  </div>
                  <div className="ops-panel-body" style={{ padding: 0 }}>
                    {tools.map((cap) => (
                      <CapRow
                        key={cap.key}
                        cap={cap}
                        busy={busy === cap.key}
                        onSet={(allowed) =>
                          post({ action: "set", capability: cap.key, allowed }, cap.key)
                        }
                      />
                    ))}
                  </div>
                </div>

                <ForecastPanel
                  detail={detail}
                  roster={roster}
                  busy={busy}
                  onEveryone={() => post({ action: "set_forecast", everyone: true }, "fc")}
                  onSubjects={(subjects) =>
                    post({ action: "set_forecast", subjects }, "fc")
                  }
                  onReset={() => post({ action: "reset_forecast" }, "fc")}
                />
              </>
            )}
          </div>
        </div>

        <p className="muted" style={{ marginTop: 16, lineHeight: 1.6 }}>
          Turning a page off hides it from their sidebar and refuses the route
          behind it, so a saved link stops working too. Their own forecast week
          is never taken away, since nothing is protected by hiding it.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- one toggle */

function CapRow({
  cap,
  busy,
  onSet,
}: {
  cap: Cap;
  busy: boolean;
  onSet: (allowed: boolean | null) => void;
}) {
  const state: "on" | "off" | "default" = cap.overridden
    ? cap.allowed
      ? "on"
      : "off"
    : "default";

  // The word the owner is actually looking for, which is what this person can
  // do rather than which button is lit. A page is visible or hidden; a tool is
  // on or off.
  const effective = cap.group === "page"
    ? cap.allowed
      ? "Visible"
      : "Hidden"
    : cap.allowed
      ? "On"
      : "Off";

  return (
    <div className={`acc-row ${cap.fixed ? "is-fixed" : ""}`}>
      <div className="acc-row-copy">
        <strong>{cap.label}</strong>
        <span className="muted">{cap.blurb}</span>
      </div>
      <span className={`acc-state ${cap.allowed ? "is-yes" : "is-no"}`}>
        {effective}
        {cap.overridden ? <em>set by you</em> : null}
      </span>
      {cap.fixed ? (
        <span className="acc-locked">Always {cap.allowed ? "on" : "off"}</span>
      ) : (
        <div className="acc-tri" role="group" aria-label={cap.label}>
          <button
            type="button"
            className={`acc-tri-btn ${state === "default" ? "is-set" : ""}`}
            aria-pressed={state === "default"}
            disabled={busy}
            onClick={() => onSet(null)}
            title={`Follow their role, which is currently ${cap.byDefault ? "on" : "off"}`}
          >
            Default
          </button>
          <button
            type="button"
            className={`acc-tri-btn ${state === "on" ? "is-yes" : ""}`}
            aria-pressed={state === "on"}
            disabled={busy}
            onClick={() => onSet(true)}
          >
            Allow
          </button>
          <button
            type="button"
            className={`acc-tri-btn ${state === "off" ? "is-no" : ""}`}
            aria-pressed={state === "off"}
            disabled={busy}
            onClick={() => onSet(false)}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ forecast visibility */

function ForecastPanel({
  detail,
  roster,
  busy,
  onEveryone,
  onSubjects,
  onReset,
}: {
  detail: Detail;
  roster: Array<{ slug: string; label: string }>;
  busy: string;
  onEveryone: () => void;
  onSubjects: (subjects: string[]) => void;
  onReset: () => void;
}) {
  const { stored, everyone, subjects } = detail.forecast;
  const mode: "default" | "everyone" | "picked" =
    stored === null ? "default" : everyone ? "everyone" : "picked";
  const working = busy === "fc";

  function toggle(slug: string) {
    const next = subjects.includes(slug)
      ? subjects.filter((s) => s !== slug)
      : [...subjects, slug];
    onSubjects(next);
  }

  return (
    <div className="ops-panel">
      <div className="ops-panel-head">
        <h2>Whose forecast they can see</h2>
      </div>
      <div className="ops-panel-body">
        <div className="acc-tri" role="group" aria-label="Forecast visibility" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`acc-tri-btn ${mode === "default" ? "is-set" : ""}`}
            aria-pressed={mode === "default"}
            disabled={working}
            onClick={onReset}
            title={
              detail.role === "admin"
                ? "Admins see the whole team by default"
                : "Users see only their own week by default"
            }
          >
            Default
          </button>
          <button
            type="button"
            className={`acc-tri-btn ${mode === "everyone" ? "is-yes" : ""}`}
            aria-pressed={mode === "everyone"}
            disabled={working}
            onClick={onEveryone}
          >
            Everyone
          </button>
          <button
            type="button"
            className={`acc-tri-btn ${mode === "picked" ? "is-yes" : ""}`}
            aria-pressed={mode === "picked"}
            disabled={working}
            onClick={() => onSubjects([detail.person])}
          >
            Only the people I pick
          </button>
        </div>

        {mode === "everyone" ? (
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            They can open any person&apos;s week and the team wide board.
          </p>
        ) : mode === "default" ? (
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {detail.role === "admin"
              ? "Following the admin default, which is every person."
              : "Following the user default, which is their own week only."}
          </p>
        ) : (
          <>
            <div className="acc-chips">
              {roster.map((p) => {
                const on = subjects.includes(p.slug);
                const self = p.slug === detail.person;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    className={`acc-chip ${on ? "is-on" : ""}`}
                    aria-pressed={on}
                    disabled={working || self}
                    onClick={() => toggle(p.slug)}
                    title={self ? "Their own week is always visible" : undefined}
                  >
                    {p.label}
                    {self ? " (them)" : ""}
                  </button>
                );
              })}
            </div>
            <p className="muted" style={{ marginBottom: 0, lineHeight: 1.6 }}>
              {subjects.length === 1
                ? "Their own week only."
                : `${subjects.length} people, their own week included.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
