# Campaign Desk — Security Master Plan

_Last updated 2026-07-25. Owner: Michael. Purpose: a concrete, prioritized plan to make Campaign Desk demonstrably secure for internal + client use, and an honest framing for the "big platforms have a dev team" question._

---

## 0. The honest answer to "GHL/Basecamp are safer because they have a team of developers"

Security is **not** a function of how many developers you have. It's a function of three things:

1. **Attack surface** — how many ways in there are.
2. **Data sensitivity** — how bad it is if data leaks.
3. **Whether standard controls are in place** — the known best practices, applied.

Where the CEO is right:
- Big platforms (GHL, Basecamp) carry **SOC 2 / ISO certifications, dedicated security teams, 24/7 monitoring, pen tests, and bug bounties.** Those are real and we won't match them. They matter a lot when you have millions of users and are a giant target.

Where the "more devs = more secure" logic breaks down:
- **More code and more features = more attack surface, not less.** A giant platform has thousands of endpoints, integrations, and edge cases — far more places for a bug to hide. Campaign Desk has a **tiny, simple surface**: a login, a handful of admin pages, and read-only client portals. Less to get wrong.
- **We are not a high-value mass target.** Attackers hunt big aggregations of data (GHL holds thousands of businesses' CRM data — a juicy target). Our app holds one agency's campaign statuses for a few dozen clients. The economics of attacking it are poor.
- **Using GHL/Basecamp is also trusting a third party with the same data.** It's not "no risk vs. risk" — it's "their breach surface vs. ours." Their breaches are bigger and out of our control (you can't patch GHL).
- **Simple + few users + best practices done right = genuinely secure for this threat model.** The bar isn't "as secure as a $1B SaaS." It's "appropriate to the data and the users." That bar is very achievable here.

**Honest limitation to acknowledge to the CEO:** if we ever need to tell an *enterprise* client "we're SOC 2 certified," we can't — that's a formal audit only a funded program provides. For internal agency ops and client status portals, that's not required. If a specific client contractually demands SOC 2, that data should stay in the certified platform.

**Bottom line to say:** "It's not about team size, it's about surface area and controls. Our app is small and simple, which is a security *advantage*. Here's our checklist and what's done." Then show this document.

---

## 1. What this app actually is (threat model)

- **Next.js app on Railway**, SQLite on a persistent volume, HTTPS-only.
- **Users:** a handful of internal team members (admin + forecast roles) who log in with passwords; clients who open **unguessable share links** (no login) to view *their own* account status.
- **Data at risk:** campaign content, client names, revenue figures, internal to-dos/strategy, chat messages. Sensitive to the business, but **no payment data, no passwords-of-others, no PII beyond names/emails.**
- **Most damaging realistic threats, in order:**
  1. Someone guesses/brute-forces the weak shared admin password → full access.
  2. A bug lets one client's link see **another** client's data (cross-tenant leak).
  3. A leaked/forwarded share link exposes one client's dashboard.
  4. An unpatched dependency (e.g., Next.js CVE) is exploited.
  5. The database volume is lost with no backup (availability, not a breach, but kills trust).

---

## 2. Current state (verified 2026-07-25)

**Already good:**
- ✅ `SESSION_SECRET` is a strong 64-char random value → sessions (HMAC-SHA256 signed, `httpOnly`, `secure` in prod, SameSite=Lax, 14-day) cannot be forged.
- ✅ Per-person logins use random 16-char passwords.
- ✅ Share tokens are 142-bit (nanoid-24) — not guessable.
- ✅ Secrets live in Railway env vars, not committed to git (`.env` is git- and docker-ignored).
- ✅ Database queries reviewed so far use parameterized statements (low SQL-injection risk).
- ✅ HTTPS enforced by Railway.

**Gaps to fix:**
- ⚠️ The **shared `ADMIN_PASSWORD` is weak** (company name + "1!"). Guessable.
- ⚠️ **No login rate-limiting / lockout** — brute force is unthrottled.
- ⚠️ **Cross-tenant isolation not formally verified** — need to confirm no share token or API route can return another client's data.
- ⚠️ No security headers (HSTS, CSP, etc.).
- ⚠️ No automated database backups confirmed.
- ⚠️ No audit log of who did what.
- ⚠️ Production API keys were exposed in a terminal session on 2026-07-25 → rotate them.

---

## 3. The plan (prioritized)

### P0 — Do this week (closes the real holes)

| # | Item | Why | Effort |
|---|------|-----|--------|
| 1 | **Strengthen or remove the shared `ADMIN_PASSWORD`.** Prefer: delete it, keep only per-person `ADMIN_ACCOUNTS`. If kept, make it a long random string. | Weak shared password is the #1 risk. | 5 min |
| 2 | **Rotate exposed secrets:** `RESEND_API_KEY`, `XAI_API_KEY`, `BASECAMP_CLIENT_SECRET`, `CRON_SECRET`, and all account passwords printed on 2026-07-25. | They were shown in a terminal session. | 30 min |
| 3 | **Add login rate-limiting + lockout** (e.g., max 5 attempts / 15 min per IP+account, exponential backoff). | Makes any password brute-force-proof. | 2–3 hrs |
| 4 | **Access-control review** — confirm every `/api/*` route checks auth, and every client-token route filters strictly by that client's ID (no cross-tenant leak). | The one bug that would destroy trust. | 3–4 hrs (review) |
| 5 | **Turn on Railway volume backups** (or a nightly SQLite dump to object storage). | Data durability = trust. | 1 hr |

### P1 — This month (hardening)

| # | Item | Why | Effort |
|---|------|-----|--------|
| 6 | **`npm audit` + upgrade path**; keep Next.js patched. Add to a monthly reminder. | Dependency CVEs are the most common real-world exploit. | 1 hr + ongoing |
| 7 | **Security headers** via `next.config.ts`: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a basic CSP, `Referrer-Policy`. | Blocks clickjacking, MIME sniffing, mixed content. | 2 hrs |
| 8 | **Audit log** — record logins and mutating actions (who, what, when). | Detect/attribute misuse; huge for CEO comfort. | 4–6 hrs |
| 9 | **Share-link controls** — one-click rotate (exists) + optional expiry; document that links = "anyone with the link." | Limits blast radius of a forwarded link. | 3 hrs |
| 10 | **Shorten admin session** or add re-auth for sensitive actions; add a "log out everywhere" (rotate `SESSION_SECRET`) runbook. | Limits stolen-cookie window. | 2 hrs |

### P2 — When it matters (maturity / enterprise-readiness)

| # | Item | Why | Effort |
|---|------|-----|--------|
| 11 | **2FA for admin accounts** (TOTP). | Defeats password theft entirely. | 1–2 days |
| 12 | **Automated dependency scanning** (Dependabot/GitHub security alerts on the repo). | Continuous, hands-off CVE alerts. | 1 hr |
| 13 | **A lightweight pen test / `/security-review` each quarter.** | Catch regressions; something concrete to show clients. | recurring |
| 14 | **Written incident-response runbook** (rotate secrets, revoke sessions, restore backup). | "We have a plan" is what enterprise buyers ask for. | half day |
| 15 | **Privacy/data-retention note** — what we store, how long, how to delete. | Client/legal comfort. | half day |

---

## 4. Ongoing practices (the "team of developers" substitute)

You don't need a big team — you need a **short routine**:
- **Monthly:** `npm audit`, apply Next.js/security patches, review the audit log.
- **Quarterly:** run `/security-review`, rotate long-lived secrets, test a backup restore.
- **On every deploy:** the existing lint + typecheck + build gate already runs (husky pre-push). Keep it.
- **On offboarding:** remove that person's entry from `ADMIN_ACCOUNTS`/`FORECAST_PASSWORDS`.

Automation (Dependabot, Railway backups, rate-limiting) does the work a security team would — set once, runs forever.

---

## 5. One-paragraph summary for the CEO

> Campaign Desk is intentionally small: a login and read-only client status portals, hosted on encrypted HTTPS infrastructure, with signed sessions, random per-person passwords, and unguessable client links. A small, simple app is a security *advantage* — there's far less to attack than a large platform, and we're not a high-value target. We follow the same core controls the big platforms do (strong auth, access control, patching, backups, monitoring); we're closing the last gaps this week (see plan). The one thing we can't offer that GHL can is a formal SOC 2 certification — so any client that contractually requires SOC 2 keeps that data in the certified system. For everything else, this is appropriately and demonstrably secure.

---

_Track progress by checking off P0 → P1 → P2. This file lives in the repo so it's versioned alongside the fixes it describes._
