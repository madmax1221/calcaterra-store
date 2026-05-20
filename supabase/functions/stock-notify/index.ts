// Calcaterra — public restock-notification capture
// Stores an email + variant pair so the admin can later notify when stock
// returns. Always responds success:true to avoid leaking which emails are
// already on file or which variants exist.
//
// Body: { email: string, variant_id: uuid, first_name?: string }
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://calcaterra.co',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const variantId = typeof body?.variant_id === 'string' ? body.variant_id.trim() : ''
    const firstName = typeof body?.first_name === 'string'
      ? body.first_name.trim().slice(0, 80)
      : null

    if (!EMAIL_RE.test(email) || !UUID_RE.test(variantId)) {
      // Silent success — don't tell the caller their input was malformed
      return json({ success: true })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

    // Upsert: if this email already wants this variant, just leave the row
    // alone. UNIQUE(variant_id, email) makes the insert idempotent.
    await admin
      .from('stock_notifications')
      .upsert(
        { variant_id: variantId, email, first_name: firstName, ip },
        { onConflict: 'variant_id,email', ignoreDuplicates: true },
      )

    return json({ success: true })
  } catch (err) {
    console.error('stock-notify error:', err)
    return json({ success: true })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
