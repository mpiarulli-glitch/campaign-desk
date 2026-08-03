"use client";

import { Brand } from "@/components/Brand";
import { TwoFactorPanel } from "@/components/TwoFactorPanel";

// Manage your own second factor after setup: new backup codes, a new phone, or
// turning it off. The wizard at /account/setup uses the same panel.

export default function SecurityPage() {
  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <Brand />
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Security</h1>
        </div>
        <TwoFactorPanel doneLabel="Done" />
        <a className="muted" href="/account/password" style={{ fontSize: 13 }}>
          Change your password
        </a>
        <a className="muted" href="/admin" style={{ fontSize: 13 }}>
          Back to Campaign Desk
        </a>
      </div>
    </div>
  );
}
