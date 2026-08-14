(function () {
  "use strict";

  if (window.MEGGrowthQuiz && window.MEGGrowthQuiz.initialized) return;

  var defaults = {
    webhookUrl:
      "https://services.leadconnectorhq.com/hooks/0GKlxMiOTyF1FJ3vPBfo/webhook-trigger/875b3386-89f6-4fba-9057-61713d9a6ffa",
    autoOpen: true,
    delayMs: 12000,
    scrollPercent: 45,
    exitIntent: true,
    cooldownDays: 14,
    acquisitionSource: "Website – Growth Constraint Quiz",
    privacyUrl: "https://www.marketingempiregroup.com/privacy-policy",
    bookingUrl: "https://www.marketingempiregroup.com/book-your-discovery-meeting",
    logoUrl:
      "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb146c431e860eb696b9.png",
  };

  var config = Object.assign({}, defaults, window.MEGGrowthQuizConfig || {});
  var STORAGE_CLOSED = "meg_growth_quiz_closed_until";
  var STORAGE_COMPLETE = "meg_growth_quiz_completed";
  var autoOpenConsumed = false;
  var lastFocused = null;

  /* The seven growth constraints (possible results). */
  var constraints = {
    not_enough_leads: {
      label: "Demand generation",
      title: "Your constraint is demand generation.",
      body: "The next move is not more random activity. It is a clearer audience, a stronger offer, and a channel plan built around qualified demand.",
      actions: ["Clarify the highest-value audience", "Align the offer to buying intent", "Measure qualified opportunities, not lead volume"],
    },
    poor_lead_quality: {
      label: "Targeting and message fit",
      title: "Your constraint is targeting and message fit.",
      body: "Lead quality usually improves when the audience, promise, and qualification path make the right buyer feel specifically understood.",
      actions: ["Tighten the ideal-customer profile", "Match creative to the buyer's real problem", "Add qualification before the sales handoff"],
    },
    follow_up_crm: {
      label: "Conversion infrastructure",
      title: "Your constraint is conversion infrastructure.",
      body: "You may already have enough opportunities. The value is in faster response, consistent nurture, and clear ownership inside the CRM.",
      actions: ["Map every lead source and owner", "Automate the first response and reminders", "Track every stage through revenue"],
    },
    visibility_seo: {
      label: "Discoverability and trust",
      title: "Your constraint is discoverability and trust.",
      body: "The goal is to become visible where buyers already look and give search engines and prospects enough evidence to trust the business.",
      actions: ["Strengthen local and organic search signals", "Build proof around priority services", "Connect visibility to a conversion path"],
    },
    website_conversion: {
      label: "The conversion experience",
      title: "Your constraint is the conversion experience.",
      body: "Traffic cannot make up for unclear positioning, weak proof, or a next step that asks for too much before it shows any value.",
      actions: ["Clarify the page's single conversion job", "Lead with outcomes and proof", "Reduce friction in the next step"],
    },
    reporting_roi: {
      label: "Measurement confidence",
      title: "Your constraint is measurement confidence.",
      body: "Marketing decisions get sharper when sources, pipeline stages, and revenue live in one measurable journey instead of disconnected dashboards.",
      actions: ["Standardize source and campaign tracking", "Connect CRM stages to revenue", "Separate generated from influenced pipeline"],
    },
    outsourced_team: {
      label: "Integrated execution",
      title: "Your constraint is integrated execution.",
      body: "The opportunity is to replace fragmented specialists and stalled projects with one accountable team working from a shared growth plan.",
      actions: ["Align around business objectives", "Build one go-to-market roadmap", "Create a measurable operating rhythm"],
    },
  };

  /* Five questions. Each option adds weight to one or more constraints. */
  var questions = [
    {
      kicker: "Growth check",
      title: "What is the biggest thing holding back your growth right now?",
      copy: "Pick the one that feels most expensive today.",
      options: [
        { label: "We are not generating enough leads", scores: { not_enough_leads: 3 } },
        { label: "Our leads come in but they are low quality", scores: { poor_lead_quality: 3 } },
        { label: "Follow-up and CRM are inconsistent", scores: { follow_up_crm: 3 } },
        { label: "Barely anyone finds us online", scores: { visibility_seo: 3 } },
        { label: "Traffic comes but does not convert", scores: { website_conversion: 3 } },
        { label: "We cannot tell what is actually working", scores: { reporting_roi: 3 } },
        { label: "We need a complete marketing team", scores: { outsourced_team: 3 } },
      ],
    },
    {
      kicker: "Pipeline",
      title: "How would you describe your sales pipeline?",
      copy: "Be honest about what a typical month looks like.",
      options: [
        { label: "Mostly empty, we need more volume", scores: { not_enough_leads: 2, visibility_seo: 1 } },
        { label: "Full, but a lot of tire-kickers", scores: { poor_lead_quality: 2 } },
        { label: "Full, but leads go cold before we close", scores: { follow_up_crm: 2 } },
        { label: "Steady, we just want more efficiency", scores: { reporting_roi: 1, outsourced_team: 1 } },
      ],
    },
    {
      kicker: "Speed to lead",
      title: "When a new lead comes in, what usually happens?",
      copy: "Think about the first 24 hours.",
      options: [
        { label: "We are not getting enough to worry about it", scores: { not_enough_leads: 2 } },
        { label: "We reach out, but it is inconsistent", scores: { follow_up_crm: 2 } },
        { label: "They land on our site and we hope they convert", scores: { website_conversion: 2 } },
        { label: "It is tracked and automated in our CRM", scores: { reporting_roi: 1 } },
      ],
    },
    {
      kicker: "Discovery",
      title: "How do most prospects find you today?",
      copy: "Where does new attention actually come from?",
      options: [
        { label: "Referrals mostly, very little online", scores: { visibility_seo: 2 } },
        { label: "They search and sometimes find us", scores: { visibility_seo: 1, website_conversion: 1 } },
        { label: "Paid ads, but the ROI is unclear", scores: { reporting_roi: 2 } },
        { label: "A mix of channels that is hard to manage", scores: { outsourced_team: 2 } },
      ],
    },
    {
      kicker: "Your team",
      title: "What does your marketing setup look like?",
      copy: "Who owns marketing on a normal week?",
      options: [
        { label: "Just me, no dedicated marketing", scores: { outsourced_team: 2 } },
        { label: "A small in-house team stretched thin", scores: { outsourced_team: 1, follow_up_crm: 1 } },
        { label: "Freelancers or agencies that do not connect", scores: { outsourced_team: 2, reporting_roi: 1 } },
        { label: "A solid team that needs sharper strategy", scores: { reporting_roi: 1, not_enough_leads: 1 } },
      ],
    },
  ];

  var TOTAL_STEPS = questions.length + 1; // questions + contact capture

  var css = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');
    .megq-lock { overflow: hidden !important; }
    .megq-root, .megq-root * { box-sizing: border-box; }
    .megq-root { --megq-ink:#121212; --megq-cyan:#4ec5dc; --megq-gold:#ffbf00; --megq-panel:#1b1b1b; --megq-line:#2c2c2c; --megq-muted:#a1a1a1; --megq-display:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; }
    .megq-root button, .megq-root a, .megq-root input { font: inherit; }
    .megq-overlay { align-items:center; background:rgba(6,6,6,.84); -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); display:flex; inset:0; justify-content:center; opacity:0; padding:20px; position:fixed; transition:opacity .22s ease; visibility:hidden; z-index:2147483000; }
    .megq-overlay.megq-open { opacity:1; visibility:visible; }
    .megq-dialog { background:var(--megq-ink); border:1px solid #262626; border-top:4px solid var(--megq-cyan); border-radius:4px; box-shadow:0 40px 120px rgba(0,0,0,.7); color:#fff; display:flex; flex-direction:column; max-height:min(660px,94vh); max-width:500px; opacity:0; overflow:hidden; transform:translateY(12px) scale(.985); transition:opacity .22s ease,transform .22s ease; width:100%; }
    .megq-open .megq-dialog { opacity:1; transform:translateY(0) scale(1); }
    .megq-scroll { flex:1 1 auto; overflow-y:auto; }
    .megq-topbar { align-items:center; border-bottom:1px solid var(--megq-line); display:flex; flex:0 0 auto; justify-content:space-between; padding:16px 22px; }
    .megq-brand { align-items:center; display:flex; }
    .megq-brand img { display:block; height:26px; width:auto; }
    .megq-meta-right { align-items:center; display:flex; gap:14px; }
    .megq-step-label { color:#8f8f8f; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    .megq-step-label[hidden] { display:none; }
    .megq-close { align-items:center; background:transparent; border:0; color:#9c9c9c; cursor:pointer; display:flex; font-size:24px; height:30px; justify-content:center; line-height:1; padding:0; width:30px; }
    .megq-close:hover { color:#fff; }
    .megq-close:focus-visible, .megq-choice:focus-visible, .megq-back:focus-visible, .megq-submit:focus-visible, .megq-cta:focus-visible, .megq-start:focus-visible { outline:3px solid var(--megq-cyan); outline-offset:2px; }
    .megq-progress { background:#262626; flex:0 0 auto; height:3px; }
    .megq-progress[hidden] { display:none; }
    .megq-progress span { background:var(--megq-cyan); display:block; height:100%; transition:width .3s ease; width:16%; }
    .megq-panel { display:none; padding:30px 32px 34px; }
    .megq-panel.megq-active { display:block; }
    .megq-kicker { color:var(--megq-cyan); font-size:11px; font-weight:700; letter-spacing:.15em; margin:0 0 12px; text-transform:uppercase; }
    .megq-title { font-family:var(--megq-display); font-size:clamp(23px,3.4vw,30px); font-weight:700; letter-spacing:-.02em; line-height:1.08; margin:0; }
    .megq-title em { color:var(--megq-cyan); font-style:normal; }
    .megq-copy { color:var(--megq-muted); font-size:14px; line-height:1.55; margin:12px 0 0; }

    .megq-intro { position:relative; overflow:hidden; }
    .megq-intro::before { content:""; position:absolute; top:-70px; right:-60px; width:260px; height:260px; background:radial-gradient(circle,rgba(78,197,220,.22),transparent 68%); pointer-events:none; z-index:0; }
    .megq-intro > * { position:relative; z-index:1; }
    .megq-badge { align-items:center; border:1px solid rgba(78,197,220,.38); border-radius:999px; color:var(--megq-cyan); display:inline-flex; font-size:10.5px; font-weight:700; gap:9px; letter-spacing:.12em; padding:7px 14px; text-transform:uppercase; }
    .megq-dot { background:var(--megq-cyan); border-radius:50%; flex:0 0 auto; height:8px; width:8px; box-shadow:0 0 0 0 rgba(78,197,220,.6); animation:megq-pulse 1.9s infinite; }
    .megq-intro-title { font-size:clamp(28px,4.8vw,37px); line-height:1.05; margin-top:18px; max-width:460px; }
    .megq-intro .megq-copy { max-width:440px; }
    .megq-scanner { align-items:flex-end; display:flex; gap:7px; height:46px; margin-top:26px; }
    .megq-scanner span { background:#242424; border-radius:3px; flex:1; height:100%; transform:scaleY(.3); transform-origin:bottom; animation:megq-scan 1.7s ease-in-out infinite; }
    .megq-scanner span:nth-child(1){animation-delay:0s}.megq-scanner span:nth-child(2){animation-delay:.12s}.megq-scanner span:nth-child(3){animation-delay:.24s}.megq-scanner span:nth-child(4){animation-delay:.36s}.megq-scanner span:nth-child(5){animation-delay:.48s}.megq-scanner span:nth-child(6){animation-delay:.6s}.megq-scanner span:nth-child(7){animation-delay:.72s}
    .megq-meta { align-items:center; color:#8f8f8f; display:flex; flex-wrap:wrap; gap:10px 20px; font-size:11.5px; font-weight:700; letter-spacing:.04em; margin-top:24px; text-transform:uppercase; }
    .megq-meta span { align-items:center; display:flex; gap:8px; }
    .megq-meta span::before { background:var(--megq-cyan); border-radius:50%; content:""; height:6px; width:6px; }
    .megq-start { align-items:center; background:var(--megq-gold); border:0; border-radius:3px; color:#121212; cursor:pointer; display:inline-flex; font-size:13px; font-weight:700; gap:16px; letter-spacing:.05em; margin-top:28px; min-height:56px; padding:16px 28px; text-transform:uppercase; box-shadow:0 12px 34px rgba(255,191,0,.22); transition:background .15s ease,transform .15s ease,box-shadow .15s ease; }
    .megq-start:hover { background:#ffcf3a; transform:translateY(-2px); box-shadow:0 16px 40px rgba(255,191,0,.3); }
    .megq-start span { transition:transform .15s ease; }
    .megq-start:hover span { transform:translateX(4px); }

    .megq-choices { display:grid; gap:8px; margin-top:22px; }
    .megq-choice { align-items:center; background:var(--megq-panel); border:1px solid var(--megq-line); color:#f2f2f2; cursor:pointer; display:flex; font-size:14px; font-weight:600; gap:12px; line-height:1.3; min-height:52px; padding:12px 15px; text-align:left; transition:border-color .15s ease,background .15s ease,transform .15s ease; width:100%; }
    .megq-choice:hover { background:#202826; border-color:var(--megq-cyan); transform:translateY(-1px); }
    .megq-choice span { align-items:center; border:1px solid #4a4a4a; border-radius:50%; color:var(--megq-cyan); display:flex; flex:0 0 auto; font-size:11px; font-weight:700; height:23px; justify-content:center; transition:background .15s ease,color .15s ease,border-color .15s ease; width:23px; }
    .megq-choice.megq-picked { background:rgba(78,197,220,.1); border-color:var(--megq-cyan); }
    .megq-choice.megq-picked span { background:var(--megq-cyan); border-color:var(--megq-cyan); color:#082e34; }
    .megq-nav { align-items:center; display:flex; margin-top:24px; min-height:20px; }
    .megq-back { background:transparent; border:0; color:#9c9c9c; cursor:pointer; font-size:12px; font-weight:700; padding:8px 0; text-transform:uppercase; }
    .megq-back:hover { color:#fff; }
    .megq-back[hidden] { display:none; }

    .megq-selected-note { align-items:center; background:rgba(78,197,220,.1); border-left:3px solid var(--megq-cyan); color:#dff7fb; display:flex; font-size:13px; font-weight:700; gap:8px; margin:22px 0; padding:12px 14px; }
    .megq-selected-note > span:first-child { color:var(--megq-cyan); }
    .megq-form-grid { display:grid; gap:16px; grid-template-columns:1fr 1.35fr; margin-top:24px; }
    .megq-field { display:flex; flex-direction:column; gap:7px; }
    .megq-field label { color:#e6e6e6; font-size:12px; font-weight:700; letter-spacing:.02em; }
    .megq-field input { appearance:none; background:#1a1a1a; border:1px solid #3a3a3a; border-radius:0; color:#fff; font:16px 'Helvetica Neue',Helvetica,Arial,sans-serif; min-height:51px; padding:12px 13px; width:100%; }
    .megq-field input::placeholder { color:#6f6f6f; }
    .megq-field input:focus { border-color:var(--megq-cyan); box-shadow:0 0 0 3px rgba(78,197,220,.22); outline:0; }
    .megq-consent { align-items:flex-start; color:#9c9c9c; display:flex; font-size:11px; gap:10px; line-height:1.45; margin-top:17px; }
    .megq-consent input { accent-color:var(--megq-cyan); flex:0 0 auto; height:17px; margin:0; width:17px; }
    .megq-consent a { color:var(--megq-cyan); }
    .megq-actions { align-items:center; display:flex; gap:14px; justify-content:space-between; margin-top:22px; }
    .megq-submit, .megq-cta { align-items:center; background:var(--megq-gold); border:0; color:#121212; cursor:pointer; display:inline-flex; font-size:12px; font-weight:700; gap:18px; justify-content:center; letter-spacing:.06em; min-height:52px; padding:14px 20px; text-decoration:none; text-transform:uppercase; transition:background .15s ease; }
    .megq-submit:hover, .megq-cta:hover { background:#ffcf3a; }
    .megq-submit[disabled] { cursor:wait; opacity:.65; }
    .megq-error { color:#ff6b6b; font-size:12px; margin:12px 0 0; min-height:17px; }
    .megq-result-box { background:var(--megq-panel); border:1px solid var(--megq-line); margin-top:24px; padding:22px; }
    .megq-result-box > strong { color:#fff; font-size:13px; letter-spacing:.02em; }
    .megq-result-box ul { display:grid; gap:10px; list-style:none; margin:16px 0 0; padding:0; }
    .megq-result-box li { color:#c9c9c9; font-size:13px; line-height:1.45; padding-left:24px; position:relative; }
    .megq-result-box li::before { color:var(--megq-cyan); content:'\\2713'; font-weight:700; left:0; position:absolute; }
    .megq-result-actions { align-items:center; display:flex; flex-wrap:wrap; gap:16px; margin-top:24px; }
    .megq-secondary { background:transparent; border:0; color:#9c9c9c; cursor:pointer; font-size:12px; font-weight:700; text-transform:uppercase; }
    .megq-secondary:hover { color:#fff; }

    @keyframes megq-pulse { 0%{box-shadow:0 0 0 0 rgba(78,197,220,.55)} 70%{box-shadow:0 0 0 9px rgba(78,197,220,0)} 100%{box-shadow:0 0 0 0 rgba(78,197,220,0)} }
    @keyframes megq-scan { 0%,100%{transform:scaleY(.3);background:#242424} 50%{transform:scaleY(1);background:var(--megq-cyan)} }

    @media (max-width:560px) {
      .megq-overlay { padding:12px; }
      .megq-dialog { max-height:96vh; }
      .megq-topbar { padding:14px 18px; }
      .megq-panel { padding:26px 20px 30px; }
      .megq-form-grid { grid-template-columns:1fr; }
      .megq-actions { align-items:stretch; flex-direction:column-reverse; }
      .megq-submit { width:100%; }
      .megq-back { align-self:flex-start; }
    }
    @media (prefers-reduced-motion:reduce) {
      .megq-overlay, .megq-dialog, .megq-choice, .megq-progress span, .megq-start { transition:none !important; }
      .megq-dot, .megq-scanner span { animation:none !important; }
      .megq-scanner span { transform:scaleY(.55); background:var(--megq-cyan); opacity:.5; }
    }
  `;

  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function build() {
    var style = document.createElement("style");
    style.id = "megq-styles";
    style.textContent = css;
    document.head.appendChild(style);

    var root = document.createElement("div");
    root.className = "megq-root";
    root.innerHTML = `
      <div class="megq-overlay" data-megq-overlay aria-hidden="true">
        <section class="megq-dialog" role="dialog" aria-modal="true" aria-labelledby="megq-title" tabindex="-1">
          <div class="megq-topbar">
            <div class="megq-brand"><img src="${escapeAttr(config.logoUrl)}" alt="Marketing Empire Group" height="26" /></div>
            <div class="megq-meta-right">
              <div class="megq-step-label" data-megq-step-label hidden>Question 1 of 5</div>
              <button class="megq-close" type="button" data-megq-close aria-label="Close quiz">&times;</button>
            </div>
          </div>
          <div class="megq-progress" data-megq-progress-bar hidden><span data-megq-progress></span></div>

          <div class="megq-scroll">
            <div class="megq-panel megq-intro megq-active" data-megq-panel="intro">
              <span class="megq-badge"><i class="megq-dot"></i>Free 60-second growth diagnostic</span>
              <h2 class="megq-title megq-intro-title" id="megq-title">One <em>hidden constraint</em> is capping your growth.</h2>
              <p class="megq-copy">Most businesses pour budget into marketing while a single bottleneck quietly caps the return. Answer five quick questions and we will pinpoint yours, right now.</p>
              <div class="megq-scanner" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
              <div class="megq-meta"><span>5 questions</span><span>60 seconds</span><span>Instant result</span></div>
              <button class="megq-start" type="button" data-megq-start>Reveal my #1 constraint <span aria-hidden="true">&#8594;</span></button>
            </div>

            <div class="megq-panel" data-megq-panel="question">
              <p class="megq-kicker" data-megq-q-kicker>Growth check</p>
              <h2 class="megq-title" data-megq-q-title></h2>
              <p class="megq-copy" data-megq-q-copy></p>
              <div class="megq-choices" data-megq-choices></div>
              <div class="megq-nav"><button class="megq-back" type="button" data-megq-back>&#8592; Back</button></div>
            </div>

            <div class="megq-panel" data-megq-panel="contact">
              <p class="megq-kicker">Almost there</p>
              <h2 class="megq-title">Where should we send your growth blueprint?</h2>
              <p class="megq-copy">We will use your answers to send the most relevant recommendations, not a generic marketing blast.</p>
              <div class="megq-selected-note"><span aria-hidden="true">&#10003;</span><span data-megq-selected></span></div>
              <form data-megq-form novalidate>
                <div class="megq-form-grid">
                  <div class="megq-field">
                    <label for="megq-first-name">First name</label>
                    <input id="megq-first-name" name="first_name" autocomplete="given-name" required />
                  </div>
                  <div class="megq-field">
                    <label for="megq-email">Work email</label>
                    <input id="megq-email" name="email" type="email" autocomplete="email" inputmode="email" required />
                  </div>
                </div>
                <label class="megq-consent">
                  <input name="consent" type="checkbox" required />
                  <span>Yes, send my blueprint and occasional marketing insights from Marketing Empire Group. I can unsubscribe at any time. <a href="${escapeAttr(config.privacyUrl)}" target="_blank" rel="noopener">Privacy policy</a>.</span>
                </label>
                <p class="megq-error" data-megq-error role="alert"></p>
                <div class="megq-actions">
                  <button class="megq-back" type="button" data-megq-contact-back>&#8592; Back</button>
                  <button class="megq-submit" type="submit">Reveal my result <span aria-hidden="true">&#8594;</span></button>
                </div>
              </form>
            </div>

            <div class="megq-panel" data-megq-panel="result">
              <p class="megq-kicker">Your growth constraint</p>
              <h2 class="megq-title" data-megq-result-title></h2>
              <p class="megq-copy" data-megq-result-body></p>
              <div class="megq-result-box">
                <strong>Your next three priorities</strong>
                <ul data-megq-result-list></ul>
              </div>
              <div class="megq-result-actions">
                <a class="megq-cta" href="${escapeAttr(config.bookingUrl)}" data-megq-booking>Build my growth plan <span aria-hidden="true">&#8599;</span></a>
                <button class="megq-secondary" type="button" data-megq-finish>Close and keep reading</button>
              </div>
            </div>
          </div>
        </section>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  var root = build();
  var overlay = root.querySelector("[data-megq-overlay]");
  var dialog = root.querySelector(".megq-dialog");
  var scrollEl = root.querySelector(".megq-scroll");
  var progressBar = root.querySelector("[data-megq-progress-bar]");
  var progress = root.querySelector("[data-megq-progress]");
  var stepLabel = root.querySelector("[data-megq-step-label]");
  var form = root.querySelector("[data-megq-form]");
  var error = root.querySelector("[data-megq-error]");
  var choicesEl = root.querySelector("[data-megq-choices]");
  var qKicker = root.querySelector("[data-megq-q-kicker]");
  var qTitle = root.querySelector("[data-megq-q-title]");
  var qCopy = root.querySelector("[data-megq-q-copy]");
  var qBack = root.querySelector("[data-megq-back]");

  var qIndex = 0;
  var answers = new Array(questions.length).fill(null);
  var result = null;

  function setProgress(stepNumber) {
    progress.style.width = Math.round((stepNumber / TOTAL_STEPS) * 100) + "%";
  }

  function panel(name) {
    root.querySelectorAll("[data-megq-panel]").forEach(function (node) {
      node.classList.toggle("megq-active", node.getAttribute("data-megq-panel") === name);
    });
    var showChrome = name !== "intro";
    progressBar.hidden = !showChrome;
    stepLabel.hidden = !showChrome;
    if (scrollEl) scrollEl.scrollTop = 0;
  }

  function renderQuestion(index) {
    qIndex = index;
    var q = questions[index];
    qKicker.textContent = q.kicker;
    qTitle.textContent = q.title;
    qCopy.textContent = q.copy;
    choicesEl.innerHTML = "";
    q.options.forEach(function (opt, i) {
      var btn = document.createElement("button");
      btn.className = "megq-choice" + (answers[index] === i ? " megq-picked" : "");
      btn.type = "button";
      btn.setAttribute("data-megq-option", String(i));
      var num = document.createElement("span");
      num.textContent = String(i + 1);
      btn.appendChild(num);
      btn.appendChild(document.createTextNode(opt.label));
      choicesEl.appendChild(btn);
    });
    qBack.hidden = false;
    stepLabel.textContent = "Question " + (index + 1) + " of " + questions.length;
    setProgress(index + 1);
    panel("question");
  }

  function chooseOption(optionIndex) {
    answers[qIndex] = optionIndex;
    if (qIndex < questions.length - 1) renderQuestion(qIndex + 1);
    else goToContact();
  }

  function goToContact() {
    result = computeResult();
    root.querySelector("[data-megq-selected]").textContent =
      "Likely constraint: " + constraints[result].label;
    stepLabel.textContent = "Last step";
    setProgress(TOTAL_STEPS);
    panel("contact");
    setTimeout(function () { root.querySelector("#megq-first-name").focus(); }, 0);
  }

  function computeResult() {
    var totals = {};
    Object.keys(constraints).forEach(function (id) { totals[id] = 0; });
    answers.forEach(function (optionIndex, qi) {
      if (optionIndex === null) return;
      var scores = questions[qi].options[optionIndex].scores;
      Object.keys(scores).forEach(function (id) { totals[id] += scores[id]; });
    });
    var q1Choice = answers[0] !== null
      ? Object.keys(questions[0].options[answers[0]].scores)[0]
      : null;
    var best = null, bestScore = -1;
    Object.keys(totals).forEach(function (id) {
      if (totals[id] > bestScore || (totals[id] === bestScore && id === q1Choice)) {
        best = id; bestScore = totals[id];
      }
    });
    return best;
  }

  function canAutoOpen() {
    if (!config.autoOpen || autoOpenConsumed) return false;
    if (localStorage.getItem(STORAGE_COMPLETE) === "1") return false;
    var closedUntil = Number(localStorage.getItem(STORAGE_CLOSED) || 0);
    return !closedUntil || Date.now() > closedUntil;
  }

  function open(manual) {
    if (!manual && !canAutoOpen()) return;
    autoOpenConsumed = true;
    lastFocused = document.activeElement;
    overlay.classList.add("megq-open");
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("megq-lock");
    setTimeout(function () { dialog.focus(); }, 0);
  }

  function close(completed) {
    overlay.classList.remove("megq-open");
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("megq-lock");
    if (completed) localStorage.setItem(STORAGE_COMPLETE, "1");
    else localStorage.setItem(STORAGE_CLOSED, String(Date.now() + config.cooldownDays * 86400000));
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function getTracking() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      utm_term: params.get("utm_term") || "",
    };
  }

  function answerSummary() {
    return answers.map(function (optionIndex, qi) {
      return optionIndex === null ? "" : questions[qi].options[optionIndex].label;
    });
  }

  async function submit(payload) {
    window.dispatchEvent(new CustomEvent("megQuizSubmitted", { detail: payload }));
    if (!config.webhookUrl) { console.info("MEG quiz preview submission", payload); return; }
    var response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Submission failed");
  }

  function showResult() {
    var c = constraints[result];
    root.querySelector("[data-megq-result-title]").textContent = c.title;
    root.querySelector("[data-megq-result-body]").textContent = c.body;
    var list = root.querySelector("[data-megq-result-list]");
    list.innerHTML = "";
    c.actions.forEach(function (action) {
      var li = document.createElement("li");
      li.textContent = action;
      list.appendChild(li);
    });
    stepLabel.textContent = "Your result";
    panel("result");
    localStorage.setItem(STORAGE_COMPLETE, "1");
  }

  root.addEventListener("click", function (event) {
    if (event.target.closest("[data-megq-start]")) renderQuestion(0);
    var opt = event.target.closest("[data-megq-option]");
    if (opt) chooseOption(Number(opt.getAttribute("data-megq-option")));
    if (event.target.closest("[data-megq-close]")) close(false);
    if (event.target.closest("[data-megq-back]")) { if (qIndex > 0) renderQuestion(qIndex - 1); else panel("intro"); }
    if (event.target.closest("[data-megq-contact-back]")) renderQuestion(questions.length - 1);
    if (event.target.closest("[data-megq-finish]")) close(true);
    if (event.target === overlay) close(false);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    error.textContent = "";
    if (!result) { renderQuestion(0); return; }
    if (!form.checkValidity()) {
      error.textContent = "Please enter a valid email and confirm your permission.";
      form.reportValidity();
      return;
    }
    var submitButton = form.querySelector("[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "Preparing your result…";
    var data = new FormData(form);
    var payload = Object.assign({
      first_name: String(data.get("first_name") || "").trim(),
      email: String(data.get("email") || "").trim().toLowerCase(),
      primary_growth_constraint: result,
      primary_growth_constraint_label: constraints[result].label,
      quiz_answers: answerSummary(),
      email_marketing_permission: "Subscribed",
      acquisition_source: config.acquisitionSource,
      lifecycle_stage: "Subscriber",
      page_url: window.location.href,
      page_title: document.title,
      referrer: document.referrer || "",
      submitted_at: new Date().toISOString(),
    }, getTracking());
    try {
      await submit(payload);
      showResult();
    } catch (submissionError) {
      console.error(submissionError);
      error.textContent = "We could not send your result. Please try again.";
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Reveal my result <span aria-hidden="true">&#8594;</span>';
    }
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-meg-quiz-open]")) { event.preventDefault(); open(true); }
  });

  document.addEventListener("keydown", function (event) {
    if (!overlay.classList.contains("megq-open")) return;
    if (event.key === "Escape") close(false);
    if (event.key === "Tab") {
      var focusable = Array.from(dialog.querySelectorAll(
        'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(function (node) { return node.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  if (config.autoOpen) {
    window.setTimeout(function () { open(false); }, config.delayMs);

    var onScroll = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && (window.scrollY / max) * 100 >= config.scrollPercent) {
        window.removeEventListener("scroll", onScroll);
        open(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    if (config.exitIntent && window.matchMedia("(pointer:fine)").matches) {
      document.addEventListener("mouseout", function onExit(event) {
        if (event.clientY <= 0 && !event.relatedTarget) {
          document.removeEventListener("mouseout", onExit);
          open(false);
        }
      });
    }
  }

  window.MEGGrowthQuiz = {
    initialized: true,
    open: function () { open(true); },
    close: function () { close(false); },
    reset: function () {
      localStorage.removeItem(STORAGE_CLOSED);
      localStorage.removeItem(STORAGE_COMPLETE);
      answers = new Array(questions.length).fill(null);
      result = null;
      form.reset();
      panel("intro");
    },
  };
})();
