-- ============================================================
-- STEP128: Multi-gateway payment schema + automated billing lifecycle.
--
-- Supports Razorpay, Stripe, and Cashfree side by side (the user has
-- live accounts with all three, not one) rather than hard-coding a
-- single provider. The gateway-specific work (order creation, webhook
-- signature verification) lives in two Edge Functions —
-- supabase/functions/create-payment-order and
-- supabase/functions/payment-webhook — because this app has no
-- server-side code otherwise (pure SPA + Supabase). Those functions
-- need real sandbox credentials from each provider to actually test;
-- nothing here has been exercised against a live gateway.
--
-- Design choice: models ONE-TIME renewal orders, not each gateway's own
-- native "Subscription" object. Razorpay/Stripe/Cashfree each model
-- recurring subscriptions completely differently (different object
-- graphs, different webhook event sets) — modeling our own renewal
-- cycle (organizations.current_period_end) and asking each gateway only
-- to "collect one payment for this amount" is the same shape across all
-- three, and is what STEP107's existing plan/seat model already assumes
-- (a flat price per billing cycle, not per-transaction metering).
-- Upgrading to native recurring subscriptions per-provider is a later,
-- separate migration once one gateway is confirmed as primary.
--
-- Billing lifecycle thresholds below (3 days to grace period, 10 days
-- to suspension) are defaults, not something the spec pinned down —
-- adjust the INTERVAL literals in run_billing_lifecycle_tick() freely.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_providers (
  key       TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO payment_providers (key, name) VALUES
  ('razorpay', 'Razorpay'), ('stripe', 'Stripe'), ('cashfree', 'Cashfree')
ON CONFLICT (key) DO NOTHING;

-- organizations: renewal period tracking. plan_key/billing_status
-- already exist (STEP107) — billing_status's CHECK is widened to add
-- the two new lifecycle states the spec calls for.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_provider TEXT REFERENCES payment_providers(key);

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_billing_status_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_billing_status_check
  CHECK (billing_status IN ('trialing','active','past_due','grace_period','suspended','canceled'));

CREATE TABLE IF NOT EXISTS payment_orders (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider          TEXT        NOT NULL REFERENCES payment_providers(key),
  provider_order_id TEXT,                              -- set once the gateway confirms order creation
  plan_key          TEXT        REFERENCES billing_plans(key),
  bundle_keys       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  billing_cycle     TEXT        NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  amount            NUMERIC(10,2) NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'INR',
  status            TEXT        NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','expired')),
  created_by        UUID        REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  paid_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payment_orders_org_idx ON payment_orders(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_order_idx ON payment_orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

-- Raw webhook audit trail. provider_event_id + provider is unique so a
-- gateway's at-least-once webhook retries (all three providers do this)
-- are idempotent — payment-webhook checks for an existing row before
-- applying any side effect.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  provider           TEXT        NOT NULL REFERENCES payment_providers(key),
  provider_event_id  TEXT,
  event_type         TEXT        NOT NULL,
  order_id           UUID        REFERENCES payment_orders(id) ON DELETE SET NULL,
  raw_payload        JSONB       NOT NULL,
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_dedupe_idx ON payment_webhook_events(provider, provider_event_id) WHERE provider_event_id IS NOT NULL;

ALTER TABLE payment_providers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_providers_select ON payment_providers;
CREATE POLICY payment_providers_select ON payment_providers FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.payment_providers TO authenticated;

-- Orders: an org's own admin/ceo can only ever READ their own org's
-- orders. Deliberately no INSERT policy for `authenticated` at all —
-- amount is what actually gets charged, so only the create-payment-
-- order Edge Function (service role, which computes the amount itself
-- from billing_plans/bundle pricing) may create one. A client-writable
-- amount column would let an org admin tamper with what they get
-- charged for their own subscription.
DROP POLICY IF EXISTS payment_orders_select ON payment_orders;
CREATE POLICY payment_orders_select ON payment_orders FOR SELECT USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
GRANT SELECT ON public.payment_orders TO authenticated;

-- Webhook events are platform-internal — only a super admin (debugging
-- a payment issue) or the service role (the Edge Function) ever reads/
-- writes these; no org-level access at all.
DROP POLICY IF EXISTS payment_webhook_events_select ON payment_webhook_events;
CREATE POLICY payment_webhook_events_select ON payment_webhook_events FOR SELECT USING (is_platform_super_admin());
GRANT SELECT ON public.payment_webhook_events TO authenticated;

-- ── run_billing_lifecycle_tick() — the automated state machine.
-- Idempotent and safe to call as often as you like (every transition
-- is a WHERE-guarded UPDATE, not an unconditional one). Intended to run
-- on a schedule — see the pg_cron block below; if pg_cron isn't
-- available on your Supabase plan/tier, call this from a scheduled Edge
-- Function or an external cron hitting one instead. ──
CREATE OR REPLACE FUNCTION run_billing_lifecycle_tick() RETURNS VOID AS $$
BEGIN
  -- active, period ended, no successful renewal yet -> past_due
  UPDATE organizations SET billing_status = 'past_due'
  WHERE billing_status = 'active' AND current_period_end IS NOT NULL
    AND current_period_end < now() AND deleted_at IS NULL;

  -- past_due for 3+ days -> grace_period (still fully accessible, just flagged)
  UPDATE organizations SET billing_status = 'grace_period'
  WHERE billing_status = 'past_due' AND current_period_end < now() - INTERVAL '3 days' AND deleted_at IS NULL;

  -- grace_period for 10+ days total -> suspended. Reuses the EXISTING
  -- is_active flag (STEP108's OrgSuspendedPage already locks out any
  -- non-super-admin user of an org with is_active = false) — no new
  -- lockout mechanism needed, this is that same one.
  UPDATE organizations SET billing_status = 'suspended', is_active = false
  WHERE billing_status = 'grace_period' AND current_period_end < now() - INTERVAL '10 days' AND deleted_at IS NULL;

  -- CANCEL_AT_PERIOD_END (cancel_subscription() below sets billing_status
  -- = 'canceled' immediately but deliberately leaves is_active alone so
  -- access continues until the period they already paid for actually
  -- ends) — this is what finally locks them out at that point. Without
  -- this, a canceled-but-not-yet-expired org would stay accessible
  -- forever, since the 'active' rule above no longer matches it once
  -- its status has already changed to 'canceled'.
  UPDATE organizations SET is_active = false
  WHERE billing_status = 'canceled' AND current_period_end IS NOT NULL
    AND current_period_end < now() AND is_active = true AND deleted_at IS NULL;

  -- Notify each affected org's admins/ceo at the moment of transition
  -- (billing_status just changed on this tick, not on every future tick)
  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'billing_past_due', 'Payment overdue',
    'Your subscription payment is overdue. Please renew to avoid service interruption.', '/settings'
  FROM organizations o JOIN profiles p ON p.organization_id = o.id AND p.role IN ('admin','ceo')
  WHERE o.billing_status = 'past_due' AND o.current_period_end < now() AND o.current_period_end >= now() - INTERVAL '1 day' AND o.deleted_at IS NULL;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'billing_grace_period', 'Final notice: renew to avoid suspension',
    'Your organization is in its grace period. Renew now to avoid suspension.', '/settings'
  FROM organizations o JOIN profiles p ON p.organization_id = o.id AND p.role IN ('admin','ceo')
  WHERE o.billing_status = 'grace_period' AND o.current_period_end < now() - INTERVAL '3 days' AND o.current_period_end >= now() - INTERVAL '4 days' AND o.deleted_at IS NULL;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'billing_suspended', 'Organization suspended',
    'Your organization has been suspended due to non-payment. Renew your subscription to reactivate.', '/settings'
  FROM organizations o JOIN profiles p ON p.organization_id = o.id AND p.role IN ('admin','ceo')
  WHERE o.billing_status = 'suspended' AND o.current_period_end < now() - INTERVAL '10 days' AND o.current_period_end >= now() - INTERVAL '11 days' AND o.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attempt to schedule the tick daily via pg_cron. Wrapped so a Supabase
-- plan/tier without pg_cron enabled doesn't fail this whole migration —
-- if it's skipped, run_billing_lifecycle_tick() still exists and can be
-- called from a scheduled Edge Function instead.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('billing-lifecycle-tick', '0 2 * * *', 'SELECT run_billing_lifecycle_tick();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available on this project — schedule run_billing_lifecycle_tick() externally instead (e.g. a scheduled Edge Function). Error was: %', SQLERRM;
END $$;

-- ── record_payment_success() — called by the payment-webhook Edge
-- Function (via service role) once a gateway confirms payment. Marks
-- the order paid, extends the org's period by one billing cycle from
-- whichever is later (now, or the current period end — so renewing
-- early doesn't forfeit remaining paid time), reactivates a
-- suspended org, and applies the plan/bundle changes the order was for. ──
CREATE OR REPLACE FUNCTION record_payment_success(p_order_id UUID) RETURNS VOID AS $$
DECLARE
  v_order payment_orders%ROWTYPE;
  v_period_start TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM payment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment order';
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN; -- already processed — webhook idempotency guard at the caller already covers this too
  END IF;

  UPDATE payment_orders SET status = 'paid', paid_at = now() WHERE id = p_order_id;

  SELECT GREATEST(now(), COALESCE(current_period_end, now())) INTO v_period_start
  FROM organizations WHERE id = v_order.organization_id;

  UPDATE organizations SET
    billing_status = 'active',
    is_active = true,
    plan_key = COALESCE(v_order.plan_key, plan_key),
    payment_provider = v_order.provider,
    current_period_end = v_period_start + (CASE WHEN v_order.billing_cycle = 'yearly' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)
  WHERE id = v_order.organization_id;

  IF jsonb_array_length(v_order.bundle_keys) > 0 THEN
    INSERT INTO organization_bundle_subscriptions (organization_id, bundle_key, status, activated_at)
    SELECT v_order.organization_id, b, 'active', now()
    FROM jsonb_array_elements_text(v_order.bundle_keys) b
    ON CONFLICT (organization_id, bundle_key) DO UPDATE SET status = 'active', activated_at = now(), deactivated_at = NULL;
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'payment_success', 'Payment received', 'Your subscription has been renewed. Thank you!', '/settings'
  FROM profiles p WHERE p.organization_id = v_order.organization_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION record_payment_failure(p_order_id UUID) RETURNS VOID AS $$
DECLARE v_order payment_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM payment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown payment order'; END IF;
  UPDATE payment_orders SET status = 'failed' WHERE id = p_order_id;
  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'payment_failed', 'Payment failed', 'Your renewal payment did not go through. Please try again or use a different payment method.', '/settings'
  FROM profiles p WHERE p.organization_id = v_order.organization_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Cancellation — mirrors STEP107's request/approval-free self-serve
-- posture for THIS action specifically (unlike a plan change, a
-- cancellation doesn't need a super admin's approval to take effect;
-- it's the org giving something up, not asking for more). ──
CREATE OR REPLACE FUNCTION cancel_subscription(p_immediately BOOLEAN DEFAULT false, p_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_org_id UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can cancel the subscription';
  END IF;

  IF p_immediately THEN
    UPDATE organizations SET billing_status = 'canceled', is_active = false WHERE id = v_org_id;
  ELSE
    -- CANCEL_AT_PERIOD_END: stays fully active/usable until
    -- current_period_end, then the lifecycle tick's normal past_due ->
    -- grace_period -> suspended chain would fire since no renewal
    -- payment will arrive — except we want it to go straight to
    -- canceled, not suspended, since this was requested, not a failure.
    -- Simplest correct model: flip billing_status to 'canceled' now but
    -- leave is_active untouched until current_period_end actually
    -- passes — ModuleGate/OrgSuspendedPage only ever check is_active,
    -- not billing_status, so access is genuinely unaffected until then.
    UPDATE organizations SET billing_status = 'canceled' WHERE id = v_org_id;
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'subscription_cancelled',
    CASE WHEN p_immediately THEN 'Subscription cancelled' ELSE 'Subscription set to cancel at period end' END,
    COALESCE(p_reason, 'No reason given'), '/settings'
  FROM profiles p WHERE p.organization_id = v_org_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION cancel_subscription(BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
