"use client";

import { FormEvent, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";

type Check =
  | { state: "loading" }
  | { state: "valid"; label: string; minLength: number }
  | { state: "invalid"; error: string };

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [check, setCheck] = useState<Check>({ state: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invite/${token}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.valid) {
          setCheck({
            state: "valid",
            label: data.label,
            minLength: data.minLength || 12,
          });
        } else {
          setCheck({
            state: "invalid",
            error: data.error || "This link is no longer valid.",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCheck({ state: "invalid", error: "Could not reach the server." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not set your password.");
        setSaving(false);
        return;
      }
      setDone(true);
      // Setting a password signs them in, so they carry straight on to the
      // rest of setup. If that did not take, fall back to the sign-in page.
      setTimeout(
        () => router.push(data.authenticated ? "/account/setup" : "/login"),
        1400
      );
    } catch {
      setError("Could not reach the server.");
      setSaving(false);
    }
  }

  if (check.state === "loading") {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <p className="muted">Checking your link...</p>
        </div>
      </div>
    );
  }

  if (check.state === "invalid") {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Invite</p>
            <h1>Link no longer works</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              {check.error} Ask Michael to send you a fresh one.
            </p>
          </div>
          <a className="btn" href="/login">
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Step one done</p>
            <h1>Password saved</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              Two quick things left: your authenticator app and your Basecamp
              account. Taking you there now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={onSubmit}>
        <Brand />
        <div>
          <p className="eyebrow">Welcome, {check.label}</p>
          <h1>Set your password</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Pick something only you know. This link works once and nobody else
            can see what you choose.
          </p>
        </div>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${check.minLength} characters`}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            required
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save password"}
        </button>
      </form>
    </div>
  );
}
