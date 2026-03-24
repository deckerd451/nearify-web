import { supabase } from "./supabaseClient.js";

function getEventId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("event");
}

function getEventName() {
  const params = new URLSearchParams(window.location.search);
  return params.get("name");
}

function buildDeepLink(eventId) {
  return `beacon://event/${eventId}`;
}

function updateJoinPage() {
  const eventId = getEventId();
  const eventName = getEventName();

  const title = document.getElementById("joinTitle");
  const description = document.getElementById("joinDescription");
  const payloadText = document.getElementById("payloadText");
  const openBtn = document.getElementById("openNearifyBtn");
  const openBtnBottom = document.getElementById("openNearifyBtnBottom");

  if (!eventId) {
    title.textContent = "No event selected";
    description.textContent =
      "This join link is missing an event ID. Please return to the event page or ask the organizer for the correct event link.";
    payloadText.textContent = "Missing event ID";
    openBtn.setAttribute("href", "#");
    openBtnBottom.setAttribute("href", "#");
    openBtn.classList.add("disabled-link");
    openBtnBottom.classList.add("disabled-link");
    return;
  }

  const deepLink = buildDeepLink(eventId);
  const labelName = eventName ? decodeURIComponent(eventName) : "this event";

  title.textContent = `Open Nearify to join ${labelName}`;
  description.textContent =
    "Tap below to open Nearify and enter the live event network. If the app is not installed yet, use the TestFlight link instead.";
  payloadText.textContent = deepLink;

  openBtn.setAttribute("href", deepLink);
  openBtnBottom.setAttribute("href", deepLink);
}

document.addEventListener("DOMContentLoaded", updateJoinPage);
