# Nearify Marketing & Distribution Gap Analysis

## What Already Exists (DO NOT REBUILD)

| System | Location | Status |
|--------|----------|--------|
| Public events directory | `/events/index.html` | Working — fetches from Supabase, splits upcoming/past |
| Event detail page | `/events/event.html` + `eventDetail.js` | Working — slug/id routing, intent, attendees, poster |
| Organizer dashboard | `/index.html` + `dashboard.js` | Working — CRUD, QR, copy link, end/archive |
| Event creation/editing | `/admin/event-setup.html` | Working — full form, QR preview, edit mode |
| QR join flows | `/join/index.html` + `join.js` | Working — generic + personal connect modes |
| Ghost/anonymous users | `ghostSession.js`, `ghostConnection.js` | Working — full lifecycle with claim flow |
| Attendee intent capture | `eventDetail.js`, `join.js` | Working — 5 intents, localStorage fallback |
| Attendee discovery | `eventDetail.js` (fetchEventAttendees) | Working — gated at 6 for non-attendees |
| Post-event intelligence | `intelligence.js` + `intelligence-algo.js` | Working — full decision engine |
| Poster download | `eventDetail.js` (html2canvas) | Working — generates PNG from poster card |
| Personal connect QR | `personalConnect.js` | Working — builds /join/?event=&profile= |
| iOS deep links | `beacon://event/<id>` scheme | Working — used in join, profile, event detail |
| Supabase event CRUD | `events.js` + migrations 001-013 | Working — RLS, RPCs, soft-delete |
| Auth (Google OAuth) | `navAuth.js` + Supabase Auth | Working — pill UI, drawer sign-out |
| Event context API (iOS) | `/event-context/` + `eventContext.js` | Working — WKWebView JSON bridge |
| Analytics DB table | migration 012 | Ready — insert-only, no public read |
| Static event redirect | `/events/charlestonhacks-...html` | Working — meta refresh + canonical |

---

## What Is Missing (Meetup-Style Marketing Features)

### 1. SEO-Friendly Event URLs

**Current state:** Events use `/events/event.html?slug=<slug>` or `?id=<uuid>`. One static redirect page exists at `/events/charlestonhacks-show-and-tell-featuring-hacker-theater.html`.

**Gap:** Query-param URLs are poor for SEO. Crawlers index them inconsistently. No canonical tags on the dynamic page. The static redirect pattern exists but isn't automated.

**What's needed:**
- Automated generation of static `/events/<slug>.html` pages with pre-rendered meta tags
- OR a lightweight edge/serverless pre-renderer that serves correct meta to crawlers
- Canonical URL tags on all event pages
- Redirect from `?id=` to slug-based URL when slug exists

---

### 2. Dynamic Event-Specific Open Graph Metadata/Images

**Current state:** All pages share one static `og-default.png`. Event detail page updates OG tags via JS after fetch — invisible to crawlers and social media link previews.

**Gap:** When someone shares an event link on Slack, Twitter, LinkedIn, or iMessage, the preview shows generic "Event | Nearify" with a default image. Zero event-specific context.

**What's needed:**
- Pre-rendered OG tags in HTML source (requires SSR or static generation)
- Dynamic OG image generation (event name + date + location rendered as image)
- Per-event `og:image` URL (e.g., `/og/events/<slug>.png`)
- Supabase Edge Function or external service (e.g., Vercel OG, Cloudflare Workers) to generate images on-demand

---

### 3. Better Share Previews

**Current state:** No share buttons anywhere. Poster download exists but requires visiting the page first.

**Gap:** No way for attendees or organizers to easily share events to social media with rich previews. No pre-formatted share text. No Web Share API.

**What's needed:**
- Share button component (Web Share API with fallback to copy-link)
- Pre-formatted share text per event
- "Share to Twitter/LinkedIn" links with UTM params
- Share tracking (which events get shared, from where)

---

### 4. Public Organizer/Community Pages

**Current state:** No public organizer pages. Profile page exists but is `noindex` and shows minimal info (name, avatar, "Attending [event]"). No concept of a community or group.

