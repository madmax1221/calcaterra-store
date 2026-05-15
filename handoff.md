# Calcaterra · session handoff

_Updated 2026-05-15. Branch: `main`. Everything below is committed and pushed._

## Goal

Bring the Calcaterra site, owner's guide booklets, and admin operations to a launch-ready state with consistent luxury voice, honest specs, and quiet editorial polish. The site is a microbrand watch store on Vercel + Supabase with one product (Roma) in three colorways.

## Current state · what landed this session

### Booklets (`booklet-roma.html` + `booklet-roma-a7.html`)
- 13-page A6 (105 × 148 mm) owner's guide and a compact A7 (74 × 105 mm) version for tighter watch boxes
- Brand logo on cover, back cover, and every page header
- Crown position diagram (3 frames showing pushed-in / one-click / fully-out) with hands at 10:10, integrated bracelet stubs
- Step-list pattern with italic Times Roman numerals + Montserrat small caps labels on procedural pages (Sizing, Registration, Claims)
- Page V (Daily wear) uses `.tight` class · denser content needs slightly compressed body
- Page VI (Sizing) uses `.semi` class · between tight and default
- All other pages use the default sizing
- One-click PDF download via jsPDF + html2canvas
  - Pre-processes inverted-logo images by inverting pixels on a canvas before generation so logos render correctly black on cream pages (CSS filter:invert was being lost by html2canvas)
  - Explicit width/height on html2canvas call so exactly one .page becomes one PDF page
  - Outputs `calcaterra-roma-owners-guide-a6.pdf` / `-a7.pdf`
- Fullscreen reader mode with responsive scale, zoom buttons (− / + / FIT), arrow-key navigation, page counter
- A6 only: Page IX `Watch Registration` text and `calcaterra.co` text are real clickable links in both the live page AND the downloaded PDF (`pdf.link()` overlay annotations after each page image is added)
- Cal-ops sidebar has `BOOKLET · A6` and `BOOKLET · A7` links

### `/join` (new page)
- Editorial hero + 'No club. No tier. A short list.' story + three italic Roman numeral benefits (Early access / The correspondence / A permanent record) + dark CTA section with two side-by-side cards (newsletter signup that posts to `subscribe-newsletter` edge function with `source: 'join_page'`, and Create Account CTA)
- Closing statement 'Decided once. Kept indefinitely.'
- Vercel rewrite + redirect added so `/join` resolves correctly

### Site-wide footer restructure (17 pages)
- THE HOUSE column: Our Story · Philosophy · Join the House (Terms/Privacy moved out)
- SUPPORT column: Contact · Warranty · Shipping · Returns (Cookie Preferences moved out)
- New bottom row: copyright on the left, Terms of Service · Privacy · Cookie Preferences on the right
- Mobile (≤560px) stacks the legal line above the copyright
- Copyright line styling unified to match landing page: 8px / opacity 0.20 / 0.35em letter-spacing
- Quiet `JOIN THE HOUSE` link as a story-section near the close of `about.html`
- Side-fix: register.html and signin.html had Philosophy link pointing to /about (bug); repaired during footer rollout

### Voice and spec hygiene
- Em-dashes stripped site-wide (237 em-dashes + 6 en-dashes → commas / middots / hyphens)
- Movement spec is `Miyota Precision Quartz` everywhere (booklet, roma.html, roma-product.html). Battery is described as 'small silver-oxide cell, approximately 2 to 3 years' with no model number (none confirmed yet)
- No invented specs (no thickness, accuracy, L2L, lume grade, battery model)
- Roman numeral I/II/III rhythm carries across philosophy, roma, booklet, join, claims page

### Memory note
`project_calcaterra_voice.md` lives in the user's memory index so future sessions auto-load:
- Voice rules (restraint over volume, no em-dashes, no invented specs)
- Layout rules (transform:scale for logo bumps, hairlines are expensive, no placeholder padding)
- Roman numeral vs physical page numbering
- Vercel rewrite + redirect requirement for new pages
- Standard footer structure
- 'When in doubt, ask' rule

## Files in flight

None. The working tree is clean. Everything in this session is committed.

```
$ git status
nothing to commit, working tree clean
```

