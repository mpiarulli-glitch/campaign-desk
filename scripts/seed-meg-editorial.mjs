// Seeds a ~90-day example editorial calendar onto the Marketing Empire Group
// client, via the app's own API so it works against local dev or the live
// Railway app. Idempotent: clears its own previously-seeded sends first.
//
// Usage:
//   node scripts/seed-meg-editorial.mjs                       (local dev, default pw)
//   BASE=https://... PW=yourpass node scripts/seed-meg-editorial.mjs   (live)

const BASE = (process.env.BASE || "http://localhost:3040").replace(/\/$/, "");
const PW = process.env.PW || "campaign-desk-dev";
const MARKER = "seed:meg-editorial";
const CLIENT_NAME = "Marketing Empire Group";

// Editorial rotation. Each entry is one planned email; offsetWeeks/day set the
// date relative to the first Tuesday on/after today.
const PLAN = [
  { wk: 0, dow: 2, time: "10:00", title: "July Newsletter: What's working in email right now",
    purpose: "Monthly value newsletter to stay top of mind", audience: "Full list",
    offer: "", subject: "The 3 emails every local business should be sending",
    preview: "A quick roundup you can copy this month." },
  { wk: 0, dow: 4, time: "11:00", title: "Case study: 4x return for a home service client",
    purpose: "Build trust with a concrete result", audience: "Prospects + warm leads",
    offer: "Free teardown of your current emails", subject: "How one plumber turned email into 4x return",
    preview: "The exact sequence we built, start to finish." },
  { wk: 1, dow: 2, time: "10:00", title: "Educational: subject lines that actually get opened",
    purpose: "Teach, show expertise", audience: "Full list",
    offer: "", subject: "Steal these 7 subject line formulas",
    preview: "Tested on real local campaigns." },
  { wk: 1, dow: 4, time: "13:00", title: "Service spotlight: done-for-you lifecycle emails",
    purpose: "Explain a core offer", audience: "Prospects",
    offer: "Free 20-minute strategy call", subject: "We build the emails so you don't have to",
    preview: "Here is what that looks like month to month." },
  { wk: 2, dow: 2, time: "10:00", title: "Tips: 5 automations every business should turn on",
    purpose: "Value + soft pitch for automation setup", audience: "Full list",
    offer: "", subject: "Turn these 5 automations on this week",
    preview: "Welcome, cart, win-back, and two more." },
  { wk: 3, dow: 3, time: "10:00", title: "Client win: booked calendar in 30 days",
    purpose: "Proof + momentum", audience: "Warm leads",
    offer: "", subject: "From quiet inbox to booked calendar in a month",
    preview: "What changed, and how fast." },
  { wk: 4, dow: 2, time: "10:00", title: "August Newsletter: mid-year email checkup",
    purpose: "Monthly newsletter", audience: "Full list",
    offer: "Free email audit", subject: "Your mid-year email checkup is here",
    preview: "Five things to review before Q4." },
  { wk: 4, dow: 4, time: "11:00", title: "Educational: how often should you really email?",
    purpose: "Address a common objection", audience: "Full list",
    offer: "", subject: "The honest answer on email frequency",
    preview: "More than you think, less than you fear." },
  { wk: 5, dow: 2, time: "10:00", title: "Offer: fall onboarding spots opening",
    purpose: "Drive booked calls", audience: "Prospects + warm leads",
    offer: "2 free months of management on annual", subject: "We are opening a few fall spots",
    preview: "First come, first served." },
  { wk: 6, dow: 3, time: "10:00", title: "Behind the scenes: how we plan a client calendar",
    purpose: "Show process, build trust", audience: "Full list",
    offer: "", subject: "A peek at how we plan 90 days of emails",
    preview: "The same system we would run for you." },
  { wk: 7, dow: 2, time: "10:00", title: "Educational: writing emails that sound human",
    purpose: "Value", audience: "Full list",
    offer: "", subject: "Stop sounding like a template",
    preview: "Small changes that make a big difference." },
  { wk: 8, dow: 2, time: "10:00", title: "September Newsletter: Q4 planning starts now",
    purpose: "Monthly newsletter", audience: "Full list",
    offer: "Free Q4 planning session", subject: "Q4 is closer than it looks",
    preview: "Let's map your promotions early." },
  { wk: 8, dow: 4, time: "11:00", title: "Case study: reactivating a cold list",
    purpose: "Proof for win-back offer", audience: "Prospects",
    offer: "Free win-back campaign build", subject: "How we woke up a list that went cold",
    preview: "The three-email sequence that did it." },
  { wk: 9, dow: 3, time: "10:00", title: "Tips: the anatomy of a high-converting promo",
    purpose: "Value + lead into promo services", audience: "Full list",
    offer: "", subject: "Anatomy of a promo that actually sells",
    preview: "Steal this structure for your next sale." },
  { wk: 10, dow: 2, time: "10:00", title: "Offer: holiday campaign build, booking now",
    purpose: "Drive holiday campaign bookings", audience: "Prospects + warm leads",
    offer: "Holiday campaign package", subject: "Lock in your holiday emails before it's a scramble",
    preview: "We build the whole run for you." },
  { wk: 11, dow: 3, time: "10:00", title: "Client win + thank you to referrals",
    purpose: "Goodwill + referral nudge", audience: "Full list",
    offer: "Referral bonus", subject: "A thank you, and a favor to ask",
    preview: "Know someone who needs this?" },
];

