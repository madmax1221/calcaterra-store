// Calcaterra — public newsletter unsubscribe (token-gated)
//
// Two modes, both idempotent and non-enumerating (always return success):
//   1. { email, token }  — token = HMAC-SHA256(email, UNSUBSCRIBE_SECRET).
//      If valid, the address is removed. This is the one-click path used by
//      tokenised links in our emails.
//   2. { email }         — no token. We do NOT remove anything (that would let
//      anyone unsubscribe anyone). Instead we email that address a tokenised
//      confirm link, so only the inbox owner can complete the unsubscribe.
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      UNSUBSCRIBE_SECRET, RESEND_FROM_NOREPLY (optional)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://calcaterra.co',
  'https://www.calcaterra.co',
  'https://calcaterra-store.vercel.app',
]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cors(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

serve(async (req) => {
  const corsHeaders = cors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)

  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!EMAIL_RE.test(email)) return json({ success: true }, 200, corsHeaders) // silent

    const secret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? ''
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    if (token) {
      // ── One-click path: token must match HMAC(email) ──
      const expected = await hmacHex(email, secret)
      if (!safeEqual(token, expected)) {
        return json({ success: true }, 200, corsHeaders) // invalid token, say nothing
      }
      await admin.from('newsletter_subscribers').delete().eq('email', email)
      return json({ success: true, unsubscribed: true }, 200, corsHeaders)
    }

    // ── No token: send a confirm link only if the address is actually on the
    //    list. Either way return success so we don't reveal membership. ──
    const { data: existing } = await admin
      .from('newsletter_subscribers')
      .select('email')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      const resendApiKey = Deno.env.get('RESEND_API_KEY')
      if (resendApiKey && secret) {
        const tok = await hmacHex(email, secret)
        const link = `https://calcaterra.co/unsubscribe?email=${encodeURIComponent(email)}&token=${tok}`
        const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from, to: [email],
              subject: 'Confirm your unsubscribe · Calcaterra',
              html: confirmHtml(link),
            }),
          })
        } catch (_) { /* noop */ }
      }
    }

    return json({ success: true, confirm_sent: true }, 200, corsHeaders)
  } catch (err) {
    console.error('unsubscribe-newsletter error:', err)
    return json({ success: true }, 200, corsHeaders)
  }
})

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time string compare to avoid token timing leaks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function confirmHtml(link: string) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light only"/><title>Confirm unsubscribe</title></head>
<body style="margin:0;padding:0;background:#e9e5de;font-family:Georgia,'Times New Roman',serif;color:#1a1814;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e5de;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#f2efe9;">
      <tr><td style="padding:64px 56px 28px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:32px;font-weight:300;letter-spacing:0.2em;color:#1a1814;">CALCATERRA</div>
        <div style="height:1px;background:rgba(26,24,20,0.12);margin:28px auto 0;width:42%;"></div>
      </td></tr>
      <tr><td style="padding:24px 56px 36px;">
        <p style="margin:0 0 22px;font-family:Georgia,serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">
          We received a request to unsubscribe this address from the Calcaterra mailing list. If this was you, confirm below. If not, ignore this email and nothing changes.
        </p>
      </td></tr>
      <tr><td style="padding:0 56px 48px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#1a1814;">
          <a href="${link}" style="display:inline-block;padding:18px 44px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:#f2efe9;text-decoration:none;text-transform:uppercase;">Confirm unsubscribe</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 56px;"><div style="height:1px;background:rgba(26,24,20,0.08);"></div></td></tr>
      <tr><td style="padding:36px 56px 56px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:13px;letter-spacing:0.55em;color:rgba(26,24,20,0.6);">CALCATERRA</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}
