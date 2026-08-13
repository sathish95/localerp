// Supabase Edge Function: create-payment-order
//
// Creates a payment_orders row (STEP128) with a SERVER-computed amount,
// then creates the matching order/session with whichever gateway the
// caller picked (Razorpay, Stripe, or Cashfree). Amount is never taken
// from the client — it's derived from billing_plans + billing_bundles
// pricing here, so an org admin can't tamper with what they get charged
// for their own subscription.
//
// NOT TESTED against any live gateway — written to each provider's
// public API docs, since no sandbox credentials were available while
// building this. Test against each provider's TEST-mode keys before
// going anywhere near production credentials.
//
// Deploy:
//   supabase functions deploy create-payment-order
//
// Credentials (STEP132): read from the payment_gateway_secrets table
// FIRST (set from Settings -> Payment Gateway Setup, super admin only),
// falling back to an env var of the same name if nothing's set there —
// so `supabase secrets set RAZORPAY_KEY_ID=...` etc. still works if you
// prefer the CLI over the UI. See getSecret() below for the exact
// provider/key_name pairs each gateway needs.
//
// Request body: { provider: 'razorpay'|'stripe'|'cashfree', plan_key, bundle_keys: string[], billing_cycle: 'monthly'|'yearly' }
// Response: { order_id, provider, provider_order_id, amount, currency, ...provider-specific fields the client SDK needs }

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization') || ''

    // Resolve the caller via THEIR OWN JWT (RLS-respecting client) —
    // never trust a client-supplied organization_id. This mirrors
    // request_billing_upgrade()'s own "resolve org from the session, not
    // the payload" rule, just enforced here in Deno instead of plpgsql.
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return errorRes('Not authenticated', 401)

    const { data: profile, error: profileErr } = await callerClient
      .from('profiles').select('id, organization_id, role').eq('id', userData.user.id).single()
    if (profileErr || !profile) return errorRes('Profile not found', 401)
    if (!['admin', 'ceo'].includes(profile.role)) return errorRes('Only an org admin or CEO can start a payment', 403)

    const { provider, plan_key, bundle_keys = [], billing_cycle = 'monthly' } = await req.json()
    if (!['razorpay', 'stripe', 'cashfree'].includes(provider)) return errorRes('Unknown provider')
    if (!['monthly', 'yearly'].includes(billing_cycle)) return errorRes('Invalid billing_cycle')

    // Service-role client for everything past this point — pricing
    // lookups, the order insert, and the gateway call itself all need
    // privileges the caller's own RLS-scoped client doesn't have.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── Provider gating (STEP129) — enforced here, not just in the UI,
    // since this is the only place that actually creates a charge. ──
    const { data: providerRow } = await admin.from('payment_providers').select('is_active').eq('key', provider).maybeSingle()
    if (!providerRow?.is_active) return errorRes('This payment method is currently disabled', 403)

    const { data: orgRow } = await admin.from('organizations').select('allowed_payment_providers, referred_by_vendor_id').eq('id', profile.organization_id).single()
    if (orgRow?.allowed_payment_providers && !orgRow.allowed_payment_providers.includes(provider)) {
      return errorRes('Your organization is not permitted to use this payment method', 403)
    }

    // Seat count is needed regardless of whether any per-seat bundle was
    // picked — the promoter discount below (STEP135) is also gated on it.
    const { count: seatCountRaw } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', profile.organization_id).eq('is_active', true)
    const seatCount = seatCountRaw || 1

    // ── Promoter seat-pool discount (STEP135) — shared pool across every
    // org this vendor referred, consumed by their CURRENT live headcounts
    // (never a stored counter). Only the seats within whatever's left of
    // the pool get the discount; the rest of this org's own seats — and
    // the flat plan price, all-or-nothing since it isn't seat-denominated
    // — bill at full price once the pool has nothing left for this org. ──
    let discountPercent = 0
    let discountedSeats = 0
    let promoterVendorId: string | null = null
    if (orgRow?.referred_by_vendor_id) {
      const { data: vendor } = await admin.from('referral_vendors').select('id, is_active, is_promoter, promoter_seat_allocation, promoter_discount_percent').eq('id', orgRow.referred_by_vendor_id).maybeSingle()
      if (vendor?.is_active && vendor.is_promoter && vendor.promoter_discount_percent > 0) {
        const { data: seatsUsedByOthers } = await admin.rpc('_promoter_seats_used', { p_vendor_id: vendor.id, p_exclude_org_id: profile.organization_id })
        const remainingPool = vendor.promoter_seat_allocation == null ? Infinity : Math.max(0, vendor.promoter_seat_allocation - (Number(seatsUsedByOthers) || 0))
        discountedSeats = Math.min(seatCount, remainingPool)
        if (discountedSeats > 0) {
          discountPercent = Number(vendor.promoter_discount_percent)
          promoterVendorId = vendor.id
        }
      }
    }

    // ── Compute the authoritative amount ──
    let amount = 0
    let discountAmount = 0
    if (plan_key) {
      const { data: plan } = await admin.from('billing_plans').select('price_monthly, price_yearly').eq('key', plan_key).single()
      if (!plan) return errorRes('Unknown plan')
      const planPrice = Number(billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly) || 0
      // Flat price, not per-seat — discount applies in full or not at all,
      // gated on whether ANY pool capacity remains for this org.
      const planDiscount = discountedSeats > 0 ? planPrice * (discountPercent / 100) : 0
      amount += planPrice - planDiscount
      discountAmount += planDiscount
    }
    if (Array.isArray(bundle_keys) && bundle_keys.length > 0) {
      const { data: bundles } = await admin.from('billing_bundles').select('key, price_per_seat_monthly, price_per_seat_yearly').in('key', bundle_keys)
      const fullPriceSeats = Math.max(0, seatCount - discountedSeats)
      for (const b of bundles || []) {
        const perSeat = Number(billing_cycle === 'yearly' ? b.price_per_seat_yearly : b.price_per_seat_monthly) || 0
        const bundleDiscount = perSeat * discountedSeats * (discountPercent / 100)
        amount += perSeat * fullPriceSeats + perSeat * discountedSeats - bundleDiscount
        discountAmount += bundleDiscount
      }
    }
    const somethingSelected = !!plan_key || (Array.isArray(bundle_keys) && bundle_keys.length > 0)
    if (!somethingSelected) return errorRes('Nothing to charge — select a plan or at least one module add-on')

    const { data: order, error: orderErr } = await admin.from('payment_orders').insert({
      organization_id: profile.organization_id, provider, plan_key: plan_key || null, bundle_keys,
      billing_cycle, amount, currency: 'INR', status: 'created', created_by: profile.id,
      discount_amount: discountAmount, promoter_vendor_id: promoterVendorId,
    }).select().single()
    if (orderErr) throw orderErr

    // A 100%-discount promoter code can legitimately bring this to
    // exactly zero — that's a real free order, not "nothing selected".
    // Complete it directly via the same RPC the webhook uses (this
    // function's own service-role client satisfies record_payment_
    // success's auth.role() = 'service_role' check) rather than asking
    // any gateway to process a ₹0 charge, which none of them accept.
    if (amount <= 0) {
      const { error: rpcErr } = await admin.rpc('record_payment_success', { p_order_id: order.id })
      if (rpcErr) throw rpcErr
      return new Response(JSON.stringify({ order_id: order.id, provider, amount: 0, currency: 'INR', free: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    let providerFields: Record<string, unknown> = {}
    if (provider === 'razorpay') providerFields = await createRazorpayOrder(admin, order)
    else if (provider === 'stripe') providerFields = await createStripeSession(admin, order)
    else providerFields = await createCashfreeOrder(admin, order, userData.user.email || '')

    await admin.from('payment_orders').update({ provider_order_id: providerFields.provider_order_id as string }).eq('id', order.id)

    return new Response(JSON.stringify({ order_id: order.id, provider, amount, currency: 'INR', ...providerFields }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-payment-order error:', err)
    return errorRes((err as Error).message || 'Internal error', 500)
  }
})

// Reads a gateway credential from payment_gateway_secrets (STEP132)
// first — set from the super-admin "Payment Gateway Setup" screen — and
// falls back to an identically-named env var so `supabase secrets set`
// still works for anyone who prefers the CLI. `admin` already bypasses
// RLS (service role), so this reads the table directly; the table has
// no SELECT policy for any client role, only this server-side path.
async function getSecret(admin: ReturnType<typeof createClient>, provider: string, keyName: string, envFallback: string): Promise<string> {
  const { data } = await admin.from('payment_gateway_secrets').select('value').eq('provider', provider).eq('key_name', keyName).maybeSingle()
  const value = data?.value || Deno.env.get(envFallback)
  if (!value) throw new Error(`Missing ${provider} ${keyName} — set it from Settings -> Payment Gateway Setup, or run: supabase secrets set ${envFallback}=...`)
  return value
}

// ── Razorpay: https://razorpay.com/docs/api/orders/create/ ──
async function createRazorpayOrder(admin: ReturnType<typeof createClient>, order: { id: string; amount: number }) {
  const keyId = await getSecret(admin, 'razorpay', 'key_id', 'RAZORPAY_KEY_ID')
  const keySecret = await getSecret(admin, 'razorpay', 'key_secret', 'RAZORPAY_KEY_SECRET')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(`${keyId}:${keySecret}`)}`,
    },
    body: JSON.stringify({
      amount: Math.round(order.amount * 100), // Razorpay wants paise, not rupees
      currency: 'INR',
      receipt: order.id,
    }),
  })
  if (!res.ok) throw new Error(`Razorpay order creation failed: ${await res.text()}`)
  const data = await res.json()
  return { provider_order_id: data.id, razorpay_key_id: keyId }
}

// ── Stripe: https://stripe.com/docs/api/checkout/sessions/create ──
async function createStripeSession(admin: ReturnType<typeof createClient>, order: { id: string; amount: number }) {
  const secretKey = await getSecret(admin, 'stripe', 'secret_key', 'STRIPE_SECRET_KEY')
  const { data: appUrlRow } = await admin.from('payment_gateway_secrets').select('value').eq('provider', 'general').eq('key_name', 'app_url').maybeSingle()
  const appUrl = appUrlRow?.value || Deno.env.get('APP_URL')
  const successUrl = appUrl ? `${appUrl}/settings?payment=success` : 'https://example.com/settings?payment=success'
  const cancelUrl = appUrl ? `${appUrl}/settings?payment=cancelled` : 'https://example.com/settings?payment=cancelled'

  const body = new URLSearchParams({
    'mode': 'payment',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'client_reference_id': order.id,
    'line_items[0][price_data][currency]': 'inr',
    'line_items[0][price_data][product_data][name]': 'Subscription renewal',
    'line_items[0][price_data][unit_amount]': String(Math.round(order.amount * 100)), // Stripe wants the smallest currency unit
    'line_items[0][quantity]': '1',
  })

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Stripe session creation failed: ${await res.text()}`)
  const data = await res.json()
  return { provider_order_id: data.id, checkout_url: data.url }
}

// ── Cashfree: https://docs.cashfree.com/reference/pgcreateorder ──
async function createCashfreeOrder(admin: ReturnType<typeof createClient>, order: { id: string; amount: number }, customerEmail: string) {
  const clientId = await getSecret(admin, 'cashfree', 'client_id', 'CASHFREE_CLIENT_ID')
  const clientSecret = await getSecret(admin, 'cashfree', 'client_secret', 'CASHFREE_CLIENT_SECRET')
  const { data: envRow } = await admin.from('payment_gateway_secrets').select('value').eq('provider', 'cashfree').eq('key_name', 'env').maybeSingle()
  const cashfreeEnv = envRow?.value || Deno.env.get('CASHFREE_ENV')
  const env = cashfreeEnv === 'PROD' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg'

  const res = await fetch(`${env}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
      'x-api-version': '2023-08-01',
    },
    body: JSON.stringify({
      order_id: order.id,
      order_amount: order.amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: order.id,
        customer_email: customerEmail || 'billing@example.com',
        customer_phone: '9999999999', // Cashfree requires a phone number — replace with the org's real contact number if collected elsewhere
      },
    }),
  })
  if (!res.ok) throw new Error(`Cashfree order creation failed: ${await res.text()}`)
  const data = await res.json()
  return { provider_order_id: data.order_id ?? data.cf_order_id, payment_session_id: data.payment_session_id }
}

function errorRes(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
