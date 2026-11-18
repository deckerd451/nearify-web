/**
 * reach.js — turning "how to reach them" into safe, one-tap actions, a
 * contact card (.vcf), and a ready-to-send "here's my card" message.
 *
 * Only https:, mailto:, sms: and tel: links are ever produced. Nothing here
 * sends anything: links open the person's own Messages, Mail or browser with
 * text they can edit before sending.
 */

export const REACH_MAX = 120;

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const SOCIAL = {
  "linkedin.com": "LinkedIn",
  "instagram.com": "Instagram",
  "x.com": "X",
  "twitter.com": "X",
  "github.com": "GitHub",
  "threads.net": "Threads",
  "bsky.app": "Bluesky",
  "facebook.com": "Facebook",
};

function siteName(host) {
  const bare = host.replace(/^www\./, "").replace(/^m\./, "");
  for (const [domain, name] of Object.entries(SOCIAL)) {
    if (bare === domain || bare.endsWith("." + domain)) return name;
  }
  return null;
}

/**
 * Reads what someone typed and returns what it is:
 *   { kind: "phone", value, digits }    a phone number (7–15 digits)
 *   { kind: "email", value }
 *   { kind: "link", value, url, site }  https URL; site is e.g. "LinkedIn" or null
 *   { kind: "text", value }             anything else, shown as written
 * Returns null for empty input.
 */
export function parseReach(input) {
  const value = typeof input === "string" ? input.replace(/\s+/g, " ").trim().slice(0, REACH_MAX).trim() : "";
  if (!value) return null;

  if (EMAIL.test(value)) return { kind: "email", value };

  if (/^[+()\d][\d\s().-]*$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      return { kind: "phone", value, digits: (value.trim().startsWith("+") ? "+" : "") + digits };
    }
  }

  // A web address, with or without https://. Never anything but https.
  const candidate = /^https?:\/\//i.test(value) ? value : (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value) ? "https://" + value : null);
  if (candidate) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".")) {
        url.protocol = "https:";
        return { kind: "link", value, url: url.toString(), site: siteName(url.hostname) };
      }
    } catch (_) { /* not a URL */ }
  }

  return { kind: "text", value };
}

function firstName(name) {
  return (name || "").trim().split(/\s+/)[0] || "there";
}

/**
 * The message a person sends to someone they just saved. With a card URL
 * (signed in) it links to their Nearify card; without one it simply gives
 * the other person their number or email by being sent from it.
 */
export function cardMessage({ theirName, where, myName, myCardUrl, via }) {
  const hi = `Hi ${firstName(theirName)}, great meeting you${where ? ` at ${where}` : ""}!`;
  if (myCardUrl) return `${hi} Here’s my card so you have my details: ${myCardUrl}`;
  const me = myName ? ` It’s ${myName.trim()}.` : "";
  return via === "email" ? `${hi}${me} Now you have my email.` : `${hi}${me} Now you have my number.`;
}

/**
 * One-tap actions for a saved person.
 * Returns [{ label, href, primary? }] using only safe schemes.
 */
export function reachActions(person, { myName, myCardUrl } = {}) {
  const reach = parseReach(person?.reach);
  if (!reach) return [];
  const first = firstName(person.name);
  if (reach.kind === "phone") {
    const body = cardMessage({ theirName: person.name, where: person.where, myName, myCardUrl, via: "sms" });
    return [
      { label: `Send ${first} your card`, href: `sms:${reach.digits}?&body=${encodeURIComponent(body)}`, primary: true },
      { label: "Call", href: `tel:${reach.digits}` },
    ];
  }
  if (reach.kind === "email") {
    const body = cardMessage({ theirName: person.name, where: person.where, myName, myCardUrl, via: "email" });
    const subject = "Great meeting you";
    return [{ label: `Email ${first} your card`, href: `mailto:${encodeURIComponent(reach.value)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, primary: true }];
  }
  if (reach.kind === "link") {
    return [{ label: reach.site ? `Open ${reach.site}` : "Open their link", href: reach.url, primary: true, external: true }];
  }
  return [];
}

// ── Contact card (.vcf, vCard 3.0) ───────────────────────────────────────────

function vText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** A contact card the phone's Contacts app can open, with your note in it. */
export function buildVCard(person) {
  const name = (person.name || "").trim();
  const parts = name.split(/\s+/);
  const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
  const family = parts.length > 1 ? parts[parts.length - 1] : "";
  const reach = parseReach(person.reach);
  const note = [person.where ? `Met: ${person.where}` : "", person.note || "", "Saved with Nearify"].filter(Boolean).join("\n");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${vText(family)};${vText(given)};;;`, `FN:${vText(name)}`];
  if (reach?.kind === "phone") lines.push(`TEL;TYPE=CELL:${reach.digits}`);
  if (reach?.kind === "email") lines.push(`EMAIL;TYPE=INTERNET:${vText(reach.value)}`);
  if (reach?.kind === "link") lines.push(`URL:${vText(reach.url)}`);
  if (reach?.kind === "text") lines.push(`X-SOCIALPROFILE:${vText(reach.value)}`);
  lines.push(`NOTE:${vText(note)}`, "END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export function vCardFileName(person) {
  const slug = (person.name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug || "contact"}.vcf`;
}

/** How the reach line reads on a card. */
export function reachLabel(person) {
  const reach = parseReach(person?.reach);
  return reach ? reach.value : "";
}
