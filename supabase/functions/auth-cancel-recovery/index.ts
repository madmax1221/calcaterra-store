// Calcaterra — auth-cancel-recovery
// Public endpoint hit by the "I didn't request this" link in the password reset email.
// Rotates the user's recovery token (which invalidates the link in the suspicious
// email), signs out all active sessions globally, and sends a confirmation email.
//
// Why this works without leaking which emails are registered:
//   - We always return success: true regardless of whether the email exists.
//   - The only externally observable side effect is for a registered user whose
//     pending recovery actually gets invalidated.
//
// Request:
//   POST /functions/v1/auth-cancel-recovery
//   Body: { e: string }   — base64url-encoded email address
//
// ENV required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   RESEND_FROM_NOREPLY  (optional, default 'Calcaterra <noreply@calcaterra.co>')

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://calcaterra.co',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /^[A-Za-z0-9_-]{20,256}$/
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000  // 1 hour

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Preferred path: single-use token from password_reset_attempts ────────
    // The cancel link in the email contains a 32-byte random token bound to
    // exactly one reset request. We look it up, verify it's not already
    // cancelled and not expired, then mark it cancelled. No email leaks.
    const t = typeof body?.t === 'string' ? body.t.trim() : ''
    let email = ''
    if (t) {
      if (!TOKEN_RE.test(t)) return json({ success: true })
      try {
        const { data: row } = await admin
          .from('password_reset_attempts')
          .select('email, created_at, cancelled_at')
          .eq('token', t)
          .maybeSingle()
        if (!row) return json({ success: true })                 // unknown token
        if (row.cancelled_at) return json({ success: true })     // already used
        const ageMs = Date.now() - new Date(row.created_at as string).getTime()
        if (ageMs > TOKEN_MAX_AGE_MS) return json({ success: true })  // expired
        email = (row.email as string).toLowerCase()
        // Mark cancelled now so a concurrent click can't replay.
        await admin.from('password_reset_attempts')
          .update({ cancelled_at: new Date().toISOString() })
          .eq('token', t)
      } catch (_) {
        return json({ success: true })
      }
    } else {
      // ── Legacy path: email in URL (?e=...) ─────────────────────────────────
      // Kept for any old emails still in inboxes that predate the token-based
      // flow. Rate-limited per email hash so it cannot be abused as a
      // griefing primitive. Once all pre-token reset emails have expired,
      // this branch can be removed.
      const e = typeof body?.e === 'string' ? body.e.trim() : ''
      if (!e) return json({ success: true })

      if (EMAIL_RE.test(e)) {
        email = e.toLowerCase()
      } else {
        try {
          const padded = e.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((e.length + 3) % 4)
          const decoded = atob(padded).trim().toLowerCase()
          if (EMAIL_RE.test(decoded)) email = decoded
        } catch (_) { /* noop */ }
      }
      if (!email) return json({ success: true })

      // Rate limit the legacy path (token path is single-use so it's
      // self-limiting).
      if (await isRateLimited(admin, email)) {
        return json({ success: true })
      }
    }

    // 1) Rotate the recovery token. generateLink updates auth.users.recovery_token,
    //    so the link in the suspicious email stops working. We never send the new link.
    //    If the email isn't registered, generateLink returns an error — we swallow it.
    let cancelled = false
    let userId: string | null = null
    try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: 'https://calcaterra.co/forgot-password' },
      })
      if (!error && data?.user?.id) {
        userId = data.user.id
        cancelled = true
      }
    } catch (_) { /* noop */ }

    // 2) Sign out all active sessions globally. Defensive — if an attacker had
    //    somehow already signed in, this kicks them out everywhere.
    if (userId) {
      try { await admin.auth.admin.signOut(userId, 'global') } catch (_) { /* noop */ }
    }

    // 3) Best-effort audit log
    if (userId) {
      try {
        await admin.from('email_log').insert([{
          sent_by: userId,
          recipient: email,
          subject: 'Password reset cancelled',
          meta: { kind: 'recovery_cancelled', cancelled_at: new Date().toISOString() },
        }])
      } catch (_) { /* noop */ }
    }

    // 4) Send the user a confirmation email (only if a user actually exists).
    if (cancelled) {
      const resendApiKey = Deno.env.get('RESEND_API_KEY')
      if (resendApiKey) {
        const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from,
              to: [email],
              subject: 'Password reset request cancelled',
              html: cancelledNotificationHtml(),
            }),
          })
        } catch (_) { /* noop */ }
      }
    }

    return json({ success: true })
  } catch (err) {
    console.error('auth-cancel-recovery error:', err)
    // Still respond success to avoid info leakage. Internal log captures the real error.
    return json({ success: true })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const RATE_WINDOW_MS = 60 * 60 * 1000   // 1 hour
const RATE_MAX = 3                       // max cancel attempts per email per window

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Returns true if the email has exceeded the rate limit and the caller should
// silently no-op. Side effects: upserts / increments the counter row.
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
      // Window expired — reset counter
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
    // Fail open if the rate limit infra is broken — don't break the cancel
    // flow because the counter table is misbehaving.
    return false
  }
}

function cancelledNotificationHtml() {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light only"/>
<title>Password reset request cancelled</title>
</head>
<body style="margin:0;padding:0;background:#e9e5de;font-family:Georgia,'Times New Roman',serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">The previous password reset link has been invalidated.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e5de;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#f2efe9;">
      <tr><td style="padding:64px 56px 28px;text-align:center;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:300;letter-spacing:0.2em;color:#1a1814;">CALCATERRA</div>
        <div style="height:1px;background:rgba(26,24,20,0.12);margin:28px auto 0;width:42%;"></div>
      </td></tr>
      <tr><td style="line-height:0;font-size:0;padding:0;height:40px;">&nbsp;</td></tr>
      <tr><td style="padding:0 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.42);text-transform:uppercase;margin-bottom:18px;">Account security</div>
      </td></tr>
      <tr><td style="padding:0 56px 36px;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;font-weight:300;line-height:1.12;letter-spacing:0.015em;color:#1a1814;">
          The reset request,<br/><em style="font-style:italic;color:rgba(26,24,20,0.4);">cancelled.</em>
        </h1>
      </td></tr>
      <tr><td style="padding:0 56px 24px;">
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">
          A password reset link was recently requested for this Calcaterra account. You have just confirmed it was not you, and the link has been invalidated.
        </p>
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">
          Your password has not changed. As a precaution, all active sessions on this account have been signed out.
        </p>
      </td></tr>
      <tr><td style="padding:0 56px 40px;">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:rgba(26,24,20,0.55);line-height:1.85;">
          If you continue to receive reset emails you did not request, please contact <a href="mailto:support@calcaterra.co" style="color:#1a1814;text-decoration:underline;">support@calcaterra.co</a> at your convenience.
        </p>
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
