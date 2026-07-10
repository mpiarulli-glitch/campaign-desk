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

## Security notes

- Treat magic links like private URLs. Anyone with the link can view the campaign and leave feedback.
- Change `ADMIN_PASSWORD` and `SESSION_SECRET` before sharing with real clients.
- Set `NEXT_PUBLIC_APP_URL` to your real HTTPS domain in production.

## Later: AI revisions

When you are ready, each comment card can get a **Make revision** button that:

1. Sends current HTML + that comment to an AI model
2. Returns revised HTML
3. Lets you preview/accept before saving a new version

The comment UI already leaves room for that control.