function firstTuesday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const add = (2 - day + 7) % 7; // days until next Tuesday (0 if today is Tue)
  d.setDate(d.getDate() + add);
  return d;
}
function ymd(base, weeks, dow) {
  const d = new Date(base);
  d.setDate(d.getDate() + weeks * 7 + (dow - 2)); // dow relative to Tuesday(2)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const jar = [];
  const setCookie = (res) => {
    const sc = res.headers.get("set-cookie");
    if (sc) jar.push(sc.split(";")[0]);
  };
  const cookie = () => jar.join("; ");

  // 1) login
  let res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PW }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  setCookie(res);

  // 2) resolve MEG client id
  res = await fetch(`${BASE}/api/revenue/clients`, { headers: { cookie: cookie() } });
  const { clients = [] } = await res.json();
  let meg = clients.find((c) => c.name === CLIENT_NAME);
  if (!meg) {
    res = await fetch(`${BASE}/api/revenue/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookie() },
      body: JSON.stringify({ name: CLIENT_NAME, businessModel: "b2b" }),
    });
    meg = (await res.json()).client;
    console.log("created MEG client", meg.id);
  }
  console.log("MEG client id:", meg.id);

  const base = firstTuesday();
  const start = ymd(base, 0, 2);
  const end = ymd(base, 12, 6);

  // 3) clear previously seeded sends in window
  res = await fetch(`${BASE}/api/calendar?start=${start}&end=${end}`, {
    headers: { cookie: cookie() },
  });
  const { sends = [] } = await res.json();
  let cleared = 0;
  for (const s of sends) {
    if (s.note === MARKER && s.client_id === meg.id) {
      await fetch(`${BASE}/api/calendar/${s.id}`, { method: "DELETE", headers: { cookie: cookie() } });
      cleared++;
    }
  }
  console.log(`cleared ${cleared} previously-seeded sends`);

  // 4) insert the plan
  let made = 0;
  for (const p of PLAN) {
    const payload = {
      clientId: meg.id,
      title: p.title,
      sendDate: ymd(base, p.wk, p.dow),
      sendTime: p.time,
      status: "planned",
      audience: p.audience,
      purpose: p.purpose,
      offer: p.offer,
      subject: p.subject,
      previewText: p.preview,
      note: MARKER,
    };
    const r = await fetch(`${BASE}/api/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookie() },
      body: JSON.stringify(payload),
    });
    if (r.ok) made++;
    else console.error("failed:", p.title, r.status);
  }
  console.log(`seeded ${made} editorial sends for MEG (${start} → ${end})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
