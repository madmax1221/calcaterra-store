// Calcaterra — contact form handler
// Stores the submission and emails support. Rate-limited per IP, honeypot
// protected, CORS origin-allowlisted.
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// Body: { name, email, subject?, message, company? (honeypot) }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://calcaterra.co',
  'https://www.calcaterra.co',
  'https://calcaterra-store.vercel.app',
]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_MAX = 5             // submissions per IP
const RATE_WINDOW_MS = 60 * 60 * 1000

function cors(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

serve(async (req) => {
  const corsHeaders = cors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { name, email, subject, message, company } = await req.json().catch(() => ({}))

    // Honeypot: real users never fill the hidden "company" field. Bots do.
    // Pretend success so the bot doesn't learn it was filtered.
    if (company) return json({ success: true }, 200, corsHeaders)

    if (!name || !email || !message) {
      return json({ error: 'Missing required fields.' }, 400, corsHeaders)
    }
    if (!EMAIL_RE.test(String(email).trim())) {
      return json({ error: 'Invalid email address.' }, 400, corsHeaders)
    }

    // Length caps to keep payloads sane.
    const nm = String(name).trim().slice(0, 120)
    const em = String(email).trim().toLowerCase().slice(0, 200)
    const sub = subject ? String(subject).trim().slice(0, 200) : ''
    const msg = String(message).trim().slice(0, 5000)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Rate limit per IP. Silent success when tripped.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'noip'
    if (await rateLimited(supabase, 'contact', ip)) {
      return json({ success: true }, 200, corsHeaders)
    }

    const { error: dbError } = await supabase
      .from('contact_submissions')
      .insert([{ name: nm, email: em, subject: sub, message: msg }])
    if (dbError) {
      console.error('DB insert error:', dbError)
      return json({ error: 'Failed to save submission.' }, 500, corsHeaders)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (resendApiKey) {
      const emailBody = `New contact form submission from calcaterra.co

Name:    ${nm}
Email:   ${em}
Subject: ${sub || 'Not specified'}

Message:
${msg}

---
Reply directly to this email to respond to the customer.`.trim()

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Calcaterra Contact <support@calcaterra.co>',
          to: ['support@calcaterra.co'],
          reply_to: em,
          subject: `Contact Form: ${sub || 'New enquiry'} (${nm})`,
          text: emailBody,
        }),
      })
    }

    return json({ success: true }, 200, corsHeaders)
  } catch (err) {
    console.error('Function error:', err)
    return json({ error: 'Unexpected error.' }, 500, corsHeaders)
  }
})

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function rateLimited(admin: ReturnType<typeof createClient>, bucket: string, ip: string): Promise<boolean> {
  try {
    const key = bucket + ':' + (await sha256Hex(ip))
    const now = new Date()
    const { data: row } = await admin.from('form_rate_limit').select('count, window_start').eq('key', key).maybeSingle()
    if (!row) {
      await admin.from('form_rate_limit').insert({ key, count: 1, window_start: now.toISOString() })
      return false
    }
    const withinWindow = now.getTime() - new Date(row.window_start as string).getTime() < RATE_WINDOW_MS
    if (!withinWindow) {
      await admin.from('form_rate_limit').update({ count: 1, window_start: now.toISOString() }).eq('key', key)
      return false
    }
    if ((row.count as number) >= RATE_MAX) return true
    await admin.from('form_rate_limit').update({ count: (row.count as number) + 1 }).eq('key', key)
    return false
  } catch (_) { return false }
}
