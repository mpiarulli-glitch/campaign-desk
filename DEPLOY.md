# Deploy Campaign Desk (Railway)

Campaign Desk needs a host with a **persistent disk** for SQLite.
Railway is the easiest option.

The Railway service is connected to this repo's `main` branch for
auto-deploy (`railway service source connect`) — a push to `main` builds
and deploys on its own. No manual `railway up` needed for normal changes.

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
- Live: Railway URL (works for anyone with the link)
- Edits to code: change files → commit → push → Railway redeploys
- Live data (campaigns/comments) lives in the Railway volume, separate from local

## Notes

- Do not use Vercel for this version (no durable SQLite disk)
- Magic links are private URLs. Anyone with the link can review that package
- Change the admin password before sharing with real clients
