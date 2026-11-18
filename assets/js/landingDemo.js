/**
 * landingDemo.js — the signed-out homepage "Try it" demo.
 *
 * A visitor can see what Nearify does without an event, a QR code, or an
 * account. What they type stays in this page. Only anonymous step counts are
 * sent (see landingDemoTracking.js), never the note or who the visitor is.
 */

import { LANDING_DEMO_EVENTS as EVENTS, analyticsTracker, createOnceTracker } from "./landingDemoTracking.js?v=20261118-count1";

const trackOnce = createOnceTracker(analyticsTracker());

const DEFAULT_NOTE = "Ask how the flood alert launch went";

function init() {
  const demo = document.getElementById("lxDemo");
  if (!demo) return;

  const stages = demo.querySelectorAll(".lx-stage");
  const dots = demo.querySelectorAll("[data-step-dot]");
  const note = document.getElementById("lxNote");
  const echo = document.getElementById("lxNoteEcho");

  function show(step, { focus = true } = {}) {
    stages.forEach((stage) => { stage.hidden = stage.dataset.step !== String(step); });
    dots.forEach((dot) => {
      const n = Number(dot.dataset.stepDot);
      dot.classList.toggle("is-current", n === step);
      dot.classList.toggle("is-done", n < step);
      if (n === step) dot.setAttribute("aria-current", "step");
      else dot.removeAttribute("aria-current");
    });
    if (step === 2) trackOnce(EVENTS.started);
    if (step === 3) trackOnce(EVENTS.completed);
    if (step === 3) echo.textContent = "“" + (note.value.trim() || DEFAULT_NOTE) + "”";
    if (!focus) return;
    const active = demo.querySelector(`.lx-stage[data-step="${step}"]`);
    active.classList.remove("is-entering");
    void active.offsetWidth; // restart the entrance animation
    active.classList.add("is-entering");
    const target = step === 2 ? note : active.querySelector("p, h3");
    if (target) {
      if (!target.matches("textarea")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  }

  demo.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => show(Number(button.dataset.go)));
  });

  demo.querySelectorAll(".lx-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      demo.querySelectorAll(".lx-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      note.value = chip.textContent.trim();
    });
    chip.setAttribute("aria-pressed", "false");
  });

  note.addEventListener("input", () => {
    demo.querySelectorAll(".lx-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  });

  demo.querySelector('.lx-stage[data-step="3"] a.btn')?.addEventListener("click", () => trackOnce(EVENTS.ctaClicked));

  document.getElementById("lxReplay")?.addEventListener("click", () => {
    note.value = "";
    demo.querySelectorAll(".lx-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    show(1);
  });

  // The hero link jumps to the demo and puts focus on its first action.
  document.getElementById("lxTryLink")?.addEventListener("click", (event) => {
    const section = document.getElementById("try");
    if (!section) return;
    event.preventDefault();
    trackOnce(EVENTS.tryClicked);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    demo.querySelector('.lx-stage:not([hidden]) button')?.focus({ preventScroll: true });
    history.replaceState(null, "", "#try");
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
