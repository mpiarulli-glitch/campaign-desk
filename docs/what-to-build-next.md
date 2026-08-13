# What to build next in Campaign Desk

A read on where the app has leverage left, written after building the production
scheduling flow and the failures surface. Ranked by what it saves you against
what it costs to build. Everything here reuses machinery the app already has:
token links that need no login, the King Kashflow Basecamp account, the cadence
engine, the nightly cron, and the GHL connection.

---

## Build these first

### 1. Missed window state

The cadence engine knows every client's production window. It does not know that
a window closed with nothing booked. When we audited, 13 windows had already
passed unnoticed and 19 anchors were off-window, and nothing in the app said so.

A window that ends with no production is the single most expensive silent event
here: it is a deliverable the client paid for that nobody shot. Mark the window
missed when its Friday passes unbooked, show those clients in their own band on
the production console, and roll the anchor forward so the next window still
lands correctly.

Small build. It is the same query that already finds due windows, run against
the past instead of the future.

### 2. Shot list delivery

The approval email now promises the client a shot list. Nothing in the app sends
one. Right now that promise lives entirely in whoever remembers to write it.

Give the production record a shot list, let the account manager fill it from the
brief the client already submitted, and send it on the same token link pattern as
the crew view. The client sees what will be captured, the crew sees the same
page, and the promise closes itself.

### 3. Day-of production status

The crew has a link. The link is read only. Nobody knows a shoot happened until
footage appears.

Two buttons on the crew page, "on site" and "wrapped", both writing a timestamp,
would tell you where every production stands on the day without a single text
message. Add a nightly check that flags a production whose date passed with no
wrap, and the same gap that hides missed windows stops hiding missed shoots.

### 4. Footage handoff

Between a wrapped shoot and an edited video there is a link somebody pastes into
Basecamp. It is untracked, so "where is the footage for Guardian" is a question
you answer by scrolling.

One field on the production record, surfaced on the card the mascot already
posts, and the editor stops asking.

---

## Worth building once the above lands

### 5. Client-side asset requests

The client dashboard shows the calendar, approvals, the snapshot, and a way to
request a production. It has no way for a client to hand you something: a logo, a
menu, a photo, the copy for the promo they mentioned on a call.

An upload box on the client dashboard that drops a file into their Basecamp
project, posted by the mascot, would remove most of the "can you send me the
file" chasing. The attachments API is already in the app.

### 6. Approval reminders

The production side chases the client on a fixed cadence, two emails and three
Basecamp follow-ups a week, never on weekends. The campaign approval side does
not chase at all. A package sits in review until somebody notices it sitting.

The reminder engine is written and tested. Point it at campaigns in review and
the second half of the product gets the discipline the first half has.

### 7. Recurring production templates

Every client shoots roughly the same thing every month. Their brief is retyped
from scratch every time.

Prefill the brief from their last production. The location, the on-site contact,
the parking, the power access, all of it is stable. The client edits what changed
instead of answering fifteen questions again, which is also the difference
between a form they fill in and a form they abandon.

### 8. GHL send confirmation

The app tracks a campaign to approval. GHL sends it. Nothing reconciles the two,
so an approved campaign that never got scheduled in GHL looks identical to one
that went out.

The GHL MCP can already list campaigns. Match approved campaigns against what
actually exists in the subaccount and record the gaps as failures, which now have
somewhere to appear.

---

## Deliberately not recommending

**More dashboards.** You just sunset three surfaces because nobody used them. The
things above all write data or close a loop. None of them are another view of
data you already have.

**Anything that emails a client automatically without a person seeing it first.**
The duplicate-email incident during this build came from an automated send
running against stale code. The cadence engine is the one automated sender and it
took a lot of tightening to trust. Keep that surface small.

---

## The one structural note

Nine of the ideas above want the same thing: a production that knows its own
state through the whole arc, requested, approved, shot, wrapped, delivered.
Today a production knows requested and approved. Every gap in this list sits in
the part of the arc the record cannot describe.

If you build one thing, build the state machine, and four of the items above stop
being features and become fields.
