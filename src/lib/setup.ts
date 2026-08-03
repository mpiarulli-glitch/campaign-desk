// What a new account still has to do before it can use Campaign Desk.
//
// Three things, in order: a password of their own, an authenticator app, and
// their own Basecamp connection. The first two are security; the third is so
// every tick and every logged hour lands under the right name in Basecamp
// instead of under whoever connected the app.
//
// The state is derived, never trusted from the client. setup_completed_at is a
// cache of "all three were true at some point", not the source of truth: if
// somebody disconnects Basecamp later, they get walked back through it.

import { hasConnection } from "./basecamp-identity";
import { basecampConfigured } from "./basecamp";
import { getUser, markSetupComplete, totpEnabled } from "./users";

export type SetupStep = "password" | "twofactor" | "basecamp";

export type SetupState = {
  slug: string;
  label: string;
  hasPassword: boolean;
  twoFactor: boolean;
  basecamp: boolean;
  // False when BASECAMP_CLIENT_ID/SECRET are unset, in which case connecting is
  // impossible and the step is skipped rather than becoming a dead end.
  basecampAvailable: boolean;
  required: SetupStep[];
  remaining: SetupStep[];
  complete: boolean;
};

// Both gates default to on. They exist so a misconfigured deploy or a genuine
// emergency has a way out that does not involve editing the database, and both
// are the kind of thing you turn off knowingly, not by accident.
function requireTwoFactor(): boolean {
  return process.env.REQUIRE_2FA !== "0";
}

function requireBasecamp(): boolean {
  return process.env.REQUIRE_BASECAMP_CONNECT !== "0";
}

export function setupStateFor(slug: string | null): SetupState | null {
  if (!slug) return null;
  const user = getUser(slug);
  if (!user) return null;

  const available = basecampConfigured();
  const state = {
    hasPassword: Boolean(user.password_hash),
    twoFactor: totpEnabled(slug),
    basecamp: hasConnection(slug),
  };

  const required: SetupStep[] = ["password"];
  if (requireTwoFactor()) required.push("twofactor");
  if (requireBasecamp() && available) required.push("basecamp");

  const remaining = required.filter((step) => {
    if (step === "password") return !state.hasPassword;
    if (step === "twofactor") return !state.twoFactor;
    return !state.basecamp;
  });

  const complete = remaining.length === 0;
  // Stamp the first time everything lines up, so the users list can show when
  // somebody finished onboarding.
  if (complete && !user.setup_completed_at) markSetupComplete(slug);

  return {
    slug: user.slug,
    label: user.label,
    ...state,
    basecampAvailable: available,
    required,
    remaining,
    complete,
  };
}

// The step the setup wizard should land on, or null when there is nothing left.
export function nextSetupStep(slug: string | null): SetupStep | null {
  return setupStateFor(slug)?.remaining[0] || null;
}
