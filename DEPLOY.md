# Deploy Campaign Desk (Railway)

Campaign Desk needs a host with a **persistent disk** for SQLite.
Railway is the easiest option.

## Deploying is a manual step

The Railway service has this repo set as its source, but the project has **no
deployment trigger**, so pushing to `main` does *not* start a build. Verified
2026-07-28: a push landed on GitHub and no deployment was ever created.

To ship, push your commits and then deploy explicitly:

```bash
git push origin main
railway up            # add --detach to avoid tailing build logs
```

Check what actually shipped with `railway deployment list`, and confirm the
project is still trigger-less with:

```bash
railway api 'query { project(id: "e98d422d-16bd-46ea-bf24-fe88f5ebe177") {
  deploymentTriggers { edges { node { id branch repository } } } } }'
```

If you want pushes to deploy on their own, add a GitHub trigger on `main` in
the Railway dashboard (service → **Settings** → **Source**). Once a trigger
exists, delete this section and go back to push-to-deploy.

## 1) Create a GitHub repo for this app

From Terminal:

```bash
cd "/Users/michaelpiarulli/Desktop/Email Cowork/code/campaign-desk"
git status
git add .
git commit -m "Ship Campaign Desk for production"
```

Create a new empty GitHub repo (example name: `campaign-desk`), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/campaign-desk.git
git branch -M main
git push -u origin main
```

## 2) Deploy on Railway

1. Go to https://railway.app and sign in (GitHub is fine)
2. **New Project** → **Deploy from GitHub repo**
3. Select `campaign-desk`
4. Railway will detect the Dockerfile and build

## 3) Add a volume (required)

1. Open the service → **Settings** → **Volumes**
2. Add a volume mounted at: `/app/data`
3. This keeps campaigns and comments after restarts

## 4) Set environment variables

In the service → **Variables**:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | a strong password only you know |
| `SESSION_SECRET` | a long random string (32+ chars) |
| `NEXT_PUBLIC_APP_URL` | your public URL, e.g. `https://campaign-desk-production-xxxx.up.railway.app` |
| `APP_TIME_ZONE` | `America/Los_Angeles` |
| `RESEND_API_KEY` | Resend API key for scheduling and confirmation emails |
| `EMAIL_FROM` | Verified Resend sender |
| `EMAIL_REPLY_TO` | Address that should receive client replies |
| `CRON_SECRET` | Long random secret used by the reminder job |
| `BASECAMP_VIDEO_EDITING_PROJECT_ID` | Video Editing Team project ID (`31034042`) for production-request messages and videographer mentions |
| `BASECAMP_VIDEO_EDITING_CAMPFIRE_URL` | Optional chatbot fallback for production requests |
| `SKYLEAD_API_KEY` | Optional. Powers the LinkedIn tab on the Lifecycle dashboard |
| `GHL_CLIENT_ID` | Optional. GoHighLevel OAuth app client ID |
| `GHL_CLIENT_SECRET` | Optional. GoHighLevel OAuth app client secret |
| `GHL_COMPANY_ID` | Optional. GHL agency/company ID |
| `GHL_REFRESH_TOKEN` | Optional. Bootstrap refresh token, seed only (see below) |

Generate a secret:

```bash
openssl rand -hex 32
```

After Railway gives you a public domain, set `NEXT_PUBLIC_APP_URL` to that exact URL (no trailing slash), then redeploy if needed.

### Skylead (LinkedIn) integration

The Lifecycle dashboard reads LinkedIn seats and campaign stats from the
Skylead (Multilead) Open API. Create a key at
<https://app.multilead.co/settings/api>, then set `SKYLEAD_API_KEY` in
`.env.local` for local work and in Railway variables for production.

Without the key the rest of the dashboard still works. The LinkedIn tab shows a
"not connected" note instead of failing. The key is read server-side only and is
never sent to the browser.

### GoHighLevel integration

The Automations tab reads live workflows for every client that has a
`ghl_location_id` set on the Revenue page.

`GHL_REFRESH_TOKEN` is a **seed only**. GHL rotates the refresh token on every
use, so after the first refresh the live token lives in the `app_settings`
table (key `ghl_tokens`) inside the SQLite volume. Changing the env var later
does nothing unless that row is deleted first.

**Known conflict:** the local MCP server in `Email Cowork/code/ghl-mcp` uses
the same OAuth install and caches its token in `.tokens.json`. The two caches
cannot see each other, so whichever refreshes last invalidates the other and
the loser gets `invalid_grant`. The proper fix is a second OAuth install so
each consumer holds its own refresh token. Until then, copy the token across
by hand when one side starts failing.

## 5) Add the production-reminder cron service

Do not put a cron schedule on the web service; Railway cron services start,
run, and exit instead of staying online.

1. Add a second Railway service from the same repository.
2. Give it `APP_URL` set to the public Campaign Desk URL and the same
   `CRON_SECRET` as the web service.
3. Override its start command with `npm run cron:reminders`.
4. In **Settings → Cron Schedule**, use `0 17 * * *`. Railway schedules in UTC,
   so this runs at 9 AM Pacific Standard Time / 10 AM Pacific Daylight Time.
5. Deploy it, run it once manually, and confirm its JSON output reports the
   expected `sent`, `failed`, and `shootReminders` counts.

The cron service calls the web API. It does not mount or open the SQLite
volume, which keeps the web service as the database's single owner.

## 6) Generate a public domain

1. Service → **Settings** → **Networking**
2. **Generate Domain**
3. Copy it into `NEXT_PUBLIC_APP_URL`
4. Redeploy once so magic links use the live domain

## 7) Use it with your boss and clients

1. Open `https://YOUR-DOMAIN/login`
2. Sign in with `ADMIN_PASSWORD`
3. Upload a campaign (or multi-email package)
4. Copy the **magic review link**
5. Send that link to your boss/client (no login for them)
6. Work feedback at `/admin/campaigns/...`

## Local vs live

- Local: `http://localhost:3040` (your machine only)
- Live: https://hub.marketingempiregroup.com (works for anyone with the link)
- Edits to code: change files → commit → push → Railway redeploys
- Live data (campaigns/comments) lives in the Railway volume, separate from local

## Notes

- Do not use Vercel for this version (no durable SQLite disk)
- Magic links are private URLs. Anyone with the link can review that package
- Change the admin password before sharing with real clients
