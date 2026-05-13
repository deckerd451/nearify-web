// supabase/functions/og-image/index.ts
// Dynamic Open Graph image generation for Nearify events.
//
// Usage: GET /functions/v1/og-image?slug=<slug>&id=<uuid>
//
// Returns a 1200x630 SVG image with:
//   - Event title (adaptive sizing)
//   - Date + location
//   - Attendee momentum
//   - Nearify branding
//   - Dark cinematic aesthetic matching the Nearify design language
//
// Cacheable via CDN headers (1 hour public, 24 hour stale-while-revalidate).
//
// Architecture:
//   1. Fetches event data from Supabase (using service role key)
//   2. Fetches attendee count + intent breakdown for momentum
//   3. Renders SVG with event details
//   4. Returns with image/svg+xml content type
//
// Platform compatibility:
//   - LinkedIn, Discord, Slack: render SVG og:image correctly
//   - Twitter/X: requires PNG (falls back to og-default.png via twitter:image)
//   - iMessage: renders SVG
//
// Fallback: If the function isn't deployed or errors, event pages
// still reference og-default.png as the twitter:image fallback.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const WIDTH = 1200;
const HEIGHT = 630;

interface EventData {
  id: string;
  name: string;
  slug: string | null;
  location: string | null;
  starts_at: string | null;
  description: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSvg(event: EventData, attendeeCount: number, momentum: string): string {
  const title = escapeXml(truncate(event.name, 55));
  const date = escapeXml(formatDate(event.starts_at));
  const location = event.location ? escapeXml(truncate(event.location, 36)) : "";
  const metaLine = [date, location].filter(Boolean).join("  \u00b7  ");
  const momentumLine = attendeeCount > 0
    ? escapeXml(`${attendeeCount} attending${momentum ? `  \u00b7  ${momentum}` : ""}`)
    : "";

  // Adaptive title sizing based on character count
  const titleFontSize = title.length > 40 ? 42 : title.length > 28 ? 50 : 58;
  const titleY = 280;
  const metaY = titleY + 60;
  const momentumY = metaY + 48;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="40%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#0a0f1a"/>
    </linearGradient>
    <radialGradient id="glow" cx="15%" cy="85%" r="55%">
      <stop offset="0%" stop-color="#30d158" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#30d158" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="85%" cy="15%" r="45%">
      <stop offset="0%" stop-color="#30d158" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#30d158" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background layers -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow2)"/>

  <!-- Subtle edge glow -->
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" fill="none" stroke="rgba(48,209,88,0.1)" stroke-width="1"/>

  <!-- Kicker -->
  <text x="80" y="88" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#30d158" letter-spacing="1.8">NEARIFY EVENT</text>

  <!-- Accent bar -->
  <rect x="80" y="112" width="36" height="2.5" rx="1.25" fill="#30d158" opacity="0.5"/>

  <!-- Event title -->
  <text x="80" y="${titleY}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#ffffff" letter-spacing="-0.5">${title}</text>

  <!-- Date and location -->
  ${metaLine ? `<text x="80" y="${metaY}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="19" font-weight="400" fill="#8fa0b8">${metaLine}</text>` : ""}

  <!-- Momentum indicator -->
  ${momentumLine ? `<circle cx="87" cy="${momentumY - 5}" r="3.5" fill="#30d158" opacity="0.65"/><text x="100" y="${momentumY}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="15" font-weight="500" fill="#30d158" opacity="0.85">${momentumLine}</text>` : ""}

  <!-- Bottom URL -->
  <text x="80" y="${HEIGHT - 48}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="14" font-weight="400" fill="rgba(255,255,255,0.3)">nearify.org</text>
</svg>`;
}

async function fetchEvent(slug: string | null, id: string | null): Promise<EventData | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let query = supabase
    .from("events")
    .select("id, name, slug, location, starts_at, description")
    .is("deleted_at", null);

  if (slug) {
    query = query.eq("slug", slug);
  } else if (id) {
    query = query.eq("id", id);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as EventData;
}

async function fetchAttendeeInfo(eventId: string): Promise<{ count: number; momentum: string }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from("event_attendees")
    .select("intent_primary")
    .eq("event_id", eventId);

  if (error || !data) return { count: 0, momentum: "" };

  const count = data.length;
  if (count < 3) return { count, momentum: "" };

  const intentCounts: Record<string, number> = {};
  for (const row of data) {
    if (row.intent_primary) {
      intentCounts[row.intent_primary] = (intentCounts[row.intent_primary] || 0) + 1;
    }
  }

  const labels: Record<string, string> = {
    meet_people: "networking",
    find_cofounder: "building",
    hire: "hiring",
    explore_ideas: "exploring",
    demo_something: "demoing",
  };

  const sorted = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c >= 2 && c / count >= 0.2);

  let momentum = "";
  if (sorted.length >= 2) {
    momentum = `${labels[sorted[0][0]] || ""} \u00b7 ${labels[sorted[1][0]] || ""}`;
  } else if (sorted.length === 1 && sorted[0][1] >= 3) {
    momentum = labels[sorted[0][0]] || "";
  }

  return { count, momentum };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const id = url.searchParams.get("id");

  if (!slug && !id) {
    return new Response("Missing slug or id parameter", { status: 400 });
  }

  try {
    const event = await fetchEvent(slug, id);
    if (!event) {
      return new Response("Event not found", { status: 404 });
    }

    const { count, momentum } = await fetchAttendeeInfo(event.id);
    const svg = buildSvg(event, count, momentum);

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("OG image generation failed:", err);
    return new Response("Internal error", { status: 500 });
  }
});
