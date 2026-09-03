"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Brand } from "@/components/Brand";

type Status = {
  configured: boolean;
  connected: boolean;
  name: string | null;
  email: string | null;
  connectedAt: string | null;
  error: string | null;
};

// The callback redirects back here with ?basecamp=<outcome>. Spelled out so each
// failure says what actually happened rather than "something went wrong".
const OUTCOMES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Your Basecamp account is connected." },
  denied: {
    tone: "bad",
    text: "You cancelled at the Basecamp screen, so nothing was connected.",
  },
  state: {
    tone: "bad",
    text: "That link expired before it came back. Start again.",
  },
  mismatch: {
    tone: "bad",
    text: "You started that connection as a different Campaign Desk account. Start again from here.",
  },
  signin: { tone: "bad", text: "Your session ended. Sign in and start again." },
  error: { tone: "bad", text: "Basecamp could not complete the connection." },
};

function BasecampAccount() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  const outcome = params.get("basecamp");
  const reason = params.get("reason");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/basecamp/me");
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

  async function disconnect() {
    setBusy(true);
    await fetch("/api/basecamp/me", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    load();
  }

  if (blocked) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Basecamp</p>
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

  const note = outcome ? OUTCOMES[outcome] : null;

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <Brand />
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Basecamp</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Connect your own Basecamp login so the work you do here is recorded
            as yours. Ticking a to-do shows as your tick, and hours you log land
            on the timesheet under your name.
          </p>
        </div>

        {note ? (
          <p className={note.tone === "ok" ? "muted" : "error"} style={{ margin: 0 }}>
            {note.text}
            {outcome === "error" && reason ? ` ${reason}` : ""}
          </p>
        ) : null}

        {!status ? (
          <p className="muted">Loading…</p>
        ) : !status.configured ? (
          <p className="error" style={{ margin: 0 }}>
            Basecamp is not set up on the server yet. Ask Michael.
          </p>
        ) : status.connected ? (
          <>
            <div className="bc-conn">
              <p className="bc-conn-label">Connected as</p>
              <p className="bc-conn-name">{status.name || "Your Basecamp account"}</p>
              {status.email ? <p className="bc-conn-meta">{status.email}</p> : null}
              {status.connectedAt ? (
                <p className="bc-conn-meta">
                  Since{" "}
                  {new Date(status.connectedAt).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </div>
            {status.error ? (
              <p className="error" style={{ margin: 0 }}>
                {status.error}
              </p>
            ) : null}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-secondary" href="/api/basecamp/me/connect">
                Reconnect
              </a>
              <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              Until you connect, you can still see and plan everything. What you
              cannot do is tick a Basecamp to-do or log hours as yourself, because
              Basecamp records those against whoever&apos;s login was used.
            </p>
            <a className="btn" href="/api/basecamp/me/connect">
              Connect Basecamp
            </a>
          </>
        )}

        <a className="muted" href="/admin/hub" style={{ fontSize: 13 }}>
          Back to Campaign Desk
        </a>
      </div>
    </div>
  );
}

// useSearchParams needs a boundary or the page cannot be prerendered. The
// fallback is the same shell the loaded state uses, so there is no visible jump.
export default function BasecampAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="login-wrap">
          <div className="card login-card stack">
            <Brand />
            <p className="muted">Loading…</p>
          </div>
        </div>
      }
    >
      <BasecampAccount />
    </Suspense>
  );
}
