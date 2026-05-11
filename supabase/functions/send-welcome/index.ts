// Calcaterra — branded welcome email after account creation
// Called by register.html right after a successful signUp.
//
// Auth-gated: caller must present a valid Supabase JWT (the just-created
// session). We verify the email matches that user, so this endpoint can't
// be used to spam arbitrary addresses.
//
// ENV required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY
//   RESEND_FROM (optional)
//
// Body: { first_name?: string }
// Caller's email is read from the JWT — never trust client-supplied email here.

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
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user || !user.email) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    const first_name = body?.first_name ? String(body.first_name).trim() : (user.user_metadata?.first_name || 'there')
    const email = user.email

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)
    const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'

    const html = welcomeAccountHtml(first_name)

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email],
        subject: 'Welcome to Calcaterra',
        html,
      }),
    })
    const rJson = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('Resend error:', rJson)
      return json({ error: 'Email provider rejected the request', details: rJson }, 502)
    }

    // Log (best-effort)
    try {
      const admin = createClient(supabaseUrl, serviceKey)
      await admin.from('email_log').insert([{
        sent_by: user.id,
        recipient: email,
        subject: 'Welcome to Calcaterra',
        provider_id: rJson.id ?? null,
        meta: { kind: 'account_welcome' },
      }])
    } catch (_) { /* noop */ }

    return json({ success: true, id: rJson.id ?? null })

  } catch (err) {
    console.error('send-welcome error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function welcomeAccountHtml(name: string) {
  return `<!DOCTYPE html><html><body style="background:#f2efe9;margin:0;padding:0;font-family:'Times New Roman',serif;">
<div style="max-width:560px;margin:0 auto;padding:60px 40px;">
  <p style="font-family:'Times New Roman',serif;font-size:24px;font-weight:300;letter-spacing:0.15em;color:#1a1814;margin-bottom:48px;">CALCATERRA</p>
  <p style="font-family:'Montserrat',sans-serif;font-size:9px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);margin-bottom:16px;">YOUR ACCOUNT IS READY</p>
  <h1 style="font-size:36px;font-weight:300;color:#1a1814;margin-bottom:8px;line-height:1.1;">Welcome,<br><em style="font-style:italic;color:rgba(26,24,20,0.4);">${escapeHtml(name)}.</em></h1>
  <p style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:300;letter-spacing:0.08em;color:rgba(26,24,20,0.6);line-height:2;margin:32px 0;">
    Your Calcaterra account has been created. From here you can register your watches, activate warranties, and track every order from a single place.
  </p>
  <div style="margin:40px 0;">
    <a href="https://calcaterra.co/dashboard" style="display:inline-block;font-family:'Montserrat',sans-serif;font-size:9px;font-weight:300;letter-spacing:0.55em;color:#f2efe9;background:#1a1814;text-decoration:none;padding:18px 40px;">VIEW YOUR ACCOUNT</a>
  </div>
  <p style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:300;letter-spacing:0.08em;color:rgba(26,24,20,0.55);line-height:2;margin:32px 0;">
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
