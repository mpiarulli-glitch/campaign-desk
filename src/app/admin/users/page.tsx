"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  slug: string;
  label: string;
  email: string | null;
  role: "owner" | "admin" | "forecast";
  active: boolean;
  hasPassword: boolean;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  invitePending: boolean;
  inviteExpiresAt: string | null;
  twoFactor: boolean;
  basecampConnected: boolean;
  setupCompletedAt: string | null;
};

// The stored role value is still "forecast" because the session format and
// every isForecastAuthenticated check depend on it. Nothing user-facing says
// that word: these people are just users.
const ROLE_LABEL: Record<Row["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  forecast: "User",
};

function fmt(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function UsersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<{ slug: string; url: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [allLinks, setAllLinks] = useState<
    { links: Array<{ slug: string; label: string; url: string }>; skipped: string[] } | null
  >(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.status === 403) {
      setDenied(true);
      return;
    }
    if (!res.ok) {
      setError("Could not load accounts.");
      return;
    }
    const data = await res.json();
    setRows(data.users);
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

  async function act(slug: string, action: string, extra?: Record<string, unknown>) {
    setBusy(`${slug}:${action}`);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That did not work.");
      } else if (action === "invite" && data.url) {
        setInviteUrl({ slug, url: data.url });
        setCopied(false);
      } else if (action === "invite_all" && data.links) {
        setAllLinks({ links: data.links, skipped: data.skipped || [] });
        setCopiedAll(false);
        setInviteUrl(null);
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    }
    setBusy("");
  }

  if (denied) {
    return (
      <div className="ops-scope">
        <div className="ops-page">
          <div className="ops-page-head">
            <div>
              <p className="ops-eyebrow">Team</p>
              <h1 className="ops-title">Accounts.</h1>
              <p className="ops-sub">
                Only the owner account can manage logins. Ask Michael if you need
                someone added or reset.
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
            <h1 className="ops-title">Accounts.</h1>
            <p className="ops-sub">
              Everyone signs in with their own password. Send an invite link and
              they set it themselves, so nobody else ever knows it.
            </p>
          </div>
          <button
            className="btn"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => act("", "invite_all")}
          >
            {busy === ":invite_all" ? "Creating..." : "Invite everyone"}
          </button>
        </div>

        {error ? (
          <div className="ops-panel" style={{ padding: 16, marginBottom: 16 }}>
            <p className="error" style={{ margin: 0 }}>
              {error}
            </p>
          </div>
        ) : null}

        {inviteUrl ? (
          <div className="ops-panel" style={{ padding: 20, marginBottom: 16 }}>
            <p className="ops-eyebrow" style={{ marginTop: 0 }}>
              Invite link for {inviteUrl.slug}
            </p>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
              Send this to them directly. It works once and expires in 72 hours.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                readOnly
                value={inviteUrl.url}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: "1 1 320px", minWidth: 0 }}
              />
              <button
                className="btn"
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(inviteUrl.url)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setInviteUrl(null)}
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {allLinks ? (
          <div className="ops-panel" style={{ padding: 20, marginBottom: 16 }}>
            <p className="ops-eyebrow" style={{ marginTop: 0 }}>
              Invite links, one per person
            </p>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
              Send each person their own line. Every link works once and expires
              in 72 hours.
              {allLinks.skipped.length
                ? ` Skipped ${allLinks.skipped.join(", ")}, who already set a password.`
                : ""}
            </p>
            <textarea
              readOnly
              rows={Math.min(allLinks.links.length + 1, 16)}
              value={allLinks.links.map((l) => `${l.label}: ${l.url}`).join("\n")}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: "100%", fontFamily: "var(--font-readout, monospace)", fontSize: 12 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(
                      allLinks.links.map((l) => `${l.label}: ${l.url}`).join("\n")
                    )
                    .then(() => setCopiedAll(true))
                    .catch(() => setCopiedAll(false));
                }}
              >
                {copiedAll ? "Copied" : "Copy all"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setAllLinks(null)}
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        <div className="ops-panel" style={{ padding: 0, overflowX: "auto" }}>
          {!rows ? (
            <p className="muted" style={{ padding: 20 }}>
              Loading accounts...
            </p>
          ) : (
            <table className="rev-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Person</th>
                  <th style={{ textAlign: "left" }}>Role</th>
                  <th style={{ textAlign: "left" }}>Password</th>
                  <th style={{ textAlign: "left" }}>Setup</th>
                  <th style={{ textAlign: "left" }}>Last sign in</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.slug} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td>
                      <strong>{u.label}</strong>
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {u.slug}
                        {u.active ? "" : " · disabled"}
                      </span>
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>
                      {u.hasPassword ? (
                        <>
                          Own password
                          <br />
                          <span className="muted" style={{ fontSize: 12 }}>
                            set {fmt(u.passwordSetAt)}
                          </span>
                        </>
                      ) : u.invitePending ? (
                        <>
                          Invite sent
                          <br />
                          <span className="muted" style={{ fontSize: 12 }}>
                            expires {fmt(u.inviteExpiresAt)}
                          </span>
                        </>
                      ) : (
                        <span className="muted">Shared password</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="muted"
                        style={{ fontSize: 12, lineHeight: 1.6 }}
                      >
                        {u.twoFactor ? "2FA on" : "2FA off"}
                        <br />
                        {u.basecampConnected ? "Basecamp linked" : "No Basecamp"}
                      </span>
                    </td>
                    <td>{fmt(u.lastLoginAt)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => act(u.slug, "invite")}
                      >
                        {busy === `${u.slug}:invite`
                          ? "..."
                          : u.hasPassword
                            ? "Reset"
                            : "Invite"}
                      </button>
                      {/* For someone who has lost their phone and their backup
                          codes. They enroll a new one at their next sign in. */}
                      {u.twoFactor ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={Boolean(busy)}
                          style={{ marginLeft: 6 }}
                          onClick={() => {
                            if (
                              confirm(
                                `Remove two-factor from ${u.label}'s account? They will set it up again next time they sign in.`
                              )
                            ) {
                              act(u.slug, "reset_2fa");
                            }
                          }}
                        >
                          {busy === `${u.slug}:reset_2fa` ? "..." : "Reset 2FA"}
                        </button>
                      ) : null}
                      {u.role !== "owner" ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={Boolean(busy)}
                          style={{ marginLeft: 6 }}
                          onClick={() =>
                            act(u.slug, u.active ? "deactivate" : "activate")
                          }
                        >
                          {u.active ? "Disable" : "Enable"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="muted" style={{ marginTop: 16, lineHeight: 1.6 }}>
          Anyone still showing &quot;Shared password&quot; is signing in with a
          password that lives in Railway env vars. Once everybody has their own,
          those env vars can be deleted.
        </p>
      </div>
    </div>
  );
}
