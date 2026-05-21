/**
 * share.js — Share button component for Nearify
 *
 * Uses the Web Share API when available (mobile browsers),
 * falls back to copy-to-clipboard with a toast confirmation.
 *
 * Usage:
 *   import { renderShareButton } from "./share.js";
 *   renderShareButton(container, { title, text, url });
 */

import { logger } from "./logger.js";

/**
 * @typedef {Object} ShareData
 * @property {string} title - Share title (event name)
 * @property {string} text - Share body text
 * @property {string} url - URL to share
 */

/**
 * Render a share button into a container element.
 * @param {HTMLElement} container - DOM element to append the button to
 * @param {ShareData} data - Share payload
 * @param {Object} [options]
 * @param {string} [options.label="Share"] - Button label
 * @param {string} [options.className="btn secondary"] - CSS class
 * @param {string} [options.trackCta] - data-track-cta value for analytics
 */
export function renderShareButton(container, data, options = {}) {
  const {
    label = "Share",
    className = "btn secondary",
    trackCta = "share_event",
  } = options;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  if (trackCta) btn.setAttribute("data-track-cta", trackCta);

  btn.addEventListener("click", () => handleShare(btn, data));
  container.appendChild(btn);
  return btn;
}

/**
 * Trigger the share action — Web Share API or clipboard fallback.
 * @param {HTMLButtonElement} btn - The button element (for feedback)
 * @param {ShareData} data - Share payload
 */
async function handleShare(btn, data) {
  // Web Share API — available on mobile Safari, Chrome Android, etc.
  if (navigator.share) {
    try {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: data.url,
      });
      logger.log("[Share] shared via Web Share API");
      return;
    } catch (err) {
      // User cancelled — not an error
      if (err.name === "AbortError") return;
      logger.warn("[Share] Web Share API failed, falling back to clipboard", err);
    }
  }

  // Fallback: copy URL to clipboard
  try {
    await navigator.clipboard.writeText(data.url);
    showCopyFeedback(btn, "Copied!");
    logger.log("[Share] copied to clipboard");
  } catch (err) {
    // Final fallback: select + copy via textarea
    fallbackCopy(data.url);
    showCopyFeedback(btn, "Copied!");
    logger.log("[Share] copied via fallback");
  }
}

/**
 * Show temporary feedback on the button.
 */
function showCopyFeedback(btn, message) {
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 2000);
}

/**
 * Fallback copy using a temporary textarea (for older browsers).
 */
function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

/**
 * Build a share URL for the event detail page.
 * @param {Object} event - Event object with slug/id
 * @returns {string}
 */
export function buildEventShareUrl(event) {
  const slug = event.slug || event.id;
  return `https://nearify.org/events/event.html?slug=${encodeURIComponent(slug)}`;
}

/**
 * Build share text for an event.
 * @param {Object} event - Event object with name, location, starts_at
 * @returns {string}
 */
export function buildEventShareText(event) {
  const parts = [event.name];
  if (event.location) parts.push(`at ${event.location}`);
  if (event.starts_at) {
    const date = new Date(event.starts_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    parts.push(`on ${date}`);
  }
  return parts.join(" ") + " — join on Nearify";
}
