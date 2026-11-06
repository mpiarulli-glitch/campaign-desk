# Bot Activity

The Bot Activity page (`/admin/bot-activity`) is Michael's view of what the bots are doing. Only the owner session can open it. Named admins, account managers, forecast users, and signed-out visitors are refused, including on the reply and dismiss API.

The page does not take a reply. A Needs you item shows the request, an Open chat link (`grokbot://app/v1/agent?id=…`) when that bot has an agent id, and a quiet Dismiss. Bots with no agent id show the request and Dismiss only. The reply route is still there for anything that already calls it.

Bots do not use that session. They call `/api/bot-activity` with a bearer token.

## Token

Send `Authorization: Bearer <token>`.

The token is the existing `CAMPAIGN_DESK_API_TOKEN`. If `BOT_ACTIVITY_TOKEN` is also set, that value is accepted too. A token in the query string is ignored. The browser session is not accepted on this route, and the bot token is not accepted on the page's reply route.

Replace `YOUR_TOKEN` in the examples. Do not commit a real token.

Limits: 64KB per request, 20 events per request, 30 requests per minute per IP. Text is stored and shown as plain text.

There is no callback when Michael replies. A bot reads replies by calling GET.

Base URL: `https://hub.marketingempiregroup.com`

## Post an update

One JSON object, or `{ "events": [ ... ] }` for several. `at` is optional and is an ISO timestamp. Omit it to use the time of the request.

The board shows Working only when an in-progress item was posted or updated in the last 30 minutes. That clock is the time Campaign Desk stored the write (`updated_at` on the work row, or `created_at` on a timeline line), not how old `at` is. Post at least every 30 minutes while a bot is working, or the card stays Stalled instead of Working.

The October 24 mockup is inserted once, with ids `seed-w-`, `seed-k-`, and `seed-t-`. Those rows stay in the database. Until a bot upserts that same key, the board labels the row "Not updated since …" and does not treat it as Working or as a live Needs you. An old seeded question stays on the page as Old request, with Dismiss. Last heard from is the newest bot write across that bot's waiting, work, and timeline rows.

To keep a card accurate, post while the work is happening:

- `type: work`, `state: progress`, at least every 30 minutes
- `type: waiting` (or `state: blocked`) when Michael has to answer, and `resolved: true` when he has
- `type: work`, `state: done` when the task is finished (a done write in the last 2 minutes flashes Done on that bot's card)
- `type: timeline` for a feed line. Each call adds a line. It does not update an older one.

Upsert a waiting item. `key` is stable for that bot, so the same key updates the same card. `resolved: true` marks it resolved. `resolved: false` reopens it. On the first write, `title` is required.

```bash
curl -sS -X POST https://hub.marketingempiregroup.com/api/bot-activity \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "waiting",
    "bot": "Jerry",
    "key": "empire-analytics-login",
    "title": "Sign in to Empire Analytics",
    "detail": "The login form is still the blocker.",
    "resolved": false
  }'
```

Mark that same item resolved:

```bash
curl -sS -X POST https://hub.marketingempiregroup.com/api/bot-activity \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"waiting","bot":"Jerry","key":"empire-analytics-login","resolved":true}'
```

Upsert a work item. `state` is `progress`, `blocked`, or `done`.

```bash
curl -sS -X POST https://hub.marketingempiregroup.com/api/bot-activity \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "work",
    "bot": "Daniel",
    "key": "vita-q4-finalize",
    "title": "Vita Q4 finalize",
    "detail": "Waiting on the mockup.",
    "state": "blocked"
  }'
```

Append a timeline line. This is not an upsert. Each call adds a line.

```bash
curl -sS -X POST https://hub.marketingempiregroup.com/api/bot-activity \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"timeline","bot":"Jerry","text":"Checked the Lifecycle tab.","at":"2026-10-24T18:32:00.000Z"}'
```

A bot name that is not already on the board is added with the clipboard icon and no chat link.

A successful response looks like:

```json
{ "ok": true, "results": [{ "type": "waiting", "bot": "Jerry", "key": "empire-analytics-login", "status": "open" }] }
```

## Read replies

GET returns waiting items, open and resolved, with Michael's replies. `bot` and `since` are optional. `since` is an ISO timestamp and keeps items whose card changed at or after that time, including a new reply.

```bash
curl -sS "https://hub.marketingempiregroup.com/api/bot-activity?bot=Jerry&since=2026-10-23T00:00:00.000Z" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "waiting": [
    {
      "bot": "Jerry",
      "key": "empire-analytics-login",
      "title": "Sign in to Empire Analytics",
      "detail": "The login form is still the blocker.",
      "status": "open",
      "at": "2026-10-24T00:09:00.000Z",
      "updatedAt": "2026-10-24T18:40:00.000Z",
      "replies": [
        { "body": "Use the login I just sent.", "at": "2026-10-24T18:40:00.000Z" }
      ]
    }
  ],
  "truncated": false
}
```

`status` is `open` or `resolved`. At most 500 items are returned. `truncated: true` means there were more.
