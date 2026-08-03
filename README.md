# Campaign Desk

Hosted review platform for HTML email campaigns.

Upload an email, share a magic link with your boss or client, collect general and pinned feedback, then upload a revised HTML version. Same link stays valid across revisions.

## Features

- Admin password login (no accounts to manage)
- Upload HTML file or paste markup
- Magic review links (no login for reviewers)
- General comments + click-to-pin inline comments
- Status workflow: Draft → In review → Needs changes → Approved
- Version history when you save revised HTML
- Resolve / reopen comments from the admin view

AI “Make revision” is intentionally deferred for a later release.

## Knowledge base (Lifecycle → Knowledge)

The Lifecycle console carries a searchable archive of Max Sturtevant's *The
Inbox Newsletter* (Well Copy): one issue surfaced per day, full text search
across every issue, topic filters, read tracking, and a swipe file of every
featured email design and template.

The archive is a bundled JSON file rather than database rows, so it deploys
with the image and needs no migration or prod seeding. Read state is the only
mutable part and lives in `app_settings`.

```bash
npm run knowledge:sync      # fetch issues published since the last sync
npm run knowledge:rebuild   # re-scrape the whole archive from scratch
```

Run a sync when you want the new issues, then commit the regenerated
`src/content/inbox-newsletter.json` and redeploy. Rebuild only when the
scraper's parsing changes, since it refetches all 340+ issues.

## Quick start

```bash
cd code/campaign-desk
cp .env.example .env.local
# edit ADMIN_PASSWORD, SESSION_SECRET, NEXT_PUBLIC_APP_URL
npm install
npm run dev
```

Open http://localhost:3000 and sign in with your admin password.

Default local password (from `.env.local` if you used the example): `campaign-desk-dev`

## Git hooks

Hooks are installed by `npm install`.

- Before commits: `npm run check` (lint + typecheck)
- Before pushes: `npm run build`

## Environment variables

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for your admin dashboard |
| `SESSION_SECRET` | Random long string used to sign session cookies |
| `NEXT_PUBLIC_APP_URL` | Public base URL used when building magic links |
| `APP_TIME_ZONE` | Business timezone used for production booking dates |
| `RESEND_API_KEY` | Resend API key for production emails |
| `EMAIL_FROM` | Verified sender for production emails |
| `CRON_SECRET` | Secret used by the daily production-reminder job |
| `BASECAMP_VIDEO_EDITING_CAMPFIRE_URL` | Video Editing Team Campfire chatbot URL |

## Workflow

1. Sign in at `/login`
2. Create a campaign and upload HTML
3. Copy the magic review link
4. Send the link to your boss / client
5. They leave general notes and pin comments on the email
6. You review feedback in the admin campaign page
7. Upload revised HTML under **Revise HTML**
8. They reopen the same link to review the update
9. Mark the campaign **Approved** when done

## Deploy (recommended hosts)

This app uses SQLite on disk (`data/campaign-desk.db`), so it needs a host with a persistent filesystem.

Good fits:

- [Railway](https://railway.app)
- [Render](https://render.com)
- [Fly.io](https://fly.io)

### Railway / Render style deploy

1. Create a new web service from this folder
2. Set env vars:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `NEXT_PUBLIC_APP_URL=https://your-domain`
3. Build command: `npm install && npm run build`
4. Start command: `npm run start`
5. Attach a persistent volume mounted at `/app/data` (or the app working directory `data/`)

Production scheduling also needs the separate, short-lived Railway cron
service documented in [DEPLOY.md](./DEPLOY.md). Its start command is
`npm run cron:reminders`; do not apply a cron schedule to the always-on web
service.

### Not ideal without changes

Vercel serverless has no durable local disk for SQLite. To run there later, swap storage to Turso/Postgres and object storage for large HTML if needed.

## Project layout

```
src/
  app/
    admin/           # dashboard, upload, campaign detail
    review/[token]/ # magic-link reviewer UI
    api/             # auth + campaigns + review endpoints
  components/        # Email preview, status badge
  lib/               # db, auth, campaign helpers
data/                # sqlite db (created at runtime, gitignored)
```

## Accounts, 2FA, and setup

Signing in has two steps for anyone with an authenticator app: password, then a
six digit code. Backup codes work in place of a code and are spent on use.

A new account is onboarded from **Accounts** (owner only): send an invite link,
and the person is walked through three steps before the app opens up.

1. **Password.** Their own, at least 12 characters. Setting it signs them in.
2. **Two-factor.** Scan the QR code, type a code back, save the ten backup codes.
3. **Basecamp.** Connect their own Basecamp login, so a to-do they tick shows as
   their tick and hours they log land under their name.

Until all three are done, every page under `/admin` sends them back to
`/account/setup`. Existing accounts are asked to finish the same steps the next
time they sign in; nobody is locked out by the change.

Afterwards, people manage their own second factor at `/account/security`, where
they can issue new backup codes or move to a new phone.

**If somebody loses their phone and their backup codes:** the owner clicks
**Reset 2FA** next to their name in Accounts, and they enroll again at their
next sign-in. If that happens to the owner's own account, run
`node scripts/reset-2fa.mjs michael` on the box holding the database volume.

## Who Basecamp sees

Every Basecamp call goes out on one of two logins, and never on a third
person's.

- **The person themselves**, for anything a human did: picking to-dos in
  Forecast, ticking one off, logging hours, sending an approval card. Reading as
  them also means the picker shows what *they* can see in Basecamp, not what
  somebody else can.
- **The company mascot account**, for work with no human behind it: production
  outreach reminders, the schedule sweep, client message sync, Campfire
  notifications.

There is no third case. If someone hasn't connected, the app says so rather than
borrowing a colleague's token, and the one write that still has a fallback (the
approval card) falls back to the mascot, never to a person.

The Basecamp panel on **Production** names the account the automated jobs are
posting as, and warns if that account is somebody's personal login instead of
the mascot.

### Pointing the automated jobs at the mascot account

1. Open Basecamp in a private window and sign in as the mascot account. The
   OAuth screen uses whichever Basecamp session the browser already has, so
   doing this in your normal window would just reconnect as you.
2. Make sure the mascot is a member of every project it has to post into.
   Basecamp only lets a login act where it has access.
3. In Campaign Desk, go to **Production** → Basecamp → **Disconnect**, then
   **Connect Basecamp**, and authorize from that private window.
4. The panel should then read "Reminders and approval cards post as *the mascot*".

Both setup requirements can be turned off with `REQUIRE_2FA=0` and
`REQUIRE_BASECAMP_CONNECT=0` (see `.env.example`). The Basecamp step is skipped
automatically when `BASECAMP_CLIENT_ID` and `BASECAMP_CLIENT_SECRET` are unset,
since there would be nothing to connect to.

## Security notes

- Treat magic links like private URLs. Anyone with the link can view the campaign and leave feedback.
- Change `ADMIN_PASSWORD` and `SESSION_SECRET` before sharing with real clients.
- Set `NEXT_PUBLIC_APP_URL` to your real HTTPS domain in production.
- 2FA secrets and Basecamp tokens are encrypted with a key derived from `SESSION_SECRET`. Rotating it forces everybody to re-enroll and reconnect.

## Later: AI revisions

When you are ready, each comment card can get a **Make revision** button that:

1. Sends current HTML + that comment to an AI model
2. Returns revised HTML
3. Lets you preview/accept before saving a new version

The comment UI already leaves room for that control.
