// A self-contained pop-up / quiz embed used by tests and local screenshot
// fixtures. It is not a client asset. Timed open, scroll, and exit intent are
// all in the snippet so a website preview can prove those triggers run as
// stored, without the preview calling them itself.

export const FIXTURE_POPUP_OPEN_DELAY_MS = 8000;
export const FIXTURE_SNOOZE_KEY = "meg-fixture-quiz-snooze";
export const FIXTURE_SEEN_KEY = "meg-fixture-quiz-seen";
export const FIXTURE_OPEN_FUNCTION = "megOpenQuiz";

export const FIXTURE_POPUP_SNIPPET = `<div class="meg-fixture" id="meg-fixture" hidden>
  <div class="meg-fixture-backdrop" data-meg-backdrop></div>
  <div class="meg-fixture-panel" role="dialog" aria-modal="true" aria-labelledby="meg-fixture-title">
    <div class="meg-fixture-grabber" aria-hidden="true"></div>
    <button type="button" class="meg-fixture-close" aria-label="Close">×</button>
    <p class="meg-fixture-kicker">Two quick questions</p>
    <h2 id="meg-fixture-title">Find the next step</h2>
    <div class="meg-fixture-step" data-step="1">
      <p class="meg-fixture-count">Step 1 of 2</p>
      <p class="meg-fixture-q">What do you want help with?</p>
      <div class="meg-fixture-options">
        <button type="button" class="meg-fixture-option">Sleep</button>
        <button type="button" class="meg-fixture-option">Energy</button>
        <button type="button" class="meg-fixture-option">Focus</button>
      </div>
      <button type="button" class="meg-fixture-next" data-goto="2">Next</button>
    </div>
    <div class="meg-fixture-step" data-step="2" hidden>
      <p class="meg-fixture-count">Step 2 of 2</p>
      <p class="meg-fixture-q">When do you want to start?</p>
      <div class="meg-fixture-options">
        <button type="button" class="meg-fixture-option">This month</button>
        <button type="button" class="meg-fixture-option">Just looking</button>
      </div>
      <button type="button" class="meg-fixture-next" data-goto="done">See my result</button>
    </div>
    <div class="meg-fixture-step" data-step="done" hidden>
      <p class="meg-fixture-q">Thanks. Someone can walk you through the next step.</p>
      <p class="meg-fixture-note">This is a sample quiz inside the preview. Nothing was submitted.</p>
    </div>
    <div class="meg-fixture-foot">
      <button type="button" class="meg-fixture-snooze">Not now</button>
      <a class="meg-fixture-privacy" href="https://example.com/privacy" target="_top">Privacy</a>
    </div>
  </div>
</div>
<style>
  .meg-fixture { position: fixed; inset: 0; z-index: 2147483000; }
  .meg-fixture[hidden] { display: none !important; }
  .meg-fixture-backdrop { position: absolute; inset: 0; background: rgba(17, 17, 17, 0.55); }
  .meg-fixture-panel {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(440px, calc(100% - 32px)); max-height: calc(100% - 48px); overflow: auto;
    background: #fffefb; color: #1c1917; border-radius: 18px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28); padding: 22px 22px 16px;
    font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  }
  .meg-fixture-grabber { display: none; width: 42px; height: 4px; border-radius: 99px; background: #d6d3d1; margin: 2px auto 12px; }
  .meg-fixture-close {
    position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; border: 0;
    border-radius: 999px; background: #f5f0e8; color: #1c1917; font-size: 20px; line-height: 1; cursor: pointer;
  }
  .meg-fixture-kicker { margin: 0 36px 6px 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #78716c; }
  .meg-fixture-panel h2 { margin: 0 36px 14px 0; font-size: 30px; line-height: 1.15; font-weight: 600; }
  .meg-fixture-count { margin: 0 0 6px; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #78716c; }
  .meg-fixture-q { margin: 0 0 12px; font-size: 20px; line-height: 1.35; }
  .meg-fixture-options { display: flex; flex-direction: column; gap: 8px; }
  .meg-fixture-option, .meg-fixture-next {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 15px; text-align: left;
    border-radius: 10px; cursor: pointer;
  }
  .meg-fixture-option { border: 1px solid #e7e5e4; background: #fff; padding: 10px 12px; }
  .meg-fixture-option.is-selected { border-color: #1c1917; background: #f5f0e8; }
  .meg-fixture-next { margin-top: 14px; width: 100%; border: 0; background: #1c1917; color: #fffefb; padding: 12px 14px; font-weight: 600; text-align: center; }
  .meg-fixture-note { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 14px; color: #57534e; }
  .meg-fixture-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
  .meg-fixture-snooze { border: 0; background: transparent; padding: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #57534e; cursor: pointer; text-decoration: underline; }
  .meg-fixture-privacy { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #57534e; }
  @media (max-width: 700px) {
    .meg-fixture-panel {
      left: 0; right: 0; top: auto; bottom: 0; transform: none; width: 100%;
      max-height: 82%; border-radius: 22px 22px 0 0; padding: 10px 18px 18px;
    }
    .meg-fixture-grabber { display: block; }
    .meg-fixture-panel h2 { font-size: 26px; }
  }
</style>
<script>
(function () {
  var OPEN_DELAY = ${FIXTURE_POPUP_OPEN_DELAY_MS};
  var SNOOZE_KEY = ${JSON.stringify(FIXTURE_SNOOZE_KEY)};
  var SEEN_KEY = ${JSON.stringify(FIXTURE_SEEN_KEY)};
  var root = document.getElementById("meg-fixture");
  if (!root) return;
  function snoozed() {
    try { return localStorage.getItem(SNOOZE_KEY) === "1"; } catch (e) { return false; }
  }
  function show() {
    root.hidden = false;
    root.classList.add("is-open");
  }
  function hide() {
    root.hidden = true;
    root.classList.remove("is-open");
  }
  function showStep(name) {
    var steps = root.querySelectorAll("[data-step]");
    for (var i = 0; i < steps.length; i++) {
      steps[i].hidden = steps[i].getAttribute("data-step") !== name;
    }
  }
  root.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest("[data-meg-backdrop]") || target.closest(".meg-fixture-close")) {
      hide();
      return;
    }
    if (target.closest(".meg-fixture-snooze")) {
      try { localStorage.setItem(SNOOZE_KEY, "1"); } catch (e) {}
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
      hide();
      return;
    }
    var option = target.closest(".meg-fixture-option");
    if (option) {
      var group = option.parentNode.querySelectorAll(".meg-fixture-option");
      for (var i = 0; i < group.length; i++) group[i].classList.remove("is-selected");
      option.classList.add("is-selected");
      return;
    }
    var next = target.closest(".meg-fixture-next");
    if (next) showStep(next.getAttribute("data-goto") || "done");
  });
  window.${FIXTURE_OPEN_FUNCTION} = function () { show(); };
  function autoOpen() {
    if (snoozed() || root.classList.contains("is-open")) return;
    show();
  }
  setTimeout(autoOpen, OPEN_DELAY);
  window.addEventListener("scroll", function () {
    if (snoozed()) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    if (window.scrollY / max >= 0.45) autoOpen();
  }, { passive: true });
  document.documentElement.addEventListener("mouseout", function (event) {
    if (snoozed()) return;
    if (event.clientY > 0) return;
    if (event.relatedTarget) return;
    autoOpen();
  });
})();
</script>`;