**Gap:** Organizers can't build a public presence. No way for attendees to find "all events by CharlestonHacks" or follow an organizer.

**What's needed:**
- Public organizer page at `/organizers/<slug>` or `/community/<slug>`
- Shows: organizer name, bio, upcoming events, past events, follower count
- Indexable by search engines (JSON-LD Organization schema)
- Follow/subscribe button (email or in-app notification)
- Optional: community page that aggregates multiple organizers

---

### 5. Event Categories/Tags/Search

**Current state:** No categories, tags, or search. Events are listed chronologically with no filtering.

**Gap:** Users can't discover events by topic. No way to find "all tech events" or "networking events in Charleston."

**What's needed:**
- `category` and `tags` columns on `events` table (additive schema change)
- Category/tag selection in event creation form
- Filter UI on `/events/` page
- Basic text search (client-side for now, Supabase full-text later)
- Category landing pages for SEO (e.g., `/events/category/tech`)

---

### 6. Recurring Event Support

**Current state:** Each event is a standalone row. No concept of series, recurrence, or parent events.

**Gap:** Organizers running weekly/monthly meetups must create a new event each time. No way to show "next occurrence" or link past instances.

**What's needed:**
- `series_id` column on `events` table (nullable UUID, self-referencing)
- "Repeat" option in event creation (weekly, biweekly, monthly)
- Series page showing all instances
- "Next event in this series" link on past event pages
- Auto-creation of next occurrence (or manual with pre-filled fields)

---

### 7. Follow/Subscribe/Reminder Loops

**Current state:** No follow, subscribe, or reminder functionality. Ghost email capture exists but only for post-event recap.

**Gap:** No way to retain attendees between events. No "notify me about the next one." No email list building.

**What's needed:**
- "Follow this organizer" button (stores in `organizer_followers` table)
- "Remind me" button on event pages (stores in `event_reminders` table)
- Email notification hooks (Supabase Edge Function or external service like Resend/Postmark)
- Reminder emails: 24h before event, "new event from organizer you follow"
- Unsubscribe flow (required for CAN-SPAM compliance)

---

### 8. Public Social Proof

**Current state:** Attendee count shown on dashboard (organizer-only). Event detail page shows attendee cards (gated at 6 for non-attendees). No public attendee count on event listing.

**Gap:** No visible social proof on public pages. Visitors can't see "47 people attending" before clicking into an event.

**What's needed:**
- Attendee count badge on event cards in `/events/` listing
- "X people attending" on event detail page (public, above the fold)
- Optional: attendee avatars strip (first 5-8 faces)
- Optional: "People you know are attending" (for signed-in users)

---

### 9. Lightweight Email Notification Hooks

**Current state:** Ghost email capture exists (migration 013). Analytics table ready. No email sending infrastructure.

**Gap:** No transactional or marketing emails. No way to notify attendees, send recaps, or announce new events.

**What's needed:**
- Email service integration (Resend, Postmark, or Supabase Edge Function + SMTP)
- Triggered emails: event reminder, post-event recap, new event from followed organizer
- Email preference management (per-user opt-in/out)
- Bounce handling (already flagged in Supabase dashboard)
- Templates: event announcement, reminder, recap with intelligence highlights

---

### 10. Conversion-Focused Event Pages

**Current state:** Event detail page is information-dense but not optimized for conversion. CTA is "Continue without signing in" or "Sign in" — both lead to app install flow. No urgency, no scarcity, no testimonials.

**Gap:** Pages inform but don't persuade. No conversion optimization for turning a visitor into an attendee.

**What's needed:**
- Above-the-fold CTA with clear value prop ("Join 23 others at this event")
- Social proof section (attendee count, avatars, testimonials)
- Urgency signals ("Starts in 3 days", "12 spots left" if capacity exists)
- Simplified join flow (reduce steps to attend)
- A/B testable CTA copy
- Exit-intent or scroll-triggered "Don't miss this" prompt

---

## Additional SEO Infrastructure Gaps

