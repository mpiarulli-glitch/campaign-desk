// Seeds a ~90-day example set of social media + blog post entries onto the
// Marketing Empire Group client's editorial calendar, via the app's own API.
// Idempotent: clears its own previously-seeded sends first.
//
// Usage:
//   node scripts/seed-meg-social-blog.mjs                       (local dev, default pw)
//   BASE=https://... PW=yourpass node scripts/seed-meg-social-blog.mjs   (live)

const BASE = (process.env.BASE || "http://localhost:3040").replace(/\/$/, "");
const PW = process.env.PW || "campaign-desk-dev";
const MARKER = "seed:meg-social-blog";
const CLIENT_NAME = "Marketing Empire Group";

// Editorial rotation. Each entry is one planned social post or blog post.
// offsetWeeks/day set the date relative to the first Tuesday on/after today.
const PLAN = [
  { wk: 0, dow: 1, time: "09:00", platform: "Instagram", title: "[Social] Instagram: Q1 recap carousel",
    purpose: "Recap client wins to build social proof", audience: "Prospects + followers",
    offer: "", subject: "", preview: "" },
  { wk: 0, dow: 3, time: "09:00", platform: "Blog", title: "[Blog] Why most small business emails get ignored",
    purpose: "SEO + top-of-funnel education", audience: "Organic search + website visitors",
    offer: "Free strategy call", subject: "", preview: "" },
  { wk: 1, dow: 1, time: "09:00", platform: "Facebook", title: "[Social] Facebook: client testimonial video",
    purpose: "Build trust with a short-form proof clip", audience: "Local business owners",
    offer: "", subject: "", preview: "" },
  { wk: 1, dow: 5, time: "10:00", platform: "LinkedIn", title: "[Social] LinkedIn: founder post on faith-driven marketing",
    purpose: "Thought leadership, values-driven angle", audience: "Faith-driven entrepreneurs",
    offer: "", subject: "", preview: "" },
  { wk: 2, dow: 3, time: "09:00", platform: "Blog", title: "[Blog] The follow-up gap: why leads go cold",
    purpose: "SEO + nurture the follow-up automation offer", audience: "Organic search + website visitors",
    offer: "Book a strategy call", subject: "", preview: "" },
  { wk: 2, dow: 1, time: "09:00", platform: "Instagram", title: "[Social] Instagram: behind-the-scenes reel",
    purpose: "Humanize the brand, show process", audience: "Followers", offer: "", subject: "", preview: "" },
  { wk: 3, dow: 4, time: "11:00", platform: "LinkedIn", title: "[Social] LinkedIn: case study breakdown post",
    purpose: "Proof + credibility for B2B audience", audience: "Prospects", offer: "", subject: "", preview: "" },
  { wk: 4, dow: 3, time: "09:00", platform: "Blog", title: "[Blog] GHL automation: what it actually does for a service business",
    purpose: "SEO + explain core automation offer", audience: "Organic search + website visitors",
    offer: "Book a strategy call", subject: "", preview: "" },
  { wk: 4, dow: 1, time: "09:00", platform: "Facebook", title: "[Social] Facebook: local business spotlight",
    purpose: "Community goodwill + soft brand awareness", audience: "Local community", offer: "", subject: "", preview: "" },
  { wk: 5, dow: 5, time: "10:00", platform: "Instagram", title: "[Social] Instagram: quote graphic on marketing with integrity",
    purpose: "Values-driven engagement post", audience: "Followers", offer: "", subject: "", preview: "" },
  { wk: 6, dow: 3, time: "09:00", platform: "Blog", title: "[Blog] Ad spend leaking? Three reasons campaigns underperform",
    purpose: "SEO + tie into ad audit offer", audience: "Organic search + website visitors",
    offer: "Free ad audit", subject: "", preview: "" },
  { wk: 7, dow: 1, time: "09:00", platform: "LinkedIn", title: "[Social] LinkedIn: mid-year reflection post",
    purpose: "Values-driven, ties to second-half push", audience: "Prospects", offer: "", subject: "", preview: "" },
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
      platform: p.platform,
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
  console.log(`seeded ${made} social/blog sends for MEG (${start} → ${end})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
