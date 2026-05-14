// Calcaterra — admin newsletter broadcast
// Sends a composed newsletter to every active subscriber.
// Resend supports up to 100 recipients per request via "to" or BCC,
// so we batch sends in chunks of 50 to stay well under provider limits.
//
// Auth-gated: requires an admin JWT (customers.role = 'admin').
//
// ENV required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY
//   RESEND_FROM (optional)
//
// Body:
//   { subject: string, html: string, test_to?: string }
//   If test_to is provided we send only to that address (for dry-run preview).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BATCH = 50

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Verify caller is a real user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Verify admin role
    const admin = createClient(supabaseUrl, serviceKey)
    const { data: customer } = await admin
      .from('customers')
      .select('role')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (!customer || customer.role !== 'admin') return json({ error: 'Forbidden' }, 403)

    // Payload
    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'Invalid JSON' }, 400)
    const { subject, html, test_to } = body
    if (!subject || !html) return json({ error: 'subject and html are required' }, 400)

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)
    const from = Deno.env.get('RESEND_FROM_NOREPLY') ?? 'Calcaterra <noreply@calcaterra.co>'
    // Extract just the bare email from "Name <email>" so we can use it as the
    // primary "to" address in BCC broadcasts (Resend requires a plain address).
    const fromEmailMatch = from.match(/<([^>]+)>/)
    const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from

    // Test-send: just deliver to one address and log it as a preview
    if (test_to) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [test_to],
          subject: `[TEST] ${subject}`,
          html,
        }),
      })
      const rJson = await r.json().catch(() => ({}))
      if (!r.ok) return json({ error: 'Provider rejected test send', details: rJson }, 502)
      try {
        await admin.from('email_log').insert([{
          sent_by: user.id,
          recipient: test_to,
          subject: `[TEST] ${subject}`,
          provider_id: rJson.id ?? null,
          meta: { kind: 'newsletter_test' },
        }])
      } catch (_) { /* noop */ }
      return json({ success: true, mode: 'test', sent: 1, id: rJson.id ?? null })
    }

    // ── Resolve audience ──────────────────────────────────────
    // 'all'           — every newsletter subscriber (default)
    // 'customers'     — subscribers who have at least one paid order
    // 'non-customers' — subscribers without a paid order
    const audience = (body.audience || 'all').toLowerCase()

    const { data: subs, error: subsErr } = await admin
      .from('newsletter_subscribers')
      .select('email, first_name')
    if (subsErr) return json({ error: 'Failed to load subscribers', details: subsErr }, 500)
    if (!subs?.length) return json({ error: 'No subscribers to send to' }, 400)

    let recipients: string[]
    if (audience === 'all') {
      recipients = subs.map(s => s.email).filter(Boolean)
    } else {
      // Build a set of buyer emails (customers who have any order — pending,
      // confirmed, shipped, or delivered; excludes cancelled).
      const { data: paidOrders, error: ordErr } = await admin
        .from('orders')
        .select('customers(email)')
        .in('status', ['pending', 'confirmed', 'shipped', 'delivered'])
      if (ordErr) return json({ error: 'Failed to load orders', details: ordErr }, 500)
      const buyerEmails = new Set(
        (paidOrders || [])
          .map((o: any) => o.customers?.email)
          .filter(Boolean)
          .map((e: string) => e.toLowerCase())
      )
      const subEmails = subs.map(s => s.email).filter(Boolean)
      if (audience === 'customers') {
        recipients = subEmails.filter(e => buyerEmails.has(e.toLowerCase()))
      } else if (audience === 'non-customers' || audience === 'non_customers') {
        recipients = subEmails.filter(e => !buyerEmails.has(e.toLowerCase()))
      } else {
        return json({ error: `Unknown audience '${audience}'` }, 400)
      }
    }

    if (!recipients.length) return json({ error: `No subscribers match audience '${audience}'` }, 400)

    // Send in batches via Resend. Each batch becomes one API call where
    // every recipient is BCC'd (so they can't see each other's emails).
    let sent = 0
    let failed = 0
    const errors: unknown[] = []

    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH)
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [fromEmail],   // primary 'to' is ourselves so BCC recipients stay private
          bcc: slice,
          subject,
          html,
        }),
      })
      const rJson = await r.json().catch(() => ({}))
      if (!r.ok) {
        failed += slice.length
        errors.push(rJson)
        continue
      }
      sent += slice.length
      try {
        // Log one row per batch (not per recipient) to keep email_log readable
        await admin.from('email_log').insert([{
          sent_by: user.id,
          recipient: `(bcc x${slice.length})`,
          subject,
          provider_id: rJson.id ?? null,
          meta: { kind: 'newsletter_broadcast', audience, batch_size: slice.length, sample: slice.slice(0, 3) },
        }])
      } catch (_) { /* noop */ }
    }

    return json({ success: true, mode: 'broadcast', audience, sent, failed, total: recipients.length, errors: errors.slice(0, 3) })

  } catch (err) {
    console.error('send-broadcast error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
