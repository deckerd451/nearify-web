// Resolve only supported Nearify QR routes. Never navigate to arbitrary scanned URLs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function resolveWebQr(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.username || url.password || url.hash || url.port) return null;
    if (url.protocol === 'beacon:' && url.hostname === 'event' && !url.search) {
      const event = url.pathname.slice(1);
      return UUID.test(event) ? `/join/?event=${encodeURIComponent(event)}&web=1` : null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'nearify.org' || url.port) return null;
    if (['/join/', '/join', '/join/index.html'].includes(url.pathname)) {
      const event = url.searchParams.get('event');
      const guest = url.searchParams.get('guest');
      const profile = url.searchParams.get('profile');
      if (!UUID.test(event || '') || (guest && !/^[a-f0-9]{64}$/.test(guest)) || (profile && !UUID.test(profile)) || (guest && profile)) return null;
      const clean = new URLSearchParams({event,web:'1'});
      if (guest) clean.set('guest',guest);
      if (profile) clean.set('profile',profile);
      return '/join/?' + clean;
    }
    if (url.pathname === '/events/event.html') {
      const id = url.searchParams.get('id');
      const slug = url.searchParams.get('slug');
      if (id && UUID.test(id)) return '/events/event.html?' + new URLSearchParams({id,web:'1'});
      if (slug && /^[a-z0-9][a-z0-9_-]{0,199}$/i.test(slug)) return '/events/event.html?' + new URLSearchParams({slug,web:'1'});
    }
  } catch (_) { /* Invalid QR data is displayed as an error, never evaluated. */ }
  return null;
}

// Sharing a person and sharing an event are different actions. Event-bound
// connections must never be silently recorded against the caller's current event.
export function classifyWebQr(value, currentEventId) {
  const route = resolveWebQr(value);
  if (!route) return {kind:'invalid'};
  const url = new URL(route, 'https://nearify.org');
  const eventId = url.searchParams.get('event');
  const guest = url.searchParams.get('guest');
  const profile = url.searchParams.get('profile');
  if (!guest && !profile) return {kind:'event',route};
  if (eventId.toLowerCase() !== String(currentEventId).toLowerCase()) return {kind:'different_event',route};
  return {kind:guest ? 'guest' : 'member',value:guest || profile,route};
}
