"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { PEOPLE, OWNER_SLUG } from "@/lib/people";

// One account list instead of the old Admin/Forecast tabs. The role now comes
// from the users table, so the person picking their name is all we need: the
// server decides what they can see.
type Choice = { slug: string; label: string; group: string };

function buildChoices(): Choice[] {
  const seen = new Set<string>();
  const choices: Choice[] = [];

  // OWNER_SLUG is listed in PEOPLE, not ADMIN_PEOPLE, so read the label there.
  const owner = PEOPLE.find((p) => p.slug === OWNER_SLUG);
  choices.push({
    slug: OWNER_SLUG,
    label: owner?.label || "Michael",
    group: "Owner",
  });
  seen.add(OWNER_SLUG);

  for (const p of ADMIN_PEOPLE) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    choices.push({ slug: p.slug, label: p.label, group: "Admin" });
  }
  for (const p of PEOPLE) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    choices.push({ slug: p.slug, label: p.label, group: "Users" });
  }
  return choices;
}

export default function LoginPage() {
  const router = useRouter();
  const choices = useMemo(buildChoices, []);
  const [account, setAccount] = useState<string>(OWNER_SLUG);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Set once the password is accepted and the account has an authenticator app.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  // Where someone lands after a completed sign-in. Anyone who has not finished
  // account setup goes to the wizard first, wherever they were headed.
  function goAfterLogin(data: {
    mustSetPassword?: boolean;
    setupComplete?: boolean;
    role?: string;
    person?: string | null;
  }) {
    if (data.mustSetPassword) {
      router.push("/account/password");
    } else if (data.setupComplete === false) {
      router.push("/account/setup");
    } else {
      router.push(
        data.role === "forecast" && data.person
          ? `/admin/forecast/${data.person}`
          : "/admin"
      );
    }
    router.refresh();
  }

  const groups = useMemo(() => {
    const map = new Map<string, Choice[]>();
    for (const c of choices) {
      const list = map.get(c.group) || [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [choices]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 429
            ? data.error || "Too many attempts. Wait a few minutes."
            : "Wrong password. Try again."
        );
        setLoading(false);
        return;
      }
      if (data.needsTotp) {
        setNeedsCode(true);
        setPassword("");
        setLoading(false);
        return;
      }
      goAfterLogin(data);
    } catch {
      setError("Could not sign in. Check that the server is running.");
      setLoading(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That code is not right.");
        setCode("");
        setLoading(false);
        return;
      }
      goAfterLogin(data);
    } catch {
      setError("Could not sign in. Check that the server is running.");
      setLoading(false);
    }
  }

  if (needsCode) {
    return (
      <div className="login-wrap">
        <form className="card login-card stack" onSubmit={onSubmitCode}>
          <Brand />
          <div>
            <p className="eyebrow">Two-factor</p>
            <h1>Enter your code</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              Open your authenticator app and type the six digit code it is
              showing. A backup code works here too.
            </p>
          </div>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              type="text"
              autoFocus
              inputMode="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
            />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Checking..." : "Sign in"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setNeedsCode(false);
              setCode("");
              setError("");
            }}
          >
            Start over
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={onSubmit}>
        <Brand />
        <div>
          <p className="eyebrow empire-mark">BUILD YOUR EMPIRE</p>
          <h1>Sign in</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Pick your name and use your own password. If you have not set one
            yet, ask Michael for an invite link.
          </p>
        </div>
        <div className="field">
          <label htmlFor="account">Your account</label>
          <select
            id="account"
            className="select-clean"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            {groups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
