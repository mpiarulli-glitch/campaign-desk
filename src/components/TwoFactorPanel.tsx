"use client";

// The whole authenticator app dance in one place, because the setup wizard and
// the security page need exactly the same thing: scan, confirm, write down the
// backup codes. The only difference is what happens afterwards, which is the
// onEnabled callback.

import { FormEvent, useCallback, useEffect, useState } from "react";

export type TotpStatus = {
  label: string;
  enabled: boolean;
  enabledAt: string | null;
  pending: boolean;
  backupCodesRemaining: number;
  hasPassword: boolean;
};

type Enrollment = {
  secret: string;
  manualEntry: string;
  otpauthUrl: string;
  qr: string;
};

function BackupCodes({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[];
  onDone: () => void;
  doneLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div>
        <p className="eyebrow">Two-factor is on</p>
        <h2 style={{ margin: "4px 0 0" }}>Save your backup codes</h2>
        <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
          Each of these signs you in once if your phone is lost or wiped. This is
          the only time they are shown, so put them somewhere safe before you
          carry on.
        </p>
      </div>
      <div className="totp-codes">
        {codes.map((c) => (
          <code key={c} className="totp-code">
            {c}
          </code>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? "Copied" : "Copy all"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </>
  );
}

export function TwoFactorPanel({
  onEnabled,
  doneLabel = "I have saved them",
  allowDisable = true,
}: {
  onEnabled?: () => void;
  doneLabel?: string;
  allowDisable?: boolean;
}) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [blocked, setBlocked] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/totp");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBlocked(data.error || "Sign in as yourself to manage this.");
        return;
      }
      setStatus(data);
    } catch {
      setBlocked("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/totp", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not start setup.");
      } else {
        setEnrollment(data);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That code did not match.");
        setCode("");
      } else {
        setEnrollment(null);
        setCode("");
        setCodes(data.backupCodes || []);
        await load();
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  async function cancel() {
    await fetch("/api/account/totp", { method: "DELETE" }).catch(() => {});
    setEnrollment(null);
    setCode("");
    setError("");
    load();
  }

  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate_backup_codes" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not make new codes.");
      } else {
        setCodes(data.backupCodes || []);
        await load();
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not turn two-factor off.");
      } else {
        setPassword("");
        setShowDisable(false);
        await load();
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  if (blocked) return <p className="error" style={{ margin: 0 }}>{blocked}</p>;
  if (!status) return <p className="muted">Loading…</p>;

  if (codes) {
    return (
      <BackupCodes
        codes={codes}
        doneLabel={doneLabel}
        onDone={() => {
          setCodes(null);
          onEnabled?.();
        }}
      />
    );
  }

  if (enrollment) {
    return (
      <form className="stack" onSubmit={confirm}>
        <div>
          <p className="eyebrow">Step one</p>
          <h2 style={{ margin: "4px 0 0" }}>Scan this with your app</h2>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Use Google Authenticator, 1Password, Authy or whichever app you
            already have. Point it at this square and it will start showing a
            six digit code for Campaign Desk.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI, nothing to optimise */}
        <img
          src={enrollment.qr}
          alt="QR code for setting up two-factor authentication"
          width={240}
          height={240}
          className="totp-qr"
        />
        <details>
          <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>
            Cannot scan it?
          </summary>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6, fontSize: 13 }}>
            Add an account by hand and type this key in:
          </p>
          <code className="totp-secret">{enrollment.manualEntry}</code>
        </details>
        <div className="field">
          <label htmlFor="totp-code">Now type the code it shows</label>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            required
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Turn on two-factor"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={cancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (status.enabled) {
    return (
      <div className="stack">
        <div className="bc-conn">
          <p className="bc-conn-label">Two-factor</p>
          <p className="bc-conn-name">On</p>
          {status.enabledAt ? (
            <p className="bc-conn-meta">
              Since{" "}
              {new Date(status.enabledAt).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          ) : null}
          <p className="bc-conn-meta">
            {status.backupCodesRemaining} backup{" "}
            {status.backupCodesRemaining === 1 ? "code" : "codes"} left
          </p>
        </div>
        {status.backupCodesRemaining <= 2 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            You are nearly out of backup codes. Make a new set so you are not
            stuck if you lose your phone.
          </p>
        ) : null}
        {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={regenerate}
            disabled={busy}
          >
            New backup codes
          </button>
          {allowDisable ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowDisable((v) => !v)}
              disabled={busy}
            >
              Turn off
            </button>
          ) : null}
        </div>
        {showDisable ? (
          <form className="stack" onSubmit={disable}>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              Turning this off means your password is the only thing standing
              between someone and this account. Confirm with it to continue.
            </p>
            {status.hasPassword ? (
              <div className="field">
                <label htmlFor="totp-disable-password">Your password</label>
                <input
                  id="totp-disable-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            ) : null}
            <button className="btn btn-ghost" type="submit" disabled={busy}>
              {busy ? "Turning off…" : "Turn two-factor off"}
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
        A second factor means a stolen password on its own is not enough to get
        into your account. It takes about a minute to set up and you only need
        your phone.
      </p>
      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
      <button type="button" className="btn" onClick={start} disabled={busy}>
        {busy ? "Starting…" : "Set up two-factor"}
      </button>
    </div>
  );
}
