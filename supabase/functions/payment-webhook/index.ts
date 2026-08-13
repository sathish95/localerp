// Supabase Edge Function: payment-webhook
//
// One function handles all three gateways — set each provider's webhook
// URL (in their own dashboard) to:
//   https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=razorpay
//   https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=stripe
//   https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=cashfree
//
// Every provider signs the RAW request body — this reads it as text
// first and verifies the signature BEFORE any JSON.parse, since parsing
// first and re-serializing would very likely produce different bytes
// than what was actually signed (key order, whitespace).
//
// NOT TESTED against any live gateway — written to each provider's
// public webhook-signing docs (Razorpay/Stripe/Cashfree), since no
// sandbox credentials were available while building this. Test each
// provider's signature verification against their own webhook
// simulator/test-mode before relying on this for real charges — a
// mismatched signature scheme here means either rejecting every real
// webhook or (worse) silently accepting forged ones.
//
// Deploy:
//   supabase functions deploy payment-webhook --no-verify-jwt
//   (--no-verify-jwt is required — gateways don't send a Supabase JWT,
//   they send their OWN signature instead, which is what this verifies)
//
// Webhook secrets (STEP132): read from payment_gateway_secrets first
// (Settings -> Payment Gateway Setup, super admin only), falling back
// to an env var of the same name — so `supabase secrets set
// RAZORPAY_WEBHOOK_SECRET=xxx` (and the Stripe/Cashfree equivalents)
// still work if you prefer the CLI over the UI.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const provider = new URL(req.url).searchParams.get('provider')
  if (!['razorpay', 'stripe', 'cashfree'].includes(provider || '')) {
    return new Response('Unknown or missing ?provider=', { status: 400 })
  }

  const rawBody = await req.text()
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    let verified = false
    let parsed: Record<string, unknown> = {}
    let providerOrderId: string | null = null
    let providerEventId: string | null = null
    let eventType = ''
    let outcome: 'success' | 'failure' | 'ignore' = 'ignore'

    if (provider === 'razorpay') {
      const signature = req.headers.get('x-razorpay-signature') || ''
      verified = signature === await hmacHex(await getSecret(admin, 'razorpay', 'webhook_secret', 'RAZORPAY_WEBHOOK_SECRET'), rawBody)
      parsed = JSON.parse(rawBody)
      eventType = String(parsed.event || '')
      const payload = (parsed.payload as any) || {}
      providerOrderId = payload.order?.entity?.id || payload.payment?.entity?.order_id || null
      providerEventId = `${eventType}:${payload.payment?.entity?.id || providerOrderId}`
      if (eventType === 'order.paid' || eventType === 'payment.captured') outcome = 'success'
      else if (eventType === 'payment.failed') outcome = 'failure'
    }

    if (provider === 'stripe') {
      verified = await verifyStripeSignature(req.headers.get('stripe-signature') || '', rawBody, await getSecret(admin, 'stripe', 'webhook_secret', 'STRIPE_WEBHOOK_SECRET'))
      parsed = JSON.parse(rawBody)
      eventType = String(parsed.type || '')
      providerEventId = String(parsed.id || '')
      const obj = (parsed.data as any)?.object || {}
      providerOrderId = obj.id || null
      if (eventType === 'checkout.session.completed' && obj.payment_status === 'paid') outcome = 'success'
      else if (eventType === 'checkout.session.expired' || eventType === 'checkout.session.async_payment_failed') outcome = 'failure'
    }

    if (provider === 'cashfree') {
      const signature = req.headers.get('x-webhook-signature') || ''
      const timestamp = req.headers.get('x-webhook-timestamp') || ''
      verified = signature === await hmacBase64(await getSecret(admin, 'cashfree', 'webhook_secret', 'CASHFREE_WEBHOOK_SECRET'), `${timestamp}${rawBody}`)
      parsed = JSON.parse(rawBody)
      eventType = String(parsed.type || '')
      const data = (parsed.data as any) || {}
      providerOrderId = data.order?.order_id || null
      providerEventId = `${eventType}:${providerOrderId}:${data.payment?.cf_payment_id || ''}`
      if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') outcome = 'success'
      else if (eventType === 'PAYMENT_FAILED_WEBHOOK' || eventType === 'PAYMENT_USER_DROPPED_WEBHOOK') outcome = 'failure'
    }

    if (!verified) {
      console.error(`${provider} webhook signature verification failed`)
      return new Response('Invalid signature', { status: 401 })
    }

    // Idempotency — gateways retry webhooks at-least-once; a duplicate
    // delivery must not double-extend the subscription period.
    if (providerEventId) {
      const { data: existing } = await admin.from('payment_webhook_events').select('id').eq('provider', provider).eq('provider_event_id', providerEventId).maybeSingle()
      if (existing) return new Response('Already processed', { status: 200 })
    }

    let orderId: string | null = null
    if (providerOrderId) {
      const { data: order } = await admin.from('payment_orders').select('id').eq('provider', provider).eq('provider_order_id', providerOrderId).maybeSingle()
      orderId = order?.id || null
    }

    await admin.from('payment_webhook_events').insert({
      provider, provider_event_id: providerEventId, event_type: eventType || 'unknown',
      order_id: orderId, raw_payload: parsed, processed_at: new Date().toISOString(),
    })

    if (orderId && outcome === 'success') await admin.rpc('record_payment_success', { p_order_id: orderId })
    else if (orderId && outcome === 'failure') await admin.rpc('record_payment_failure', { p_order_id: orderId })
    // outcome === 'ignore' (e.g. an event type this app doesn't act on) still returns 200 —
    // acknowledging receipt is correct even for events with no side effect here.

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error(`${provider} webhook error:`, err)
    // Still return 200: a parse/processing bug on our side shouldn't
    // make the gateway retry forever. The raw payload logging above
    // (when it succeeds) plus this log line are the way to debug it —
    // returning 4xx/5xx here would just cause exponential retries of a
    // webhook that will keep failing the same way.
    return new Response('logged', { status: 200 })
  }
})

// Same lookup as create-payment-order's getSecret() — table first
// (STEP132, set from Settings -> Payment Gateway Setup), env fallback.
async function getSecret(admin: ReturnType<typeof createClient>, provider: string, keyName: string, envFallback: string): Promise<string> {
  const { data } = await admin.from('payment_gateway_secrets').select('value').eq('provider', provider).eq('key_name', keyName).maybeSingle()
  const value = data?.value || Deno.env.get(envFallback)
  if (!value) throw new Error(`Missing ${provider} ${keyName} — set it from Settings -> Payment Gateway Setup, or run: supabase secrets set ${envFallback}=...`)
  return value
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacBase64(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

// Stripe's scheme: header is "t=<timestamp>,v1=<signature>[,v0=...]".
// The signed payload is "<timestamp>.<raw body>", not the raw body alone.
async function verifyStripeSignature(header: string, rawBody: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  if (!parts.t || !parts.v1) return false
  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`)
  return expected === parts.v1
}
