"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { PEOPLE } from "@/lib/people";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"admin" | "forecast">("admin");
  const [person, setPerson] = useState<string>(PEOPLE[0]?.slug || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          person: mode === "forecast" ? person : undefined,
        }),
      });
      if (!res.ok) {
        setError("Wrong password. Try again.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      router.push(
        data.role === "forecast" && data.person
          ? `/admin/forecast/${data.person}`
          : "/admin"
      );
      router.refresh();
    } catch {
      setError("Could not sign in. Check that the server is running.");
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={onSubmit}>
        <Brand />
        <div>
          <p className="eyebrow">Internal tool</p>
          <h1>Sign in</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Upload campaigns, share a private review link, and collect feedback
            from your team or clients.
          </p>
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`tab ${mode === "admin" ? "active" : ""}`}
            onClick={() => setMode("admin")}
          >
            Admin
          </button>
          <button
            type="button"
            className={`tab ${mode === "forecast" ? "active" : ""}`}
            onClick={() => setMode("forecast")}
          >
            Forecast
          </button>
        </div>
        {mode === "forecast" ? (
          <div className="field">
            <label htmlFor="person">Your name</label>
            <select
              id="person"
              className="select-clean"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              {PEOPLE.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="password">
            {mode === "forecast" ? "Forecast password" : "Admin password"}
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
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
