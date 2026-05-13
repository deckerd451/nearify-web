# Nearify UI Architecture Audit

## 1. Map of Existing UI Systems

### Card Systems (6 distinct implementations)

| System | Class | Context | Border | Radius | Padding |
|--------|-------|---------|--------|--------|---------|
| Event listing card | `.event-list-card` | /events/ page | `rgba(48,209,88,0.12)` | 18px | 32px |
| Dashboard event card | `.cc-event-card` | / (dashboard) | `var(--color-border-subtle)` | `var(--radius-lg)` (16px) | 28px |
| Admin event row | `.admin-event-row` | /admin/ event list | `rgba(48,209,88,0.12)` | 14px | 18px 20px |
| Admin card | `.admin-card` | /admin/ form panels | `rgba(48,209,88,0.12)` | 18px | 28px |
| Attendee card | `.attendee-card` | Event detail discovery | `rgba(255,255,255,0.08)` | `var(--radius-md)` (12px) | 18px 20px |
| Intelligence card | `.intel-card` | Post-event report | `rgba(48,209,88,0.12)` | 14px | 18px |
| Feature card | `.feature-card` | Marketing sections | `rgba(48,209,88,0.12)` | 16px | 28px |
| Profile card | `.profile-card` | /profile.html | `var(--color-border-subtle)` | `var(--radius-lg)` | 40px 32px |
| Ghost return card | `.ghost-return-card` | /join/ ghost state | `rgba(48,209,88,0.24)` | 16px | 18px 20px |
| Join payload card | `.join-payload-card` | /join/ + event detail | `rgba(48,209,88,0.12)` | 16px | 18px 20px |

### Button Systems (4 overlapping implementations)

| System | Classes | Context |
|--------|---------|---------|
| Global buttons | `.btn`, `.primary`, `.secondary` | Everywhere |
| Admin buttons | `.admin-btn`, `.admin-btn-edit`, `.admin-btn-copy`, `.admin-btn-delete` | /admin/ event list (legacy) |
| Dashboard buttons | `.cc-action-btn`, `.cc-btn-danger`, `.cc-btn-ghost` | Dashboard event cards |
| Intel buttons | `.intel-connect-btn`, `.intel-fallback-btn`, `.intel-refresh-btn` | Intelligence panels |

### Avatar Systems (4 implementations)

| System | Size | Context |
|--------|------|---------|
| `.attendee-avatar-img` / `.attendee-avatar-placeholder` | 44px | Attendee discovery |
| `.intel-avatar` / `.intel-avatar-placeholder` | 44px | Intelligence cards |
| `.nav-avatar` / `.nav-avatar-placeholder` | 26px | Nav user pill |
| `.profile-avatar-img` / `.profile-avatar-placeholder` | 80px | Profile page |

### Badge/Pill Systems (5 implementations)

| System | Context |
|--------|---------|
| `.card-badge` | Event listing (Featured) |
| `.card-badge-past` | Event listing (Past) |
| `.cc-event-status` | Dashboard (Live/Upcoming/Ended) |
| `.intel-report-status` | Intelligence panel (Ready/Pending) |
| `.join-success-badge` | Join page (connection confirmed) |
| `.intent-display-badge` | Event detail (intent set) |
| `.momentum-count` | Event cards + detail (attendee count) |

### Kicker/Label Systems (3 implementations)

| System | Font | Context |
|--------|------|---------|
| `.event-kicker` | 14px, 600, 0.08em tracking, uppercase | Event pages |
| `.cc-landing-kicker` | 13px, 600, 0.08em tracking, uppercase | Dashboard landing |
| `.ghost-return-kicker` | 12px, 700, 0.08em tracking, uppercase | Ghost card |
| `.intent-step-label` | 12px, 700, 0.1em tracking, uppercase | Intent section |

### Section/Layout Systems

| System | Padding | Context |
|--------|---------|---------|
| `.section` | 80px 40px | Marketing pages |
| `.event-section` | 52px 40px | Event-specific sections |
| `.event-hero` | 72px 40px 48px | Event/join hero areas |
| `.events-hero` | 72px 40px 36px | Events listing hero |