| Gap | Impact | Effort |
|-----|--------|--------|
| No JSON-LD structured data | No rich snippets in Google (event cards, dates, location) | Low |
| Sitemap is static (3 URLs) | Google doesn't know about individual events | Low |
| No canonical URLs | Potential duplicate content issues | Low |
| No breadcrumbs | Worse UX + no breadcrumb rich snippets | Low |
| Analytics stub (no implementation) | Can't measure anything | Medium |
| No RSS/Atom feed | Can't syndicate to event aggregators | Low |

---

## Highest-ROI Next Implementation (Priority Order)

### Phase 1: SEO Foundation (Immediate, 1-2 days)
1. **JSON-LD Event structured data** on event detail page
2. **Dynamic sitemap generation** (script that queries Supabase and outputs sitemap.xml)
3. **Canonical URLs** on all pages
4. **Attendee count on public event cards**

### Phase 2: Share & Social Proof (3-5 days)
5. **Share button component** (Web Share API + fallback)
6. **Pre-rendered event meta pages** (static HTML per event with correct OG tags)
7. **Dynamic OG image generation** (edge function)
8. **Social proof on event detail** (attendee count + avatar strip)

### Phase 3: Organizer Growth (1 week)
9. **Public organizer pages** with event history
10. **Follow organizer** (database + UI)
11. **Event categories/tags** (schema + filter UI)
12. **Basic search** on events page

### Phase 4: Retention Loops (1-2 weeks)
13. **Email notification hooks** (Resend/Postmark integration)
14. **Event reminders** (24h before)
15. **New event notifications** (for followers)
16. **Recurring event support**

---

## File-by-File Implementation Plan

### Phase 1 Files

| File | Action | What Changes |
|------|--------|--------------|
| `events/event.html` | Modify | Add JSON-LD `<script type="application/ld+json">` placeholder |
| `assets/js/eventDetail.js` | Modify | Populate JSON-LD with event data, add canonical link |
| `scripts/generate-sitemap.js` | Create | Node script that queries Supabase events and writes sitemap.xml |
| `events/index.html` | Modify | Show attendee count on event cards |
| `assets/js/events.js` | Modify | Add `fetchPublicEventsWithCounts()` or join attendee counts |
| `package.json` | Modify | Add `generate:sitemap` script |

### Phase 2 Files

| File | Action | What Changes |
|------|--------|--------------|
| `assets/js/share.js` | Create | Share button component (Web Share API + copy + social links) |
| `events/event.html` | Modify | Add share button container |
| `assets/js/eventDetail.js` | Modify | Wire share button, render social proof |
| `scripts/generate-event-pages.js` | Create | Generates static `/events/<slug>.html` with pre-rendered OG |
| `supabase/functions/og-image/` | Create | Edge function for dynamic OG image generation |
| `assets/css/styles.css` | Modify | Share button styles, social proof styles |

### Phase 3 Files

| File | Action | What Changes |
|------|--------|--------------|
| `organizers/index.html` | Create | Public organizer directory |
| `organizers/organizer.html` | Create | Individual organizer page |
| `assets/js/organizer.js` | Create | Fetch organizer profile + events |
| `supabase/migrations/014_categories_and_follows.sql` | Create | Add category, tags, organizer_followers tables |
| `events/index.html` | Modify | Add category filter UI, search input |
| `admin/event-setup.html` | Modify | Add category/tag selection to form |

### Phase 4 Files

| File | Action | What Changes |
|------|--------|--------------|
| `supabase/functions/send-reminder/` | Create | Edge function for email reminders |
| `supabase/functions/notify-followers/` | Create | Edge function for new-event notifications |
| `supabase/migrations/015_reminders_and_series.sql` | Create | event_reminders, series_id column |
| `assets/js/eventDetail.js` | Modify | Add "Remind me" button |
| `assets/js/organizer.js` | Modify | Add "Follow" button |

---

## Low-Risk Incremental Rollout Strategy