## Failed attempts and reverts (so they don't repeat)

1. **Eyebrow border-bottom hairline** · added twice, user rejected both times. The natural `b-hairline` after the h1 is enough; do not put a border-bottom on `.b-eyebrow`.
2. **Newsletter as full-width editorial hero above footer** · 'Join the correspondence.' big italic title felt marketing-loud. Replaced with quieter band, then removed entirely. Newsletter now lives only on `/join`.
3. **Newsletter inline in footer's empty grid space** · tried `grid-column:2/4 grid-row:1 align-self:end` to fill the dead space under HOUSE+COLLECTIONS. User wanted a `Join the House` link instead of an inline form.
4. **A7 visibility bumps** · went too aggressive then had to dial back. The `.tight` (Page V) and `.semi` (Page VI) classes are now the canonical answer. Default sizes are correct for the other pages.
5. **Crown diagram numbering duplication** · had `0./1./2.` in both the SVG and the legend. Resolved by keeping numbers only in the SVG and using action labels ('Pushed in.' / 'One click.' / 'Fully out.') in the legend.
6. **Bracelet pin direction SVG on Page 7** · built it, then expanded it, then user said remove and keep text-only steps. Now removed.
7. **THE HOUSE column padding with placeholder pages** · considered adding 'Journal' / 'Heritage' / 'Atelier' to balance the column. Decided against padding with placeholders. THE HOUSE stays at 3 real items (Our Story · Philosophy · Join the House).
8. **OR JOIN THE HOUSE on philosophy page** · added a secondary CTA under EXPLORE THE COLLECTION. User asked to remove it. Reverted.

## Pending / next steps

### Definitely future work
- **Photography** (the rating ceiling on roma-product) · variant-specific thumbnail sets + at least one wrist shot. Higgsfield prompts already drafted for the booklet image set; same approach can be reused for product page.
- **Booklet access on dashboard** · per-watch manual link next to each registered watch in the dashboard. User flagged as 'later'.
- **404 page** · stays minimal intentionally (no footer added).

### Pages NOT in the standard footer pattern
These were intentionally skipped or didn't have full footers:
- `cal-ops.html` · admin only, internal styling
- `404.html` · minimal by design
- `unsubscribe.html` · minimal
- `landing-old.html` · backup file, ignore
- `cookies.js` · separate consent system, working as-is

### Open questions for next session
- Real **Miyota caliber number** (2025 / 2115 / 6P29 / GM10) from the factory contact — once confirmed, update booklet Page 3 and the product spec table
- Real **battery model** + manufacturer-stated life — update booklet Page 8 from generic 'silver-oxide cell' to specifics
- Photography availability — if shoots are scheduled, the roma-product page can hit 9.5-10 with variant-specific imagery
- Whether to add a Journal / News page later under THE HOUSE column (only if real content exists)

## Quick reference

- Live site: `https://calcaterra.co`
- Repo: `https://github.com/madmax1221/calcaterra-store`
- Working dir: `/tmp/calcaterra-store-new`
- Supabase URL: `https://tnjuxcdcwcxoipbsowih.supabase.co`
- Booklet URLs: `/booklet-roma` (A6) and `/booklet-roma-a7` (A7), both accessible via cal-ops sidebar
- Memory file: `~/.claude/projects/-Users-madmax-test/memory/project_calcaterra_voice.md`

## Last 10 commits (most recent first)

```
0044cc9 Footer copyright line matches landing-page styling site-wide; revert philosophy Join CTA
79d57e0 about + philosophy: quiet Join the House CTA near the closing of each page
3a180ec site-wide footer rollout · 16 pages · matches the /roma + /join structure
297403d join.html: email input placeholder 'your@email.com' -> 'Email address'
9931a17 vercel.json: rewrite /join -> /join.html and redirect /join.html -> /join
57838b0 new page · /join + 'Join the House' link under THE HOUSE on roma.html
85270eb roma.html: place footer newsletter in the empty dead space under HOUSE + COLLECTIONS
c876656 roma.html: relocate newsletter to minimal one-line row below the columns
6e12226 roma.html: quiet down the footer newsletter band · luxury restraint
d31742c roma.html: move newsletter from brand column to full-width editorial band above the footer columns
```