### Typography Hierarchy

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| H1 (hero) | 52px (40px mobile) | 700 | Page titles |
| H1 (dashboard) | 42px (32px mobile) | 700 | CC landing |
| H2 (section) | 40px | 700 | Section headings |
| H2 (panel) | 24px | — | Side panels |
| H3 (card) | 24px | — | Feature/timeline cards |
| H3 (event list) | 30px (24px mobile) | — | Event card titles |
| H3 (dashboard) | 19px (17px mobile) | 700 | Dashboard event names |
| Body (subhead) | 22px (18px mobile) | — | Hero subheads |
| Body (section) | 18px | — | Section descriptions |
| Body (card) | 15px | — | Card content |
| Meta/label | 12-14px | 600-700 | Kickers, labels, meta |

### Color Usage (Hardcoded vs Variables)

**Well-tokenized:**
- `--color-bg`, `--color-surface`, `--color-accent`, `--color-text-primary/secondary/muted`
- `--color-border-subtle`, `--radius-sm/md/lg/full`

**Hardcoded colors that should be tokens:**
- `#8fa0b8` — used 15+ times (muted blue-gray, similar to `--color-text-muted`)
- `#aab4c5` — used 5+ times (section body text)
- `#c5cfdd` — used 8+ times (card body text)
- `#dfe6ef` — used 4+ times (form labels, bright secondary)
- `#e2e8f0` — used 3+ times (step titles, event names)
- `#d9e5f7`, `#d5e7ff`, `#cfe6ff`, `#b8c8df` — intelligence blues (4 near-identical shades)
- `#7f8da4` — meta labels (1 use, similar to `#8fa0b8`)
- `rgba(48, 209, 88, 0.12)` — used 20+ times as border color (should be `--color-border-accent`)

---

## 2. Which Systems Should Become Canonical

### Card primitive → ONE base class

The canonical card should be:
```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-inset);
}
```

Variants via modifiers: `.card--featured`, `.card--compact`, `.card--flush`.

### Button primitive → Already exists (`.btn`)

The `.btn` + `.primary` / `.secondary` system is correct. The `.admin-btn-*` and `.cc-btn-*` systems are redundant and should compose from `.btn`.

### Avatar primitive → ONE base class

```css
.avatar { width: 44px; height: 44px; border-radius: 50%; }
.avatar--sm { width: 26px; height: 26px; }
.avatar--lg { width: 80px; height: 80px; }
```

### Badge/pill primitive → ONE base class

```css
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
```

### Kicker primitive → ONE base class

All kickers share: uppercase, small font, bold, accent color, letter-spacing. Should be one `.kicker` class.

---

## 3. Duplicated Patterns to Remove

### HIGH priority (same visual, different classes)

1. **`.admin-event-row` vs `.cc-event-card`** — The admin event list (`.admin-events-list` + `.admin-event-row`) appears to be a legacy system superseded by the dashboard's `.cc-event-card`. The admin page now links to the dashboard. These classes may be dead CSS.

