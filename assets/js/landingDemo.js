/**
 * landingDemo.js — the signed-out homepage card demo.
 *
 * Save Maya → the card flips so you can jot one detail → it flips back and
 * the "two weeks later" reminder appears. What the visitor types stays in
 * this page. Only anonymous step counts are sent (see landingDemoTracking.js),
 * never the note or who the visitor is.
 */

import { LANDING_DEMO_EVENTS as EVENTS, analyticsTracker, createOnceTracker } from "./landingDemoTracking.js?v=20261118-count1";

const trackOnce = createOnceTracker(analyticsTracker());

const DEFAULT_NOTE = "Ask how the flood alert launch went";

function init() {
  const demo = document.getElementById("lxDemo");
  if (!demo) return;

  const front = demo.querySelector('.lx-stage[data-step="1"]');
  const back = demo.querySelector('.lx-stage[data-step="2"]');
  const after = demo.querySelector('.lx-stage[data-step="3"]');
  const reminder = document.getElementById("lxReminder");
  const note = document.getElementById("lxNote");
  const echo = document.getElementById("lxNoteEcho");
  const chips = demo.querySelectorAll(".lx-chip");

  // Both faces stay in the layout for the flip; the one facing away is inert.
  function face(el, visible) {
    el.hidden = false;
    el.inert = !visible;
    el.setAttribute("aria-hidden", String(!visible));
  }

  function show(step, { focus = true } = {}) {
    demo.dataset.state = String(step);
    face(front, step !== 2);
    face(back, step === 2);
    after.hidden = step !== 3;
    reminder.hidden = step !== 3;

    if (step === 2) trackOnce(EVENTS.started);
    if (step === 3) {
      trackOnce(EVENTS.completed);
      echo.textContent = "“" + (note.value.trim() || DEFAULT_NOTE) + "”";
    }
    if (!focus) return;
    if (step === 2) note.focus({ preventScroll: true });
    if (step === 3) {
      reminder.setAttribute("tabindex", "-1");
      reminder.focus({ preventScroll: true });
    }
    if (step === 1) front.querySelector("button")?.focus({ preventScroll: true });
  }

  demo.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => show(Number(button.dataset.go)));
  });

  chips.forEach((chip) => {
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      note.value = chip.textContent.trim();
    });
  });
  note.addEventListener("input", () => chips.forEach((c) => c.setAttribute("aria-pressed", "false")));

  after.querySelector("a.btn")?.addEventListener("click", () => trackOnce(EVENTS.ctaClicked));

  document.getElementById("lxReplay")?.addEventListener("click", () => {
    note.value = "";
    chips.forEach((c) => c.setAttribute("aria-pressed", "false"));
    show(1);
  });

  show(1, { focus: false });

  // dashboard.js decides signed-in vs signed-out after the auth check, then
  // reveals the landing view. Count a view only once it is actually shown.
  const landing = document.getElementById("landingView");
  const countViewIfShown = () => {
    if (landing && landing.style.display !== "none") trackOnce(EVENTS.view);
  };
  if (landing) {
    countViewIfShown();
    new MutationObserver(countViewIfShown).observe(landing, { attributes: true, attributeFilter: ["style"] });
  }
}

init();
