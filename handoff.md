# Calcaterra · session handoff

_Updated 2026-05-16. Branch `main`. Everything below is committed and pushed._

## Where we are right now

Working through the **dashboard improvements queue**. One done, eight to go.

**Just landed**: order detail modal on the dashboard Orders tab. Clicking any order card now opens a centered luxury-restrained modal that fetches the full order from Supabase and shows: status timeline (Placed → Confirmed → Shipped → Delivered with dates), line items with images, shipping address, payment status, tracking pill, and total. Closes on ESC / backdrop click / × button. Mobile collapses two-column grid + timeline to single column.

## Goal

Bring the Calcaterra site, owner's guide booklets, and admin operations to launch-ready with consistent luxury voice, honest specs, and quiet editorial polish. Microbrand watch store on Vercel + Supabase. One product (Roma) in three colorways at €329.

## Project context

| Item | Value |
|---|---|
| Brand | Calcaterra · luxury watch microbrand |
| Founders | Massimo Calcaterra (operator/design/voice) · Alberto Calcaterra (father, capital) |
| Founded | 2026 |
| Product | Roma · single reference, 3 colorways (Black, Navy, Silver) at €329 |
| Stack | Static HTML on Vercel · Supabase (auth + DB + Edge Functions) · Resend |
| Repo | github.com/madmax1221/calcaterra-store |
| Working dir | `/tmp/calcaterra-store-new` |
| Live site | calcaterra.co |
| Supabase URL | `https://tnjuxcdcwcxoipbsowih.supabase.co` |
| Memory file (auto-loaded) | `~/.claude/projects/-Users-madmax-test/memory/project_calcaterra_voice.md` |

## Files in flight

None. Working tree is clean. Everything committed and pushed.

## Dashboard improvements queue · pick up here

| # | Improvement | Status |
|---|---|---|
| **1** | **Order detail view** | ✅ done (this session) |
| **2** | **Pending-action banner** at top of dashboard | ← **next up** |
| **3** | **Notification preferences tab** (Order updates · Newsletter · Marketing toggles) | pending |
| **4** | **Mobile sidebar + responsive sweep** of all dashboard sections | pending |
| **5** | **Default address flag** (star icon, primary for checkout pre-fill) | pending |
| **6** | **Avatar / initial in sidebar header** | pending |
| **7** | **Reorder / Buy Again** on past orders | pending |
| **8** | **Account data export + delete** (GDPR RTBF) | pending |
| **9** | **Recent activity feed** ("Order placed 2 May" · "Watch registered 5 May") | pending |

### Next steps in detail

**#2 Pending-action banner** — at the top of the dashboard (above stats strip), show a banner if the customer has any of:
- An order with `status = 'pending'` that needs payment confirmation
- A purchased watch not yet registered (cross-check `orders.confirmed_at` vs `warranties` table)
- A delivered order with no tracking acknowledgement

Wire a single banner component that picks the highest-priority unresolved action. Click → CTA to resolve (open order modal, jump to register tab, etc).

**#3 Notification preferences tab** — new tab in sidebar between `MY WATCHES` and `ACCOUNT DETAILS`. Three toggles:
- Order updates (always on, locked)
- Newsletter (links to `newsletter_subscribers` table)
- Marketing (new column `notification_preferences` on `customers` jsonb)

Saves via direct Supabase update with RLS protecting customer's own row.

### After dashboard · queue continues

- **Cal-ops UX** · modularize 2026-line file, dismiss-persistence on the notifications prompt
- **Edge functions audit** · check user-visible strings for em-dashes, verify shell pattern consistency
- **Roma collection / product page** · waits on photography (variant-specific thumbs + wrist shot)

## What landed in this session (chronological)

1. **Booklet rolled out** · A6 (`booklet-roma.html`) and A7 (`booklet-roma-a7.html`) with crown SVG, step-list pattern, `.tight` / `.semi` page classes, one-click PDF download with logo pixel inversion, fullscreen reader, A6-only clickable PDF links for Watch Registration + calcaterra.co
2. **`/join` page** · editorial story + 3 italic Roman numeral benefits + dark CTA section with newsletter signup and Create Account
3. **Site-wide footer restructure** (17 pages) · THE HOUSE gains Join the House, Terms/Privacy moved to bottom legal row, copyright styling matches landing (8px / 0.20 opacity)
4. **Em-dash purge** site-wide (237 em + 6 en dashes removed from user-visible text)
5. **Movement spec aligned** · `Miyota Precision Quartz` everywhere, battery generic until factory confirms
6. **Dashboard tweaks** · `MY WARRANTIES` → `MY WATCHES` (sidebar + account drawer 14 pages), watch-card eyebrow `CALCATERRA ROMA` → `CALCATERRA`, Owner's Guide link per watch
7. **Booklet auto-reader** · dashboard Owner's Guide link uses `?read=1` to skip directly to fullscreen reader, in-reader DOWNLOAD button, CLOSE returns via `history.back()`
8. **Vercel routing** · clean URLs added for `/join`, `/booklet-roma`, `/booklet-roma-a7`
9. **Order detail modal** · clicking an order card on the dashboard opens full order summary with timeline, items, address, payment status, tracking, total

## NEVER do these

