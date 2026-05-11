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
      const html = welcomeNewsletterHtml(name)

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

function welcomeNewsletterHtml(name: string) {
  return `<!DOCTYPE html><html><body style="background:#f2efe9;margin:0;padding:0;font-family:'Times New Roman',serif;">
<div style="max-width:560px;margin:0 auto;padding:60px 40px;">
  <p style="font-family:'Times New Roman',serif;font-size:24px;font-weight:300;letter-spacing:0.15em;color:#1a1814;margin-bottom:48px;">CALCATERRA</p>
  <p style="font-family:'Montserrat',sans-serif;font-size:9px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);margin-bottom:16px;">YOU'RE ON THE LIST</p>
  <h1 style="font-size:36px;font-weight:300;color:#1a1814;margin-bottom:8px;line-height:1.1;">Welcome,<br><em style="font-style:italic;color:rgba(26,24,20,0.4);">${escapeHtml(name)}.</em></h1>
  <p style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:300;letter-spacing:0.08em;color:rgba(26,24,20,0.6);line-height:2;margin:32px 0;">
    Thank you for joining Calcaterra. You'll be the first to know about new releases, behind-the-scenes stories, and limited drops — never spam, never noise.
  </p>
  <p style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:300;letter-spacing:0.08em;color:rgba(26,24,20,0.6);line-height:2;margin:24px 0 48px;">
    Designed once. Worn indefinitely.
  </p>
  <div style="border-top:1px solid rgba(26,24,20,0.08);padding-top:24px;margin-top:48px;">
    <p style="font-family:'Montserrat',sans-serif;font-size:8px;font-weight:300;letter-spacing:0.3em;color:rgba(26,24,20,0.3);">
      CALCATERRA · BUILT ON CONVICTION<br><br>
      <a href="https://calcaterra.co" style="color:rgba(26,24,20,0.5);text-decoration:none;">calcaterra.co</a>
    </p>
  </div>
</div></body></html>`
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
