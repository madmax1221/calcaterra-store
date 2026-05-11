// Calcaterra — public newsletter unsubscribe
// Removes an email from newsletter_subscribers. Called from the
// /unsubscribe page on the storefront.
//
// Idempotent: returns success even if the email wasn't on the list,
// to avoid leaking which addresses are subscribed.
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Body: { email: string }

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error: delErr } = await admin
      .from('newsletter_subscribers')
      .delete()
      .eq('email', email)

    if (delErr) {
      console.error('Unsubscribe error:', delErr)
      return json({ error: 'Failed to unsubscribe' }, 500)
    }

    return json({ success: true })

  } catch (err) {
    console.error('unsubscribe-newsletter error:', err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
