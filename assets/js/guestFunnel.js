import { trackFunnelEvent } from './analytics.js?v=20261105-funnel1';

const events = new Set([
  'guest_event_opened', 'guest_join_viewed', 'guest_session_created', 'guest_join_failed',
  'guest_scan_requested', 'guest_scan_started', 'guest_scan_failed',
  'guest_connection_save_requested', 'guest_connection_saved', 'guest_connection_save_failed',
  'guest_claim_started', 'guest_claim_failed', 'guest_account_claimed',
]);
const allowed = {
  method: new Set(['camera', 'link', 'handoff']),
  decoder: new Set(['native', 'jsqr']),
  connection_kind: new Set(['guest', 'member']),
  reason: new Set(['self_qr', 'invalid_qr', 'session_missing', 'request_failed', 'permission_denied', 'camera_unavailable', 'decoder_unavailable', 'decode_failed', 'profile_missing', 'history_unavailable']),
  source: new Set(['meetup']),
};
const journeys = new Map();
function journey(eventId) {
  if (journeys.has(eventId)) return journeys.get(eventId);
  let id;
  try { id = sessionStorage.getItem(`nearify_journey:${eventId}`); } catch (_) {}
  if (!id || !/^[\da-f-]{36}$/i.test(id)) {
    // No identity, guest credential, or target QR is used for correlation.
    id = globalThis.crypto?.randomUUID?.();
    if (!id) return null;
    try { sessionStorage.setItem(`nearify_journey:${eventId}`, id); } catch (_) {}
  }
  journeys.set(eventId, id);
  return id;
}

export function trackGuestFunnel(name, eventId, properties = {}, { once = false } = {}) {
  // Telemetry must never change a successful join/save/claim into a failure.
  try {
    if (!events.has(name) || !eventId) return;
    const id = journey(eventId);
    const marker = `nearify_funnel:${eventId}:${name}`;
    if (once) {
      try {
        if (sessionStorage.getItem(marker)) return;
        sessionStorage.setItem(marker, '1');
      } catch (_) { /* Storage may be unavailable in private browsing. */ }
    }
    const safe = {};
    if (id) safe.journey_id = id;
    for (const [key, values] of Object.entries(allowed)) {
      if (values.has(properties[key])) safe[key] = properties[key];
    }
    // Explicit empty referrer excludes incoming QR links and OAuth query strings.
    trackFunnelEvent(name, { eventId, referrer: '', ...safe });
  } catch (_) { /* Best effort: analytics cannot block the guest workflow. */ }
}
