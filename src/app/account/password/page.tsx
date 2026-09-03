"use client";

import { FormEvent, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type Info = {
  label: string;
  hasPassword: boolean;
  minLength: number;
};

export default function ChangePasswordPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [blocked, setBlocked] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/account/password")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBlocked(
            data.error ||
              "Sign in as yourself to change your password."
          );
          return;
        }
        setInfo({
          label: data.label,
          hasPassword: Boolean(data.hasPassword),
          minLength: data.minLength || 12,
        });
      })
      .catch(() => setBlocked("Could not reach the server."));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    if (next !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not change your password.");
        setSaving(false);
        return;
      }
      setSaved(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      setInfo((prev) => (prev ? { ...prev, hasPassword: true } : prev));
    } catch {
      setError("Could not reach the server.");
    }
    setSaving(false);
  }

  if (blocked) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Password</p>
            <h1>Not available</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              {blocked}
            </p>
          </div>
          <a className="btn" href="/admin/hub">
            Back to Campaign Desk
          </a>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <p className="muted">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={onSubmit}>
        <Brand />
        <div>
          <p className="eyebrow">{info.label}</p>
          <h1>{info.hasPassword ? "Change your password" : "Set your password"}</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            {info.hasPassword
              ? "Pick something only you know. You will stay signed in on this device."
              : "You are still on a shared password. Set your own so your activity is yours."}
          </p>
        </div>
        {info.hasPassword ? (
          <div className="field">
            <label htmlFor="current">Current password</label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="next">New password</label>
          <input
            id="next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={`At least ${info.minLength} characters`}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted">Password updated.</p> : null}
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : info.hasPassword ? "Change password" : "Set password"}
        </button>
        <a className="muted" href="/admin/hub" style={{ fontSize: 13 }}>
          Back to Campaign Desk
        </a>
      </form>
    </div>
  );
}
