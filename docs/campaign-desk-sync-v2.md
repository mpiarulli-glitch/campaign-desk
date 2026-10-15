# Campaign Desk forecast sync, payload v2

SEO Ops Center is the sender. Campaign Desk is the receiver. Version 2 sends the
hours for each day, not only a weekly total. Version 1 still works: omit
`version` and send `allocations` as before. A version 1 week has a total and
no days, so the Mon–Fri bars stay empty until a version 2 run replaces it.

Authentication is unchanged: `Authorization: Bearer <CAMPAIGN_DESK_API_TOKEN>`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/people` | Roster accounts that already have an email. |
| `GET` | `/v1/clients` | Active Basecamp clients (`rev_clients`). |
| `PUT` | `/v1/forecast-runs/{runId}` | Store a run. Same body again is idempotent. |
| `DELETE` | `/v1/forecast-runs/{runId}` | Drop that run. Its weeks fall back to the previous one. |

`GET /v1/people` returns `{ "people": [{ "id": "desk_carlos", "email": "…" }] }`.
The id is `desk_` plus the forecast slug. Accounts with no email are omitted.
A duplicate email is omitted. The list is not limited to Carlos and Abel.

When `carlos` or `abel` still has a blank email, Campaign Desk stores
`cmorones@marketingempiregroup.com` on `carlos` (`desk_carlos`) and
`amiranda@marketingempiregroup.com` on `abel` (`desk_abel`). An email already
on the account is left alone, including a different address. Other roster
accounts appear once their email is stored, including an email saved from the
sender.

`GET /v1/clients` returns `{ "clients": [{ "id": "rc_…", "name": "Pipe It Right" }] }`,
active clients only, sorted by name. `id` is the Campaign Desk client id to send
back as `campaignDeskClientId`.

`PUT` and `DELETE` respond `{ "runId", "status": "accepted" | "deleted", "idempotent" }`.
Validation failures are `422` `{ "error": "invalid_payload", "message" }`.
The same run id with a different body is `409` `{ "error": "idempotency_conflict" }`.
Unknown run on delete is `404` `{ "error": "run_not_found" }`.

## Version 2 body

`Content-Type: application/json`. Unknown keys are rejected. Every key below
is required unless the note says it may be omitted. UUIDs are compared
case-insensitively and stored lowercase. `runId` in the body must match the
URL. `source` must be `seo-ops-center`. One to four weeks. At most 500 items
in the whole run.

```json
{
  "version": 2,
  "runId": "11111111-1111-4111-8111-111111111111",
  "source": "seo-ops-center",
  "organizationId": "22222222-2222-4222-8222-222222222222",
  "weeks": [
    {
      "weekStart": "2026-10-12",
      "basis": "actual",
      "people": [
        {
          "personEmail": "cmorones@marketingempiregroup.com",
          "campaignDeskPersonId": "desk_carlos",
          "days": [
            {
              "date": "2026-10-13",
              "items": [
                {
                  "itemKey": "task:44444444-4444-4444-8444-444444444444:2026-10-13",
                  "kind": "task",
                  "bucket": "client",
                  "client": {
                    "seoOpsClientId": "33333333-3333-4333-8333-333333333333",
                    "name": "Pipe It Right",
                    "domain": "pipeitright.com",
                    "campaignDeskClientId": "rc_pipe"
                  },
                  "title": "SEO optimizations – service pages",
                  "source": "actual",
                  "minutes": 90,
                  "hours": "1.50",
                  "startTime": null,
                  "sourceIds": {
                    "taskId": "44444444-4444-4444-8444-444444444444",
                    "timeLogIds": ["55555555-5555-4555-8555-555555555555"],
                    "plannerEventId": null
                  }
                },
                {
                  "itemKey": "event:66666666-6666-4666-8666-666666666666:2026-10-13",
                  "kind": "event",
                  "bucket": "internal",
                  "client": null,
                  "title": "1:1 – performance",
                  "source": "actual",
                  "minutes": 30,
                  "hours": "0.50",
                  "startTime": "09:30",
                  "sourceIds": {
                    "taskId": null,
                    "timeLogIds": [],
                    "plannerEventId": "66666666-6666-4666-8666-666666666666"
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Fields

- `version` must be the number `2`. Omit it to send version 1. `1` and `"2"` are rejected.
- `weekStart` is the Monday, `yyyy-MM-dd`.
- `basis` is `actual` or `estimate`. Every item's `source` must match it.
- `people` may be empty. That clears the week. The same email may appear once per week.
- `personEmail` is a lowercase email. `campaignDeskPersonId` is `desk_<slug>` for someone on the forecast roster.
- `days[].date` is a day in that Monday–Sunday week, including the weekend. The same date may appear once per person.
- `items` may be empty. `itemKey` is a stable string, 1–200 characters, unique for that person and date.
- `kind` is `task` or `event`. Out-of-office is not a kind. Do not send it.
- `bucket` is `client` or `internal`.
- A client item's `client` is an object. An internal item's `client` is `null`, and Campaign Desk shows it as Internal.
- `client.seoOpsClientId` is the SEO Ops client UUID.
- `client.name` is the sender's display name, not `Internal`.
- `client.domain` may be omitted, `null`, or a string. It is stored and not used for matching. Omitted and `null` are the same body on a retry.
- `client.campaignDeskClientId` is a Campaign Desk client id from `GET /v1/clients`, or `null`.
- `title` is the real title, including meeting titles. Campaign Desk shows it as sent.
- `minutes` is an integer from 1 to 1440. `hours` is the string from minutes ÷ 60, half away from zero, two decimal places (`90` → `"1.50"`, `10` → `"0.17"`).
- `startTime` is `HH:MM` (24-hour) or `null`. An event with a time is placed on the calendar. Anything without a time, or outside the calendar's hours, is an all-day chip on that date.
- `sourceIds.taskId` and `sourceIds.plannerEventId` are a UUID or `null`. `sourceIds.timeLogIds` is an array of UUIDs and may be empty. Descriptions, attendees, and links are not accepted.

### What the hours mean

A client meeting is `kind: "event"` and `bucket: "client"`. It counts toward that client, not Internal. An internal event is `bucket: "internal"` and `client: null`. Campaign Desk does not recategorize either one.

Campaign Desk derives the weekly totals from the items (person × client, or Internal). Those totals are what the weekly forecast already reads, so a version 2 week is not added twice. The sum of item minutes for a person equals that person's weekly total.

A week that has started counts `actual` items as tracked time and as the forecast. A later week counts `estimate` items as forecast only. Mon–Fri bars add the tracked items for that date on top of Basecamp timesheet hours. Saturday and Sunday are stored and listed, and they stay in the week total, but the five day bars do not draw them.

### Clients

Match order, for `bucket: "client"` only:

1. If `campaignDeskClientId` is the id of a `rev_clients` row, that client wins. The row's name is what Campaign Desk shows.
2. Otherwise the trimmed `name` must equal `rev_clients.name` exactly, including case. One match wins. Zero or several is unmatched.
3. An unmatched item is still stored under the sender's name, with an `Unmatched client` badge. The run is not rejected, and the item is not filed as Internal.

### People

`campaignDeskPersonId` must be a roster slug (`desk_carlos`, not a new account). Campaign Desk looks the email up:

- Email already on that account: accepted.
- Account has no email yet: the email is saved on that account. No password is set.
  `carlos` and `abel` are filled on boot when blank (see above), so a sync for
  those mailboxes matches the stored row instead of waiting for the first write.
- Account row missing: a roster row is created with the same role the app already seeds, still with no password, and the email is saved.
- Email belongs to someone else, or this account already has a different email: `422`. The stored email is not overwritten.

### Replace and delete

A new run replaces the allocations and the items for each week it names. Other weeks stay. The same run id and the same canonical body return `idempotent: true`. Delete marks the run deleted. If it was the newest run for a week, the previous accepted run for that week comes back, items included. Deleting an older run does not change what is on screen. A version 2 run can replace a version 1 week, and deleting it restores the version 1 total with no items.

### What Campaign Desk shows

Synced items live in `seo_ops_forecast_items`, not in `forecast_tasks`. They cannot be timed, edited, dragged, logged to Basecamp, or removed by Plan this week. Hand-made tasks are left as they are and still count beside the synced hours.

They show on the Mon–Fri tracked bars, and in Today, List, Calendar, and Tasks, with the text `Synced from SEO Ops`. An unmatched client also shows `Unmatched client`. Internal time is the muted segment of the bar.
