// Calcaterra — generic send-email Edge Function
// Used by cal-ops.html for: order confirmations, shipping notifications,
// warranty reminders, contact replies, and any future transactional sends.
//
// ENV required:
//   RESEND_API_KEY        — Resend API key
//   RESEND_FROM           — optional override, defaults to 'Calcaterra <noreply@calcaterra.co>'
//
// Body: { to: string | string[], subject: string, html: string, reply_to?: string, from?: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth guard: only allow callers with a valid Supabase session whose
    //    `customers.role = 'admin'`. Storefront flows that need to send mail
    //    (contact form, etc.) have their own dedicated functions.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // Verify the JWT belongs to a real user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Verify that user is an admin (RLS-bypassing service-role client)
    const adminClient = createClient(supabaseUrl, serviceKey)
    const { data: customer, error: custErr } = await adminClient
      .from('customers')
      .select('role')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (custErr || !customer || customer.role !== 'admin') {
      return json({ error: 'Forbidden' }, 403)
    }

    // ── Parse + validate payload
    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'Invalid JSON body' }, 400)
    const { to, subject, html, reply_to, from } = body
    if (!to || !subject || !html) {
      return json({ error: 'Missing required fields: to, subject, html' }, 400)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      return json({ error: 'RESEND_API_KEY not configured' }, 500)
    }
    // Caller can pass `from`; otherwise default to support@. Specific senders
    // (orders@, info@) are passed explicitly by the cal-ops UI per email type.
    const defaultFrom = Deno.env.get('RESEND_FROM_SUPPORT') ?? 'Calcaterra Support <support@calcaterra.co>'

    const recipients = Array.isArray(to) ? to : [to]

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || defaultFrom,
        to: recipients,
        reply_to: reply_to || undefined,
        subject,
        html,
      }),
    })

    const resendJson = await resendRes.json().catch(() => ({}))
    if (!resendRes.ok) {
      console.error('Resend error:', resendJson)
      return json({ error: 'Email provider rejected the request', details: resendJson }, 502)
    }

    // ── Lightweight audit log (best-effort; ignore failures so the email
    //    still succeeds if the table doesn't exist yet)
    try {
      await adminClient.from('email_log').insert([{
        sent_by: user.id,
        recipient: recipients.join(','),
        subject,
        provider_id: resendJson.id ?? null,
      }])
    } catch (_) { /* noop */ }

    return json({ success: true, id: resendJson.id ?? null })

  } catch (err) {
    console.error('send-email error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
