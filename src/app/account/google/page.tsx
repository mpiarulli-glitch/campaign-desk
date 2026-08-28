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

const OUTCOMES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Your Google Calendar is connected." },
  denied: {
    tone: "bad",
    text: "You cancelled at the Google screen, so nothing was connected.",
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
  unconfigured: {
    tone: "bad",
    text: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server yet.",
  },
  error: { tone: "bad", text: "Google could not complete the connection." },
};

function GoogleAccount() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  const outcome = params.get("google");
  const reason = params.get("reason");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google/me");
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
    await fetch("/api/google/me", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    load();
  }

  if (blocked) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Google Calendar</p>
            <h1>Not available</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              {blocked}
            </p>
          </div>
          <a className="btn" href="/admin">
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
          <h1>Google Calendar</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Connect your own Google Calendar so client meetings booked there
            show up on your Forecast, and meetings you add in Forecast can go
            to Google. Work blocks stay here — only meetings sync.
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
        ) : status.connected ? (
          <>
            <div className="bc-conn">
              <p className="bc-conn-label">Connected as</p>
              <p className="bc-conn-name">
                {status.name || status.email || "Your Google account"}
              </p>
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
              <a className="btn btn-secondary" href="/api/google/me/connect">
                Reconnect
              </a>
              <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </>
        ) : (
          <>
            {status.error ? (
              <p className="error" style={{ margin: 0 }}>
                {status.error}
              </p>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                Until you connect, Forecast will not see meetings that live only
                on Google Calendar, and meetings you type here will not appear
                on Google.
              </p>
            )}
            <a className="btn" href="/api/google/me/connect">
              Connect Google Calendar
            </a>
          </>
        )}

        <a className="muted" href="/admin" style={{ fontSize: 13 }}>
          Back to Campaign Desk
        </a>
      </div>
    </div>
  );
}

export default function GoogleAccountPage() {
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
      <GoogleAccount />
    </Suspense>
  );
}
