// Calcaterra — watch registration confirmation
// Called by dashboard.html after a customer successfully registers a watch.
//
// Auth-gated: caller presents their Supabase session JWT. The function
// looks up the warranty record by ID, verifies it actually belongs to
// this user (via customers.auth_user_id), and only then sends the email.
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY
// Body: { warranty_id: string }

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

    // Authenticate caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user || !user.email) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => null)
    if (!body?.warranty_id) return json({ error: 'warranty_id required' }, 400)

    // Look up warranty with the customer it belongs to
    const admin = createClient(supabaseUrl, serviceKey)
    const { data: warranty, error: wErr } = await admin
      .from('warranties')
      .select(`
        id, activation_code, variant, collection, status, activated_at, warranty_end,
        customers(id, auth_user_id, first_name, last_name, email)
      `)
      .eq('id', body.warranty_id)
      .maybeSingle()

    if (wErr || !warranty) return json({ error: 'Warranty not found' }, 404)

    // Ownership check — only the watch's customer can trigger this email
    if (!warranty.customers || warranty.customers.auth_user_id !== user.id) {
      return json({ error: 'Forbidden' }, 403)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)
    const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'

    const name = warranty.customers.first_name || 'Valued Customer'
    const email = warranty.customers.email || user.email
    const variant = (warranty.variant || 'roma').toLowerCase()
    const watchName = 'Roma ' + variant.charAt(0).toUpperCase() + variant.slice(1)
    const collectionUpper = (warranty.collection || 'roma').toUpperCase()
    const activatedFormatted = warranty.activated_at
      ? new Date(warranty.activated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const endFormatted = warranty.warranty_end
      ? new Date(warranty.warranty_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : ''

    const html = renderHtml({ name, watchName, collection: collectionUpper, code: warranty.activation_code, registered: activatedFormatted, expires: endFormatted })

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: `Your ${watchName} is registered`, html }),
    })
    const rJson = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('Resend error:', rJson)
      return json({ error: 'Email provider rejected the request', details: rJson }, 502)
    }

    try {
      await admin.from('email_log').insert([{
        sent_by: user.id,
        recipient: email,
        subject: `Your ${watchName} is registered`,
        provider_id: rJson.id ?? null,
        meta: { kind: 'watch_registration', warranty_id: warranty.id },
      }])
    } catch (_) { /* noop */ }

    return json({ success: true, id: rJson.id ?? null })

  } catch (err) {
    console.error('send-watch-registration error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function renderHtml(d: { name: string; watchName: string; collection: string; code: string; registered: string; expires: string }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light only"/>
<title>Your ${esc(d.watchName)} is registered</title>
</head>
<body style="margin:0;padding:0;background:#e9e5de;font-family:Georgia,'Times New Roman',serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your ${esc(d.watchName)} is now permanently linked to your account.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e5de;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#f2efe9;">
      <tr><td style="padding:64px 56px 28px;text-align:center;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:300;letter-spacing:0.2em;color:#1a1814;">CALCATERRA</div>
        <div style="height:1px;background:rgba(26,24,20,0.12);margin:28px auto 0;width:42%;"></div>
      </td></tr>
      <tr><td style="line-height:0;font-size:0;padding:0;height:40px;">&nbsp;</td></tr>
      <tr><td style="padding:0 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.42);text-transform:uppercase;margin-bottom:18px;">Registration complete</div>
      </td></tr>
      <tr><td style="padding:0 56px 36px;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;font-weight:300;line-height:1.12;letter-spacing:0.015em;color:#1a1814;">Your timepiece<br/><em style="font-style:italic;color:rgba(26,24,20,0.4);">is recorded.</em></h1>
      </td></tr>
      <tr><td style="padding:0 56px 24px;">
        <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:rgba(26,24,20,0.78);line-height:1.95;">Dear ${esc(d.name)}, your ${esc(d.watchName)} is now permanently linked to your account. Your two-year warranty is active.</p>
      </td></tr>
      <tr><td style="padding:8px 56px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid rgba(26,24,20,0.1);border-bottom:1px solid rgba(26,24,20,0.1);">
          <tr><td style="padding:22px 0;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:10px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);text-transform:uppercase;margin-bottom:8px;">Reference</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:300;color:#1a1814;letter-spacing:0.04em;">${esc(d.watchName)}</div>
            <div style="margin-top:18px;font-family:Georgia,'Times New Roman',serif;font-size:10px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);text-transform:uppercase;margin-bottom:8px;">Activation Code</div>
            <div style="font-family:'Courier New',monospace;font-size:18px;font-weight:300;color:#1a1814;letter-spacing:0.1em;">${esc(d.code)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;width:100%;">
              <tr>
                <td style="width:50%;">
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:10px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);text-transform:uppercase;margin-bottom:6px;">Registered</div>
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:rgba(26,24,20,0.78);">${esc(d.registered)}</div>
                </td>
                <td style="width:50%;">
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:10px;font-weight:300;letter-spacing:0.55em;color:rgba(26,24,20,0.4);text-transform:uppercase;margin-bottom:6px;">Warranty Until</div>
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:rgba(26,24,20,0.78);">${esc(d.expires)}</div>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:32px 56px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#1a1814;">
          <a href="https://calcaterra.co/dashboard?tab=watches" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:400;letter-spacing:0.58em;color:#f2efe9;background:#1a1814;text-decoration:none;padding:20px 42px;text-transform:uppercase;border:1px solid #1a1814;">View Your Watches</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:48px 56px 56px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:rgba(26,24,20,0.55);">Designed once. Worn indefinitely.</div>
      </td></tr>
      <tr><td style="padding:0 56px;"><div style="height:1px;background:rgba(26,24,20,0.08);"></div></td></tr>
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

function esc(s: string) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
