"use client";

// Account setup. Three steps, and nobody reaches the app until all three are
// done: a password of their own, an authenticator app, and their own Basecamp
// connection so their work is recorded under their name and not the app's.
//
// The state is read from the server on every load. Nothing here decides what is
// finished; it only shows what the server says is left.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/components/Brand";
import { TwoFactorPanel } from "@/components/TwoFactorPanel";

type Step = "password" | "twofactor" | "basecamp";

type SetupState = {
  label: string;
  hasPassword: boolean;
  twoFactor: boolean;
  basecamp: boolean;
  basecampAvailable: boolean;
  required: Step[];
  remaining: Step[];
  complete: boolean;
};

const STEP_LABEL: Record<Step, string> = {
  password: "Your password",
  twofactor: "Two-factor",
  basecamp: "Basecamp",
};

// The Basecamp callback sends people back here with ?basecamp=<outcome> when
// they were connecting as part of setup.
const OUTCOMES: Record<string, string> = {
  denied: "You cancelled at the Basecamp screen, so nothing was connected.",
  state: "That link expired before it came back. Try again.",
  mismatch: "That connection was started from a different account. Try again.",
  signin: "Your session ended. Sign in and pick up where you left off.",
  error: "Basecamp could not complete the connection.",
};

function Progress({ state }: { state: SetupState }) {
  const done = (step: Step) =>
    step === "password"
      ? state.hasPassword
      : step === "twofactor"
        ? state.twoFactor
        : state.basecamp;

  return (
    <ol className="setup-steps">
      {state.required.map((step, i) => (
        <li
          key={step}
          className={
            done(step)
              ? "setup-step setup-step-done"
              : step === state.remaining[0]
                ? "setup-step setup-step-now"
                : "setup-step"
          }
        >
          <span className="setup-step-num">{done(step) ? "✓" : i + 1}</span>
          <span>{STEP_LABEL[step]}</span>
        </li>
      ))}
    </ol>
  );
}

function Setup() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<SetupState | null>(null);
  const [blocked, setBlocked] = useState("");

  const outcome = params.get("basecamp");
  const reason = params.get("reason");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/setup");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBlocked(data.error || "Sign in to finish setting up.");
        return;
      }
      setState(data);
    } catch {
      setBlocked("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (blocked) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <div>
            <p className="eyebrow">Account setup</p>
            <h1>Sign in first</h1>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
              {blocked}
            </p>
          </div>
          <a className="btn" href="/login">
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <Brand />
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  const step = state.remaining[0] || null;
  const note = outcome && outcome !== "connected" ? OUTCOMES[outcome] : null;

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <Brand />
        <div>
          <p className="eyebrow">Welcome, {state.label}</p>
          <h1>{step ? "Finish setting up" : "You are all set"}</h1>
        </div>

        <Progress state={state} />

        {note ? <p className="error" style={{ margin: 0 }}>{note}{reason ? ` ${reason}` : ""}</p> : null}

        {step === "password" ? (
          <>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              You are still on a shared password. Set your own so what you do
              here is recorded as yours.
            </p>
            <a className="btn" href="/account/password">
              Set your password
            </a>
          </>
        ) : null}

        {step === "twofactor" ? (
          <TwoFactorPanel doneLabel="Next step" onEnabled={load} allowDisable={false} />
        ) : null}

        {step === "basecamp" ? (
          <>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Last one. Connect your own Basecamp login so a to-do you tick shows
              as your tick, and the hours you log land on the timesheet under
              your name rather than somebody else&apos;s.
            </p>
            <a className="btn" href="/api/basecamp/me/connect">
              Connect Basecamp
            </a>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              Basecamp will ask you to allow Campaign Desk, then bring you
              straight back here.
            </p>
          </>
        ) : null}

        {!step ? (
          <>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Password set, two-factor on, Basecamp connected. That is everything.
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                router.push("/admin/hub");
                router.refresh();
              }}
            >
              Open Campaign Desk
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// useSearchParams needs a boundary or the page cannot be prerendered.
export default function SetupPage() {
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
      <Setup />
    </Suspense>
  );
}
