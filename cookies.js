/* Calcaterra cookie consent
 * GDPR-compliant 4-category consent modal.
 * Stores consent in localStorage AND as a first-party cookie so the
 * server (or future analytics scripts) can read it.
 *
 * Expose API:
 *   window.CalcaterraCookies.getConsent()       -> stored consent or null
 *   window.CalcaterraCookies.has('analytics')   -> boolean
 *   window.CalcaterraCookies.openPreferences()  -> re-open the modal
 *   window.CalcaterraCookies.reset()            -> wipe and re-prompt
 *
 * Categories:
 *   essential  - always on, can't be turned off (auth, cart)
 *   functional - remembered preferences (e.g. recently viewed)
 *   analytics  - usage measurement (Plausible/GA — when added)
 *   marketing  - retargeting / ads (Meta/TikTok pixels — when added)
 */
;(function () {
  'use strict'

  const STORAGE_KEY = 'cal_consent_v1'
  const COOKIE_NAME = 'cal_consent'
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365  // 1 year

  // ── State helpers ───────────────────────────────────────────────
  function getConsent () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const c = JSON.parse(raw)
      // Sanity check
      if (typeof c !== 'object' || c === null) return null
      return c
    } catch (e) { return null }
  }

  function setConsent (consent) {
    const payload = {
      essential: true,
      functional: !!consent.functional,
      analytics:  !!consent.analytics,
      marketing:  !!consent.marketing,
      timestamp: new Date().toISOString(),
      version: 1,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)) } catch (_) {}
    // Mirror to a cookie for SSR/server-side awareness
    const flags = (payload.essential ? '1' : '0')
                + (payload.functional ? '1' : '0')
                + (payload.analytics ? '1' : '0')
                + (payload.marketing ? '1' : '0')
    document.cookie = `${COOKIE_NAME}=${flags}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`
    window.dispatchEvent(new CustomEvent('cal:consent', { detail: payload }))
    return payload
  }

  function has (category) {
    const c = getConsent()
    if (!c) return false
    return !!c[category]
  }

  // ── Styles ──────────────────────────────────────────────────────
  function injectStyles () {
    if (document.getElementById('cal-cookie-styles')) return
    const css = `
#cal-cookie-overlay{position:fixed;inset:0;z-index:9999;background:rgba(14,13,11,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center;padding:0;opacity:0;transition:opacity .55s ease;font-family:'Times New Roman',Times,serif;}
#cal-cookie-overlay.show{opacity:1;}
#cal-cookie-overlay.hide{opacity:0;pointer-events:none;}
#cal-cookie-card{background:#f2efe9;width:100%;max-width:680px;max-height:90vh;overflow-y:auto;margin:0 16px;padding:48px 52px;border-top:1px solid rgba(26,24,20,0.08);transform:translateY(40px);transition:transform .6s cubic-bezier(.25,.46,.45,.94);box-shadow:0 -10px 60px rgba(14,13,11,0.25);}
#cal-cookie-overlay.show #cal-cookie-card{transform:translateY(0);}
@media(min-width:760px){#cal-cookie-overlay{align-items:center;padding:32px;}#cal-cookie-card{margin:0;border-top:none;}}
.cal-c-mark{font-family:Georgia,'Times New Roman',serif;font-size:14px;font-weight:300;letter-spacing:0.42em;color:rgba(26,24,20,0.55);text-align:center;display:block;margin-bottom:32px;}
.cal-c-eyebrow{font-family:'Montserrat',sans-serif;font-size:9px;font-weight:300;letter-spacing:0.6em;color:rgba(26,24,20,0.42);text-transform:uppercase;display:block;margin-bottom:14px;}
.cal-c-title{font-family:'Times New Roman',Times,serif;font-size:clamp(26px,3vw,36px);font-weight:300;line-height:1.18;letter-spacing:0.02em;color:#1a1814;margin-bottom:14px;}
.cal-c-title em{font-style:italic;color:rgba(26,24,20,0.4);}
.cal-c-body{font-family:'Montserrat',sans-serif;font-size:12px;font-weight:300;letter-spacing:0.04em;line-height:1.85;color:rgba(26,24,20,0.7);margin-bottom:20px;}
.cal-c-body a{color:#1a1814;text-decoration:none;border-bottom:1px solid rgba(26,24,20,0.3);padding-bottom:1px;}
.cal-c-body a:hover{border-bottom-color:#1a1814;}
.cal-c-rule{height:1px;background:rgba(26,24,20,0.08);margin:28px 0;}
.cal-c-actions{display:flex;flex-direction:column;gap:10px;margin-top:24px;}
@media(min-width:760px){.cal-c-actions{flex-direction:row;gap:12px;}}
.cal-c-btn{display:inline-block;font-family:'Montserrat',sans-serif;font-size:9px;font-weight:300;letter-spacing:0.58em;text-transform:uppercase;text-align:center;padding:18px 32px;border:1px solid rgba(26,24,20,0.35);background:transparent;color:#1a1814;cursor:pointer;transition:background .3s ease,color .3s ease,border-color .3s ease;width:100%;}
@media(min-width:760px){.cal-c-btn{width:auto;flex:1;}}
.cal-c-btn:hover{background:#1a1814;color:#f2efe9;border-color:#1a1814;}
.cal-c-btn-primary{background:#1a1814;color:#f2efe9;border-color:#1a1814;}
.cal-c-btn-primary:hover{background:#2a2620;border-color:#2a2620;}
.cal-c-btn-ghost{background:transparent;color:rgba(26,24,20,0.65);border-color:rgba(26,24,20,0.18);}
.cal-c-btn-ghost:hover{background:transparent;color:#1a1814;border-color:#1a1814;}

/* Customize panel */
.cal-c-panel{display:none;margin-top:8px;}
#cal-cookie-card.customize .cal-c-panel{display:block;}
#cal-cookie-card.customize .cal-c-actions-initial{display:none;}
.cal-c-category{padding:22px 0;border-bottom:1px solid rgba(26,24,20,0.07);display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;}
.cal-c-category:last-of-type{border-bottom:none;}
.cal-c-cat-name{font-family:'Times New Roman',Times,serif;font-size:18px;font-weight:300;letter-spacing:0.02em;color:#1a1814;margin-bottom:6px;}
.cal-c-cat-name em{font-style:italic;color:rgba(26,24,20,0.45);}
.cal-c-cat-desc{font-family:'Montserrat',sans-serif;font-size:11px;font-weight:300;letter-spacing:0.04em;line-height:1.75;color:rgba(26,24,20,0.6);}
.cal-c-switch{position:relative;width:42px;height:22px;flex-shrink:0;cursor:pointer;}
.cal-c-switch input{opacity:0;width:0;height:0;}
.cal-c-switch-slider{position:absolute;inset:0;background:rgba(26,24,20,0.15);transition:background .3s;border-radius:11px;}
.cal-c-switch-slider:before{content:'';position:absolute;height:16px;width:16px;left:3px;top:3px;background:#f2efe9;transition:transform .3s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.15);}
.cal-c-switch input:checked + .cal-c-switch-slider{background:#1a1814;}
.cal-c-switch input:checked + .cal-c-switch-slider:before{transform:translateX(20px);}
.cal-c-switch input:disabled + .cal-c-switch-slider{background:rgba(26,24,20,0.5);cursor:not-allowed;}
.cal-c-switch input:disabled + .cal-c-switch-slider:before{background:rgba(242,239,233,0.7);}
.cal-c-locked{font-family:'Montserrat',sans-serif;font-size:8px;font-weight:300;letter-spacing:0.4em;color:rgba(26,24,20,0.4);text-transform:uppercase;display:inline-block;margin-left:8px;}
`
    const style = document.createElement('style')
    style.id = 'cal-cookie-styles'
    style.textContent = css
    document.head.appendChild(style)
  }

  // ── DOM ─────────────────────────────────────────────────────────
  function build () {
    const overlay = document.createElement('div')
    overlay.id = 'cal-cookie-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'cal-c-title')
    overlay.innerHTML = `
      <div id="cal-cookie-card">
        <span class="cal-c-mark">CALCATERRA</span>
        <span class="cal-c-eyebrow">Privacy</span>
        <h2 id="cal-c-title" class="cal-c-title">A note on <em>cookies.</em></h2>
        <p class="cal-c-body">We use cookies to keep you signed in, remember your preferences, and understand how the site is used. You can accept all, decline non-essential, or choose which to allow.</p>
        <p class="cal-c-body">Read our <a href="/privacy">Privacy Policy</a> for the full detail.</p>

        <div class="cal-c-actions cal-c-actions-initial">
          <button type="button" class="cal-c-btn cal-c-btn-ghost" data-action="customize">Customize</button>
          <button type="button" class="cal-c-btn" data-action="reject">Reject All</button>
          <button type="button" class="cal-c-btn cal-c-btn-primary" data-action="accept">Accept All</button>
        </div>

        <div class="cal-c-panel">
          <div class="cal-c-rule"></div>

          <div class="cal-c-category">
            <div>
              <h3 class="cal-c-cat-name">Strictly necessary <em>cookies.</em><span class="cal-c-locked">Always on</span></h3>
              <p class="cal-c-cat-desc">Required for the site to function. They keep you signed in, hold your cart, and protect against fraud. Cannot be switched off.</p>
            </div>
            <label class="cal-c-switch" aria-label="Strictly necessary cookies (always on)">
              <input type="checkbox" checked disabled>
              <span class="cal-c-switch-slider"></span>
            </label>
          </div>

          <div class="cal-c-category">
            <div>
              <h3 class="cal-c-cat-name">Functional <em>cookies.</em></h3>
              <p class="cal-c-cat-desc">Remember small choices that improve your experience. Saved colorways viewed, recently considered references, region preferences.</p>
            </div>
            <label class="cal-c-switch" aria-label="Functional cookies">
              <input type="checkbox" data-category="functional">
              <span class="cal-c-switch-slider"></span>
            </label>
          </div>

          <div class="cal-c-category">
            <div>
              <h3 class="cal-c-cat-name">Analytics <em>cookies.</em></h3>
              <p class="cal-c-cat-desc">Anonymous measurement of how the site is used so we can refine it. We do not profile or sell this data.</p>
            </div>
            <label class="cal-c-switch" aria-label="Analytics cookies">
              <input type="checkbox" data-category="analytics">
              <span class="cal-c-switch-slider"></span>
            </label>
          </div>

          <div class="cal-c-category">
            <div>
              <h3 class="cal-c-cat-name">Marketing <em>cookies.</em></h3>
              <p class="cal-c-cat-desc">Used by partners to show relevant Calcaterra material on other sites you visit. Off by default.</p>
            </div>
            <label class="cal-c-switch" aria-label="Marketing cookies">
              <input type="checkbox" data-category="marketing">
              <span class="cal-c-switch-slider"></span>
            </label>
          </div>

          <div class="cal-c-actions">
            <button type="button" class="cal-c-btn cal-c-btn-ghost" data-action="reject">Reject All</button>
            <button type="button" class="cal-c-btn cal-c-btn-primary" data-action="save">Save My Choices</button>
          </div>
        </div>
      </div>
    `

    overlay.addEventListener('click', (e) => {
      const action = e.target?.dataset?.action
      if (!action) return
      const card = overlay.querySelector('#cal-cookie-card')
      if (action === 'customize') { card.classList.add('customize'); return }
      if (action === 'accept')   { setConsent({ functional: true,  analytics: true,  marketing: true  }); close(overlay); return }
      if (action === 'reject')   { setConsent({ functional: false, analytics: false, marketing: false }); close(overlay); return }
      if (action === 'save')     {
        setConsent({
          functional: !!card.querySelector('[data-category="functional"]').checked,
          analytics:  !!card.querySelector('[data-category="analytics"]').checked,
          marketing:  !!card.querySelector('[data-category="marketing"]').checked,
        })
        close(overlay); return
      }
    })

    return overlay
  }

  function close (overlay) {
    overlay.classList.remove('show')
    overlay.classList.add('hide')
    setTimeout(() => overlay.remove(), 600)
  }

  function open (prefill) {
    injectStyles()
    // Don't open twice
    const existing = document.getElementById('cal-cookie-overlay')
    if (existing) return existing
    const overlay = build()
    document.body.appendChild(overlay)
    // If user has prior consent, prefill the toggles + open in customize mode
    if (prefill) {
      const card = overlay.querySelector('#cal-cookie-card')
      card.classList.add('customize')
      const c = getConsent()
      if (c) {
        card.querySelector('[data-category="functional"]').checked = !!c.functional
        card.querySelector('[data-category="analytics"]').checked  = !!c.analytics
        card.querySelector('[data-category="marketing"]').checked  = !!c.marketing
      }
    }
    // animate in next frame
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')))
    return overlay
  }

  // ── Init ────────────────────────────────────────────────────────
  function init () {
    if (!getConsent()) {
      open(false)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  // Public API
  window.CalcaterraCookies = {
    getConsent,
    has,
    openPreferences: () => open(true),
    reset: () => { try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}; document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`; open(false) },
  }
})()