2. **`.event-card` (line ~310)** — Uses `background: #1f2937` (hardcoded, doesn't match design system). Appears to be an orphaned legacy class from before the event listing was built. Likely dead.

3. **`.btn-inline-link` is defined TWICE** — Once at line ~1960 (admin context) and again at line ~2530 (ghost email context). The second definition overrides the first with different padding/display.

4. **`.intent-chip.active`** — Defined twice: once in the intent section block and again in a separate "INTENT CHIP — ACTIVE STATE" section at line ~2570. Identical rules, pure duplication.

5. **`body.cc-page .cc-event-card`** — Scoped overrides at the bottom that re-declare properties already set on `.cc-event-card`. This exists to win specificity battles, indicating the cascade is fighting itself.

### MEDIUM priority (similar visual, could share)

6. **Attendee card + Intel card** — Both are `flex, gap:14px, align-items:flex-start, surface bg, border, 14-18px padding`. Same avatar size (44px). Same name/meta pattern. Should share a base.

7. **`.step-number` + `.timeline-number` + `.event-how-num`** — Three numbered-circle implementations (42px, 42px, 26px). Same visual language, different sizes.

8. **`.qr-preview-shell` + `.join-qr-shell` + `.cc-qr-shell`** — Three white QR containers with slightly different padding/radius.

---

## 4. Suggested Component Hierarchy

```
Primitives (tokens)
├── Colors (--color-*)
├── Spacing (--space-*)  ← MISSING, should add
├── Radius (--radius-*)
├── Shadows (--shadow-*)
└── Typography (--font-*)  ← MISSING, should add

Base Components
├── .card (surface container)
├── .btn (action trigger)
├── .badge (status indicator)
├── .avatar (person image)
├── .kicker (section label)
├── .skeleton (loading state)
└── .modal (overlay dialog)

Composed Components
├── .event-card = .card + event-specific content
├── .person-card = .card + .avatar + name/meta
├── .intel-card = .person-card + score/direction
├── .attendee-card = .person-card + intent/interests
├── .status-pill = .badge + dot animation
└── .qr-display = white shell + code + label

Page Layouts
├── .hero (full-width intro)
├── .section (content block)
├── .grid (responsive columns)
└── .panel (sticky sidebar)
```

---

## 5. Suggested CSS Architecture Cleanup

### Phase 1: Token expansion (LOW RISK)

Add missing tokens to `:root`:
```css
:root {
  /* Add these */
  --color-text-body: #c5cfdd;
  --color-text-bright: #e2e8f0;
  --color-border-accent: rgba(48, 209, 88, 0.12);
  --color-border-accent-strong: rgba(48, 209, 88, 0.35);
  --color-surface-elevated: #161f33;
  
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;
  --space-2xl: 80px;
  
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-base: 15px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --font-size-2xl: 30px;
  --font-size-3xl: 40px;
  --font-size-4xl: 52px;
}
```

### Phase 2: Replace hardcoded values (LOW RISK)

Find-and-replace the 15+ instances of `#8fa0b8` with `var(--color-text-muted)` (they're the same intent). Replace `rgba(48, 209, 88, 0.12)` border declarations with `var(--color-border-accent)`.

### Phase 3: Remove dead CSS (LOW RISK)

- Remove `.event-card` (line ~310, hardcoded `#1f2937`)
- Remove duplicate `.btn-inline-link` definition
- Remove duplicate `.intent-chip.active` block
- Verify `.admin-events-list` / `.admin-event-row` / `.admin-btn-*` are still referenced in HTML; if not, remove

### Phase 4: Extract shared person-card base (MEDIUM RISK)

Create a shared base for attendee + intel cards. This touches JS-rendered DOM, so test carefully.

---

## 6. Suggested Naming Normalization

### Current inconsistencies:

| Pattern | Examples | Issue |
|---------|----------|-------|
| BEM-ish | `.cc-event-card--ended`, `.cc-event-status--live` | Good, but only in CC section |
| Flat | `.event-list-card`, `.event-list-meta` | Dash-separated, no modifier convention |
| Contextual prefix | `.intel-*`, `.ghost-*`, `.join-*`, `.cc-*` | Good namespacing |
| No prefix | `.card-badge`, `.meta-label`, `.meta-value` | Collision risk |

### Recommendation:

Don't rename everything now. Instead, establish a convention for NEW classes:
- Page-scoped: `[page]-[component]` (e.g., `join-hero`, `events-grid`)
- Shared components: `[component]--[modifier]` (e.g., `card--featured`, `badge--live`)
- State: `is-[state]` or `[component].active` (already used)

The `cc-*` prefix pattern (Control Center) is the best-namespaced section. Future systems should follow this model.

---

## 7. Merge Conflict Hotspots

### HIGH RISK zones (most likely to conflict on multi-branch work):

1. **`styles.css` lines 1-40** (`:root` variables) — Any branch adding tokens will conflict here
2. **`styles.css` bottom** (new sections appended) — Multiple branches adding CSS will conflict at EOF
3. **`eventDetail.js` `populatePage()` function** — Central orchestrator, any feature touching event display modifies this
4. **`events/index.html` inline `<script>` block** — The `renderCard()` function is modified by any listing change
5. **`events/event.html` hero section** — Any new element in the event detail hero area

### MEDIUM RISK:

6. **`dashboard.js` `renderEventCard()`** — Any dashboard feature change
7. **`join/index.html`** — Large file, multiple inline scripts

### Mitigation:

- Extract the events listing `renderCard` into a separate JS module (eliminates inline script conflicts)
- Add new CSS in clearly-labeled section blocks with comment headers (reduces EOF conflicts)
- Consider splitting `styles.css` into partials IF a build step is ever added (not now)

---

## 8. Low-Risk Consolidation Steps (Do Now)

### Step 1: Add missing CSS custom properties (5 min, zero visual change)
Add `--color-border-accent`, `--color-text-body`, `--color-surface-elevated` to `:root`. Don't replace usages yet.

### Step 2: Remove dead CSS (10 min, zero visual change)
- Delete `.event-card` (line ~310) — orphaned, uses non-system color
- Delete duplicate `.intent-chip.active` block
- Delete duplicate `.btn-inline-link` block (keep the second one)

### Step 3: Consolidate QR shell styles (15 min, verify visually)
Create one `.qr-shell` base class, keep size variants.

### Step 4: Extract events listing script to module (30 min, reduces merge conflicts)
Move the inline `<script>` in `events/index.html` to `assets/js/eventsListing.js`. Import it as a module. This eliminates the #1 merge conflict hotspot.

### Step 5: Document the design system (30 min)
Create `.kiro/docs/design-system.md` documenting canonical tokens, components, and naming conventions. This prevents future drift.

---

## 9. What NOT to Touch Right Now

1. **Intelligence panel CSS** (`.intel-*`) — Complex, well-scoped, tested. The blue color palette is intentionally different from the green accent to distinguish "intelligence" from "action."

2. **Ghost participant CSS** (`.ghost-*`) — Tightly coupled to the ghost claim flow. The blue kicker color (`#8bd8ff`) is intentional differentiation.

3. **Dashboard/CC system** (`.cc-*`) — Recently built, well-namespaced, internally consistent. The `body.cc-page` specificity hack is ugly but functional.

4. **Join page mode switching** (`.join-mode-personal-connect`) — Complex state-driven styling. Fragile.

5. **Mobile breakpoints** — The 720px/600px/400px breakpoint system works. Don't consolidate to fewer breakpoints without testing every page.

6. **Nav auth system** — Injected dynamically by JS. Changing class names requires coordinated JS changes.

7. **Poster card** (`.event-poster-*`) — Used by html2canvas for image generation. CSS changes here break poster downloads.

---

## 10. Safest Path Toward Future SEO/Shareability

### Already done (feat/seo-social-proof-v1):
- JSON-LD structured data ✓
- Canonical URLs ✓
- Momentum indicators ✓
- Attendee counts on cards ✓
- Dynamic sitemap script ✓

### Next safe additions (no CSS architecture risk):

1. **Extract events listing to JS module** — Reduces merge conflicts, enables reuse
2. **Add `--color-border-accent` token** — Then replace 20+ hardcoded `rgba(48,209,88,0.12)` values
3. **Add share meta to event creation** — When organizer creates event, auto-generate better description for OG tags (stored in DB, no CSS change)
4. **Pre-render event meta pages** — Static HTML files with correct OG tags, redirect to dynamic page. Pure additive, no CSS.
5. **Add Web Share API button** — One new component (`.share-btn`), minimal CSS, high ROI for distribution

### What would cause design drift (defer until after consolidation):

- Organizer profile pages (new card type, new layout)
- Event category filters (new UI pattern)
- Follow/subscribe buttons (new interaction pattern)
- Email preference UI (new form pattern)

These should wait until the card/badge/avatar primitives are consolidated, so they compose from the canonical system rather than creating yet another variant.

---

## Summary

The Nearify CSS is ~3,477 lines in a single file. It's well-organized with clear section headers and consistent aesthetic direction. The main issues are:

1. **6+ card implementations** that share 80% of their properties but diverge on border-radius (14-18px), padding (18-32px), and border color
2. **4 button systems** where only `.btn` should exist
3. **15+ hardcoded color values** that should be tokens
4. **3 dead/duplicate CSS blocks** that can be safely removed
5. **1 specificity hack** (`body.cc-page`) indicating cascade conflicts

The architecture is sound for a single-file approach. The risk isn't in the CSS itself — it's in the **merge conflict surface area** of having one 3,477-line file that every feature branch touches at the bottom.

**Recommended immediate action:** Steps 1-3 from section 8 (add tokens, remove dead CSS, document conventions). Total time: ~30 minutes. Zero visual change. Reduces future drift.
