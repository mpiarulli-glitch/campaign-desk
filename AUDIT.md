# Campaign Desk — Product Audit

_Prepared 2026-07-24. Scope: full app (`src/`). Verdicts are "keep", "consolidate", or "cut", with a short why._

Campaign Desk is a single Next.js app on one SQLite file. It wears three hats at once:

1. **Agency operations console** (`/admin/*`) — the team's cockpit.
2. **Employee home base** — the "MEG Team Hub" (`/admin/hub`).
3. **Client portals** — token-authed pages a client opens without logging in (`/dashboard`, `/snapshot`, `/plan`, `/schedule`, `/review`).

The bones are good. The problems are almost all **duplication** and **half-built stubs**, not missing features.

---

## What makes sense (keep as-is)

- **Campaign review flow** (`/admin/campaigns/[id]` → `/review/[token]`). This is the strongest part of the app: multi-asset packages, inline pin comments with image attachments, A/B subject picks, versions, star rating, approve. It is mature and coherent. Keep.
- **The internal client control room** (`/admin/clients/[id]`). Nine tabs over one client (overview, flags, strategy, roadmap, to-dos, messages, production, calendar, OKRs). This is the natural center of gravity for account work. Keep.
- **Revenue / portfolio** (`/admin/revenue`). Clean model, one source of truth for financials. Keep.
- **Production scheduler** (`/admin/production`). Real cadence logic, videographer capacity, Basecamp cards. Keep.
- **MEG Team Hub** (`/admin/hub`). Fully wired employee home: team chat, per-person to-dos, SOPs, training/courses, pulse check-ins, private HR. This is genuinely the "employee office" for staff. Keep.
- **OKR privacy split** (`clientVisibleGoals` vs `listOkrs`). Correctly stores goals once and never leaks key-result numbers through the client token. Keep and copy this pattern elsewhere.

---

## What does NOT make sense (consolidate)

### 1. A client can hold up to four different links
`rev_clients` carries four separate share tokens: `snapshot_token`, `calendar_token`, `schedule_token`, `dashboard_token`. The `/dashboard/[token]` portal already **embeds or links** the snapshot, the schedule booking, and the calendar. So the standalone `/snapshot`, `/schedule`, and (loosely) `/plan` pages are the same content behind a second door.

**Recommendation:** make `/dashboard/[token]` the one client link. Keep `/review/[token]` separate (it is a distinct approval action) and keep `/plan/[token]` only for its sign-off step. Retire `/schedule/[token]` as a public entry point once reminder emails point at the dashboard instead. Collapse the extra tokens over time.

### 2. Two calendars over one table
`/admin/calendar` ("Campaign calendar") and `/admin/production` ("Master scheduler") both read `scheduled_sends` and are told apart only by whether `production_brief` is non-empty. That is a fragile heuristic.

**Recommendation:** add an explicit `kind` column (`email` | `production`) to `scheduled_sends` and split queries on it. Low risk, removes a class of bugs.

### 3. Two parallel metric systems
`rev_metrics` (monthly financials) and `snapshot_metrics` (arbitrary named series on the client snapshot) overlap conceptually and both expose a function literally named `upsertMetric`. A reader cannot tell which "the numbers" live in.

**Recommendation:** keep `rev_metrics` as the money system of record; treat `snapshot_metrics` as display-only client-facing highlights, and rename its writer to `upsertSnapshotMetric` so the two never get confused.

### 4. Three overlapping people rosters
`admin-people.ts`, `people.ts`, and `team.ts` list overlapping names with legacy-exclusion comments and a dedupe step. One roster with role flags (`admin`, `production`, `entryLevel`) would delete a whole category of maintenance risk.

---

## What is dead or half-built (cut or finish)

- **`/admin/chat`** — a 6-line legacy redirect to `/admin/hub`. Cut once nothing links to it.
- **Notifications dropdown** (AppShell) — renders "Live notifications are coming next." Placeholder. _Removed in this pass._
- **Profile-menu "Soon" items** — Notepad, Reminders, Track Time, Settings, Send Feedback. Five dead rows. _Removed in this pass._
- **Courses** have a full reader + quiz but no admin authoring UI (seed-only). Either build the editor or label them as curated content. (An authoring route was in-progress under `/admin/courses` at audit time.)
- **Whiteboard** — fully functional but architecturally isolated (custom polling sync, own tables). Not dead, just orphaned. Keep as a self-contained unit or cut wholesale; do not half-invest.

---

## Changes made in this pass

1. **New login hub** — the post-login landing (`/admin`) is rebuilt as a launchpad: greeting, live at-a-glance metrics, a clean app launcher, and the "needs attention" feed, so the first screen orients you instead of dropping you into a report.
2. **The employee office (client portal)** — the "Live workroom" tower (`WorkTower`) is rebuilt from an arcade-neon night scene into a realistic, high-end architectural view of the MEG floor: dimensional glass building, warm-lit department floors, real desks with teammate avatars, a moving elevator, and a reflected plaza. This is the client-facing proof that people are working on their account right now.
3. **Consolidation** — removed the dead notifications stub and the five "Soon" placeholder menu items from the shell.

The larger consolidations in sections 1–4 above are documented as recommendations, not executed, because they touch data and share links that clients already hold. They should be done deliberately, not overnight.
