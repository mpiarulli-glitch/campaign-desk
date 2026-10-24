# Bot Activity

The Bot Activity page (`/admin/bot-activity`) is Michael's view of what the bots are doing. Only the owner session can open it. Named admins, account managers, forecast users, and signed-out visitors are refused, including on the reply and dismiss API.

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
