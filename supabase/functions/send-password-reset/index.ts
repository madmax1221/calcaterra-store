// Calcaterra — send password reset email (custom flow)
// Public endpoint called by /forgot-password and the dashboard "Send reset link"
// button instead of the native auth.resetPasswordForEmail().
//
// Why custom: native flow only exposes {{ .Email }} mail-merge variable, which
// forces email-in-URL for the cancel link. With our own send we mint a
// single-use token bound to this specific reset request, store it server-side,
// and embed only the token in the cancel link — no email in any URL, no
// enumeration via the cancel endpoint.
//
// Body: { email: string, redirect_to?: string }
// Always returns success silently. The user does not learn whether the email
// is registered.
//
// ENV required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
//   RESEND_FROM_NOREPLY (optional, defaults to noreply@calcaterra.co)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE_ALLOWED_REDIRECTS = [
  'https://calcaterra.co/forgot-password',
  'https://www.calcaterra.co/forgot-password',
]
const DEFAULT_REDIRECT = SITE_ALLOWED_REDIRECTS[0]

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://calcaterra.co',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Rate limit: max 3 reset requests per email per hour.
const RATE_MAX = 3
const RATE_WINDOW_MS = 60 * 60 * 1000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(rawEmail)) {
      // Silent success — don't tell the caller their input is malformed if we
      // wouldn't tell them whether the address is registered.
      return json({ success: true })
    }
    const email = rawEmail

    const redirectRaw = typeof body?.redirect_to === 'string' ? body.redirect_to : DEFAULT_REDIRECT
    const redirectTo = SITE_ALLOWED_REDIRECTS.includes(redirectRaw) ? redirectRaw : DEFAULT_REDIRECT

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Rate limit by email hash. Reuses the same table as auth-cancel-recovery
    // since both endpoints share the same "abuse via known email" threat model.
    const limited = await isRateLimited(admin, email)
    if (limited) return json({ success: true })

    // Mint a single-use cancel token before generating the reset link, so the
    // token is stored even if the link generation later fails (we'd rather
    // have an unused token than a sent email with no way to cancel it).
    const token = makeToken()
    const ip = clientIp(req)

    // Get the recovery link from Supabase. If the email is not registered,
    // generateLink returns an error — we treat that as "silent success".
    let actionLink: string | null = null
    try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      if (!error && data?.properties?.action_link) {
        actionLink = data.properties.action_link
      }
    } catch (_) { /* noop */ }

    if (!actionLink) {
      // Email not registered, or generateLink threw. Don't leak — return success.
      return json({ success: true })
    }

    // Store the cancel token now that we know we're going to send the email.
    try {
      await admin.from('password_reset_attempts').insert({ token, email, ip })
    } catch (_) { /* If storing fails, still send the email — without a working
                     cancel link, but the reset itself is the user's safety net. */ }

    // Build and send the branded email through Resend.
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return json({ error: 'Email provider not configured' }, 500)
    const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'
    const cancelUrl = `https://calcaterra.co/cancel-reset?t=${encodeURIComponent(token)}`
    const html = resetEmailHtml(actionLink, cancelUrl)

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email],
        subject: 'Reset your Calcaterra password',
        html,
      }),
    })
    const rJson = await r.json().catch(() => ({}))
    if (!r.ok) console.error('Resend error:', rJson)

    // Best-effort audit log
    try {
      await admin.from('email_log').insert([{
        recipient: email,
        subject: 'Reset your Calcaterra password',
        provider_id: rJson.id ?? null,
        meta: { kind: 'password_reset', token_prefix: token.slice(0, 8) },
      }])
    } catch (_) { /* noop */ }

    return json({ success: true })
  } catch (err) {
    console.error('send-password-reset error:', err)
    // Still report success to avoid enumeration.
    return json({ success: true })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function makeToken(): string {
  // 32 random bytes → base64url (no padding)
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Shared rate-limit table with auth-cancel-recovery.
async function isRateLimited(admin: ReturnType<typeof createClient>, email: string): Promise<boolean> {
  try {
    const hash = await sha256Hex(email)
    const now = new Date()
    const { data: row } = await admin
      .from('recovery_cancel_attempts')
      .select('count, window_start')
      .eq('email_hash', hash)
      .maybeSingle()

    if (!row) {
      await admin.from('recovery_cancel_attempts').insert({
        email_hash: hash, count: 1, window_start: now.toISOString(),
      })
      return false
    }

    const windowStart = new Date(row.window_start as string)
    const withinWindow = now.getTime() - windowStart.getTime() < RATE_WINDOW_MS

    if (!withinWindow) {
      await admin.from('recovery_cancel_attempts')
        .update({ count: 1, window_start: now.toISOString() })
        .eq('email_hash', hash)
      return false
    }

    if ((row.count as number) >= RATE_MAX) return true

    await admin.from('recovery_cancel_attempts')
      .update({ count: (row.count as number) + 1 })
      .eq('email_hash', hash)
    return false
  } catch (_) {
    return false // fail open
  }
}

function resetEmailHtml(resetUrl: string, cancelUrl: string) {
  // resetUrl and cancelUrl are server-controlled (we built them above), no
  // user-controlled string ever lands in this HTML, so escaping is not needed.
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light only"/>
<title>Reset your Calcaterra password</title>
</head>
<body style="margin:0;padding:0;background:#e9e5de;font-family:Georgia,'Times New Roman',serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">A secure link to reset your Calcaterra password.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e5de;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#f2efe9;">

      <tr><td style="padding:64px 56px 28px;text-align:center;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:300;letter-spacing:0.2em;color:#1a1814;">CALCATERRA</div>
        <div style="height:1px;background:rgba(26,24,20,0.12);margin:28px auto 0;width:42%;"></div>
      </td></tr>
      <tr><td style="line-height:0;font-size:0;padding:0;height:40px;">&nbsp;</td></tr>

      <tr><td style="padding:0 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.42);text-transform:uppercase;margin-bottom:18px;">Password reset</div>
      </td></tr>

      <tr><td style="padding:0 56px 36px;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;font-weight:300;line-height:1.12;letter-spacing:0.015em;color:#1a1814;">
          A new password,<br/><em style="font-style:italic;color:rgba(26,24,20,0.4);">at your request.</em>
        </h1>
      </td></tr>

      <tr><td style="padding:0 56px 24px;">
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">
          A request to reset the password on this Calcaterra account was received. To continue, follow the link below within the next hour.
        </p>
      </td></tr>

      <tr><td style="padding:8px 56px 36px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr><td style="background:#1a1814;">
            <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:18px 44px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:#f2efe9;text-decoration:none;text-transform:uppercase;">Reset password</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 56px 18px;">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:rgba(26,24,20,0.55);line-height:1.85;">
          If you did not request this, your password will not change unless the link above is used. For added safety, you may invalidate this request below.
        </p>
      </td></tr>

      <tr><td style="padding:0 56px 40px;">
        <a href="${cancelUrl}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:300;letter-spacing:0.5em;color:rgba(26,24,20,0.7);text-decoration:none;text-transform:uppercase;border-bottom:1px solid rgba(26,24,20,0.25);padding-bottom:3px;">This was not me &middot; cancel this request</a>
      </td></tr>

      <tr><td style="padding:0 56px 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:rgba(26,24,20,0.55);">Calcaterra.</div>
      </td></tr>

      <tr><td style="padding:0 56px;">
        <div style="height:1px;background:rgba(26,24,20,0.08);"></div>
      </td></tr>

      <tr><td style="padding:36px 56px 56px;text-align:center;">
        <img src="https://calcaterra.co/images/calcaterra-logo.png" alt="Calcaterra" width="56" style="display:block;margin:0 auto 18px;height:auto;width:56px;max-width:56px;border:0;outline:none;text-decoration:none;"/>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.55em;color:rgba(26,24,20,0.6);margin-bottom:6px;">CALCATERRA</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:7px;font-weight:300;letter-spacing:0.5em;color:rgba(26,24,20,0.3);text-transform:uppercase;margin-bottom:28px;">Built on Conviction</div>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:300;letter-spacing:0.34em;color:rgba(26,24,20,0.4);text-transform:uppercase;">
          <a href="https://calcaterra.co" style="color:rgba(26,24,20,0.55);text-decoration:none;">calcaterra.co</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

function clientIp(req: Request): string {
  // CF-Connecting-IP is added by Cloudflare's edge and cannot be set by clients.
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  // x-forwarded-for: the LAST entry is what the trusted proxy appended.
  // Attackers can prepend whatever they want, but they can't strip what
  // the proxy adds after.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return 'noip'
}