1. **All changes are additive** — no existing files are deleted or rewritten
2. **Schema changes use `ADD COLUMN IF NOT EXISTS`** — safe to run on production
3. **New pages don't affect existing routes** — `/organizers/` is a new directory
4. **Feature flags via localStorage** — new UI can be gated behind `nearify_feature_*` flags during testing
5. **Static generation scripts run at deploy time** — no runtime dependency
6. **Edge functions are independent** — deploy separately, fail independently
7. **Existing QR codes, deep links, and join URLs remain unchanged**
8. **iOS app handoff (`/event-context/`) is untouched**

---

## Exact First Changes to Make

### Change 1: JSON-LD on Event Detail Page

In `assets/js/eventDetail.js`, inside `populatePage()`, after setting meta tags:

```javascript
// Add JSON-LD Event structured data
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Event",
  "name": event.name,
  "startDate": event.starts_at,
  "endDate": event.ends_at || undefined,
  "location": event.location ? {
    "@type": "Place",
    "name": event.location
  } : undefined,
  "description": event.description || `Connect with attendees at ${event.name} in real time.`,
  "url": `https://nearify.org/events/event.html?slug=${encodeURIComponent(event.slug || event.id)}`,
  "organizer": {
    "@type": "Organization",
    "name": "Nearify",
    "url": "https://nearify.org"
  },
  "eventStatus": isPast ? "https://schema.org/EventScheduled" : "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode"
};

let ldScript = document.getElementById("eventJsonLd");
if (!ldScript) {
  ldScript = document.createElement("script");
  ldScript.id = "eventJsonLd";
  ldScript.type = "application/ld+json";
  document.head.appendChild(ldScript);
}
ldScript.textContent = JSON.stringify(jsonLd);
```

### Change 2: Canonical URL

In `assets/js/eventDetail.js`, inside `populatePage()`:

```javascript
// Set canonical URL
let canonical = document.querySelector('link[rel="canonical"]');
if (!canonical) {
  canonical = document.createElement("link");
  canonical.rel = "canonical";
  document.head.appendChild(canonical);
}
canonical.href = `https://nearify.org/events/event.html?slug=${encodeURIComponent(event.slug || event.id)}`;
```

### Change 3: Attendee Count on Event Cards

In `events/index.html`, modify the inline `<script type="module">` to fetch counts:

```javascript
// After fetchPublicEvents(), also fetch attendee counts
const eventIds = events.map(e => e.id);
const { data: attendeeRows } = await supabase
  .from("event_attendees")
  .select("event_id")
  .in("event_id", eventIds);

const counts = new Map();
for (const row of (attendeeRows || [])) {
  counts.set(row.event_id, (counts.get(row.event_id) || 0) + 1);
}
```

Then in `renderCard()`, add the count badge:

```javascript
const count = counts.get(ev.id) || 0;
const countBadge = count > 0
  ? `<span class="event-attendee-count">${count} attending</span>`
  : '';
```

### Change 4: Dynamic Sitemap Script

Create `scripts/generate-sitemap.js`:

```javascript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function generateSitemap() {
  const { data: events } = await supabase
    .from("events")
    .select("slug, id, starts_at")
    .is("deleted_at", null)
    .order("starts_at", { ascending: false });

  const urls = [
    { loc: "https://nearify.org/", priority: "1.0", changefreq: "weekly" },
    { loc: "https://nearify.org/events/", priority: "0.9", changefreq: "daily" },
  ];

  for (const event of (events || [])) {
    const slug = event.slug || event.id;
    urls.push({
      loc: `https://nearify.org/events/event.html?slug=${encodeURIComponent(slug)}`,
      priority: "0.7",
      changefreq: "weekly",
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  process.stdout.write(xml);
}

generateSitemap();
```

---

## Constraints Verification

- ✅ Additive changes only — no rewrites
- ✅ Preserves current Supabase schema (new columns/tables only)
- ✅ Does not break iOS app handoff (`/event-context/` untouched)
- ✅ Does not break QR joins (`/join/` route unchanged)
- ✅ Does not break CharlestonHacks workflows (dashboard, event-setup unchanged)
- ✅ Does not rewrite the site (extends existing pages)
