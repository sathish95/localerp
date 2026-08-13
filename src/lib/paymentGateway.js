import { supabase } from './supabase'

// Platform-wide gateway catalog (STEP129) — permissive SELECT for every
// signed-in user, same posture as billing_plans, so an org's own
// Settings -> Billing can filter its "Pay with ..." buttons down to
// whichever gateways are both platform-enabled and (if the org has a
// per-org allow-list) on that org's allow-list. This is a UI
// convenience only — create-payment-order re-checks both conditions
// server-side before ever creating a charge, since that's the only
// place enforcement actually matters.
export async function listPaymentProviders() {
  const { data, error } = await supabase.from('payment_providers').select('*')
  if (error) throw error
  return data || []
}

// Thin client for the two payment Edge Functions (STEP128) — never
// calls a gateway directly from the browser (that would need each
// provider's SECRET key in frontend code). create-payment-order does
// the real gateway call server-side and hands back only what the
// client-side checkout widget needs to collect payment.
export async function createPaymentOrder({ provider, planKey, bundleKeys, billingCycle }) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ provider, plan_key: planKey || null, bundle_keys: bundleKeys || [], billing_cycle: billingCycle || 'monthly' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create payment order')
  return data
}

export async function cancelSubscription(immediately, reason) {
  const { error } = await supabase.rpc('cancel_subscription', { p_immediately: immediately, p_reason: reason || null })
  if (error) throw error
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

// Launches whichever provider's checkout widget the order was created
// for. The in-widget "success" callback is UX only (shows a spinner
// while confirming) — the webhook (server-to-server, verified by
// signature) is the only thing that actually extends the subscription
// period, never this client-side callback alone.
export async function launchCheckout(order, { orgName, email, onSubmitted } = {}) {
  // A 100%-discount promoter code can bring the order to exactly ₹0 —
  // create-payment-order completes those directly server-side and
  // returns `free: true` with no gateway fields at all, so there's
  // nothing here to launch.
  if (order.free) { onSubmitted?.(); return }
  if (order.provider === 'stripe') {
    window.location.href = order.checkout_url
    return
  }
  if (order.provider === 'razorpay') {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js')
    const rzp = new window.Razorpay({
      key: order.razorpay_key_id,
      amount: Math.round(order.amount * 100),
      currency: order.currency,
      order_id: order.provider_order_id,
      name: orgName || 'Subscription Renewal',
      prefill: { email },
      handler: () => onSubmitted?.(),
    })
    rzp.open()
    return
  }
  if (order.provider === 'cashfree') {
    await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js')
    // 'sandbox' while testing — switch to 'production' only once this
    // has actually been verified against Cashfree's real checkout.
    const cashfree = window.Cashfree({ mode: 'sandbox' })
    cashfree.checkout({ paymentSessionId: order.payment_session_id, redirectTarget: '_self' })
  }
}