1. **Don't invent specs.** No battery model, accuracy, thickness, lug-to-lug, lume grade, jewel count.
2. **No em-dashes (—) or en-dashes (–)** in user-visible text. Strip from prose, meta titles, alt text, emails.
3. **No marketing-loud copy.** No "Join our family", no big italic CTAs, no all-caps SUBSCRIBE words.
4. **No new clean-URL pages without `vercel.json`** rewrite + redirect entries.
5. **Don't pad columns with placeholder links.** THE HOUSE stays at 3 real items.
6. **Don't make logos bigger with height changes.** Use `transform: scale()` with `transform-origin`.
7. **Don't change booklet A7 without instruction.** A7 is print/packaged. Voice/spec changes apply to both; UI features (clickable links, etc.) are A6-only.
8. **Don't roll out site-wide changes without testing on one page first.**
9. **Don't assume "page 3" means physical page 3.** Booklet pages numbered by Roman numeral (I = physical page 2).
10. **Don't `--no-verify` on commits or force-push.**
11. **Don't add new pages or sweeping content changes without asking.**

## ALWAYS do these

1. **Match the existing voice.** Times serif italic accents (`<em>`), Montserrat small caps tracked letter-spacing.
2. **Roman numerals for procedural lists.**
3. **Use existing CSS atoms** (`b-h1`, `b-eyebrow`, `b-body`, `b-hairline`, `step-list`, `note-list`, `foot-grid`, `order-modal-*`).
4. **Commit after every meaningful change and push immediately.**
5. **Test on one page → get feedback → bulk-roll.**
6. **Use Python scripts for bulk multi-pattern HTML edits.**
7. **Grep after bulk operations** to verify patterns matched.
8. **`target="_blank" rel="noopener"`** on every external/new-tab link.
9. **Mobile breakpoints** at ≤560px (stack) and ≤860px (collapse).
10. **Ask before adding new pages or removing content.**

## Failed attempts · don't retry

| Tried | Outcome | Final answer |
|---|---|---|
| Eyebrow `border-bottom` hairline | Rejected twice | No line under `.b-eyebrow` |
| Newsletter as full-width editorial hero | Too loud | Newsletter only on `/join` |
| Newsletter inline in footer grid dead space | Rejected | `Join the House` LINK in THE HOUSE column |
| A7 visibility bumps too aggressive | Reverted | `.tight` V, `.semi` VI, default elsewhere |
| Crown numbering in SVG AND legend | Duplicated | Numbers in SVG only, labels in legend |
| Bracelet pin SVG on Page 7 | Removed | Text-only steps |
| THE HOUSE padding (Journal/Heritage/Atelier) | Rejected | 3 real items only |
| OR JOIN THE HOUSE secondary CTA on philosophy | Removed | Footer link is the only path |
| `SR626SW` specific battery model | Rejected | Generic "small silver-oxide cell" |
| "your@email.com" as input placeholder | Replaced | "Email address" |

## Open questions waiting on user

- **Real Miyota caliber** (likely 2025 / 2115 / 6P29 / GM10) — factory has to confirm
- **Real battery model + life** — factory has to confirm
- **Photography schedule** — when watch photo shoots happen
- **Entity name + country** of incorporation — when registered (for terms.html)

## Quick reference

- Brand cream `#f2efe9` · brand dark `#1a1814` · true black accent `#141210`
- Logo (white source, invert for cream pages): `https://cdn.shopify.com/s/files/1/0994/8715/4470/files/Untitled_design_c4295222-cdc2-4f27-b349-bc971fbf6cc8.png?v=1773510117`
- Wordmark: `https://cdn.shopify.com/s/files/1/0994/8715/4470/files/Untitled_design-2_34f672e4-1bf2-4955-a64b-25af3090d31a.png?v=1773510117`
- Booklet URLs: `/booklet-roma` (A6 · use `?read=1` for auto-reader) · `/booklet-roma-a7` (A7)
- Variant cart images for items in `dashboard.html` and elsewhere: see `variantCartImages` map
- Footer copyright span standard: `font-size:8px; letter-spacing:0.35em; color:rgba(242,239,233,0.2);`

## Last 10 commits

```
4da8771  dashboard: order detail modal · clicking a card opens full order summary
ae68527  booklet-roma: auto-open reader from ?read=1, in-reader DOWNLOAD, Close goes back
02c72bc  Rename WARRANTY entry to MY WATCHES across account drawer and dashboard
f7deb1a  dashboard: watch-card eyebrow CALCATERRA ROMA -> CALCATERRA
71d6d5f  dashboard: Owner's Guide link on each registered watch
49888ce  Add handoff.md
0044cc9  Footer copyright line matches landing-page styling site-wide
79d57e0  about + philosophy: quiet Join the House CTA near closing
3a180ec  site-wide footer rollout · 16 pages
57838b0  new page · /join + 'Join the House' link under THE HOUSE on roma.html
```

## Opening message for a fresh session

> "Read `/tmp/calcaterra-store-new/handoff.md` and the project memory file. Continue where we left off — dashboard improvement #1 (order detail view) is done. Next up is #2 (pending-action banner at top of dashboard)."

That's enough for a new session to pick up cleanly. The auto-memory file `project_calcaterra_voice.md` carries the voice + design rules; this handoff carries the queue state.
