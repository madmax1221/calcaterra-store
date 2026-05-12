// Calcaterra — public newsletter signup
// Called by the storefront. Upserts a subscriber and sends a branded
// "thanks for subscribing" email via Resend.
//
// ENV required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
//   RESEND_FROM (optional, defaults to 'Calcaterra <noreply@calcaterra.co>')
//
// Body: { email: string, first_name?: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => null)
    if (!body?.email) return json({ error: 'Email is required' }, 400)

    const email = String(body.email).trim().toLowerCase()
    const first_name = body.first_name ? String(body.first_name).trim() : null

    // Basic email shape check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if subscriber already exists (so we don't re-send welcome)
    const { data: existing } = await admin
      .from('newsletter_subscribers')
      .select('id, email')
      .eq('email', email)
      .maybeSingle()

    if (!existing) {
      const { error: insertErr } = await admin
        .from('newsletter_subscribers')
        .insert([{ email, first_name }])
      if (insertErr) {
        console.error('Insert error:', insertErr)
        return json({ error: 'Failed to subscribe' }, 500)
      }
    }

    // Send welcome email (best-effort — don't fail subscription if email errors)
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (resendApiKey) {
      const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'
      const name = first_name || 'there'
      const html = welcomeNewsletterHtml(name, email)

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [email],
          subject: existing ? 'You\'re already on the list — Calcaterra' : 'Welcome to Calcaterra',
          html,
        }),
      })
      const rJson = await r.json().catch(() => ({}))
      if (r.ok) {
        try {
          await admin.from('email_log').insert([{
            recipient: email,
            subject: existing ? 'You\'re already on the list — Calcaterra' : 'Welcome to Calcaterra',
            provider_id: rJson.id ?? null,
            meta: { kind: 'newsletter_welcome' },
          }])
        } catch (_) { /* noop */ }
      } else {
        console.error('Resend error:', rJson)
      }
    }

    return json({ success: true, already_subscribed: !!existing })

  } catch (err) {
    console.error('subscribe-newsletter error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function welcomeNewsletterHtml(name: string, email: string) {
  const unsub = `https://calcaterra.co/unsubscribe?email=${encodeURIComponent(email)}`
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light only"/>
<title>Welcome to Calcaterra</title>
</head>
<body style="margin:0;padding:0;background:#e9e5de;font-family:Georgia,'Times New Roman',serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;">You're on the list. Welcome to Calcaterra.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e5de;">
  <tr><td align="center" style="padding:0;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#f2efe9;">
      <!-- HEADER -->
      <tr><td style="padding:64px 56px 28px;text-align:center;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:300;letter-spacing:0.2em;color:#1a1814;">CALCATERRA</div>
        <div style="height:1px;background:rgba(26,24,20,0.12);margin:28px auto 0;width:42%;"></div>
      </td></tr>
      <!-- SPACER -->
      <tr><td style="line-height:0;font-size:0;padding:0;height:40px;">&nbsp;</td></tr>
      <!-- EYEBROW -->
      <tr><td style="padding:0 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.42);text-transform:uppercase;margin-bottom:18px;">You're on the list</div>
      </td></tr>
      <!-- HEADLINE -->
      <tr><td style="padding:0 56px 36px;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;font-weight:300;line-height:1.12;letter-spacing:0.015em;color:#1a1814;">Welcome,<br/><em style="font-style:italic;color:rgba(26,24,20,0.4);">${escapeHtml(name)}.</em></h1>
      </td></tr>
      <!-- BODY -->
      <tr><td style="padding:0 56px 24px;">
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">Thank you for joining Calcaterra. You will be the first to learn of new releases, stories from the atelier, and limited drops.</p>
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">Never spam. Never noise. Only what is worth your attention.</p>
      </td></tr>
      <!-- SIGN-OFF -->
      <tr><td style="padding:24px 56px 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:rgba(26,24,20,0.55);">Designed once. Worn indefinitely.</div>
      </td></tr>
      <!-- HAIRLINE -->
      <tr><td style="padding:0 56px;">
        <div style="height:1px;background:rgba(26,24,20,0.08);"></div>
      </td></tr>
      <!-- FOOTER — tonal cream with logo stamp -->
      <tr><td style="padding:36px 56px 56px;text-align:center;">
        <div style="display:inline-block;background:#1a1814;padding:14px 18px;margin-bottom:18px;">
          <img src="https://cdn.shopify.com/s/files/1/0994/8715/4470/files/Untitled_design_c4295222-cdc2-4f27-b349-bc971fbf6cc8.png?v=1773510117" alt="Calcaterra" width="40" style="display:block;height:32px;width:auto;border:0;outline:none;text-decoration:none;"/>
        </div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.55em;color:rgba(26,24,20,0.6);margin-bottom:6px;">CALCATERRA</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:7px;font-weight:300;letter-spacing:0.5em;color:rgba(26,24,20,0.3);text-transform:uppercase;margin-bottom:28px;">Built on Conviction</div>
        <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:9.5px;font-weight:300;letter-spacing:0.04em;color:rgba(26,24,20,0.4);line-height:1.7;">
          You are receiving this because you joined the Calcaterra mailing list.
        </p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:300;letter-spacing:0.34em;color:rgba(26,24,20,0.4);text-transform:uppercase;">
          <a href="https://calcaterra.co" style="color:rgba(26,24,20,0.55);text-decoration:none;">calcaterra.co</a>
          &nbsp;&middot;&nbsp;
          <a href="${unsub}" style="color:rgba(26,24,20,0.55);text-decoration:none;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
