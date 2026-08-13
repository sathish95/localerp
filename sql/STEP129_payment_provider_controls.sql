-- ============================================================
-- STEP129: Payment provider admin controls.
--
-- STEP128 created `payment_providers` (razorpay/stripe/cashfree, each
-- with an `is_active` flag) but only ever gave it a SELECT policy — RLS
-- was enabled with no write policy at all, so nothing (not even a
-- platform super admin) could ever actually toggle a gateway on/off.
-- This closes that gap, and adds a per-org allow-list so a super admin
-- can restrict a given organization to a subset of the platform-wide
-- active gateways (e.g. an org that only has a Razorpay settlement
-- account shouldn't see Stripe/Cashfree buttons at all).
-- ============================================================

DROP POLICY IF EXISTS payment_providers_write ON payment_providers;
CREATE POLICY payment_providers_write ON payment_providers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
);
GRANT UPDATE ON public.payment_providers TO authenticated;

-- NULL = unrestricted (every platform-wide-active provider is available
-- to this org) — same "NULL means no override" convention already used
-- by seat_limit_override (STEP107) and allowed_payment_providers's
-- sibling columns. organizations_write (STEP89) is already
-- super-admin-only, so a plain table UPDATE from a super admin already
-- satisfies RLS for this new column — no RPC needed, same posture as
-- setOrganizationActive().
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_payment_providers TEXT[];

-- super_admin_list_organizations() — add allowed_payment_providers so
-- the console's Billing modal can prefill the checkbox state without a
-- second round-trip. DROP first: CREATE OR REPLACE cannot change a
-- function's OUT-parameter row type, only its body (same issue hit in
-- STEP107 and STEP108, same fix). ──
DROP FUNCTION IF EXISTS super_admin_list_organizations();
CREATE OR REPLACE FUNCTION super_admin_list_organizations()
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ,
  member_count BIGINT, enabled_module_count BIGINT,
  plan_key TEXT, billing_status TEXT, trial_ends_at TIMESTAMPTZ, seat_limit INT,
  deleted_at TIMESTAMPTZ, allowed_payment_providers TEXT[]
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.is_active, o.created_at,
      (SELECT count(*) FROM profiles p WHERE p.organization_id = o.id),
      (SELECT count(*) FROM modules m WHERE m.organization_id = o.id AND m.enabled = true),
      o.plan_key, o.billing_status, o.trial_ends_at, org_seat_limit(o.id),
      o.deleted_at, o.allowed_payment_providers
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_organizations() TO authenticated;

NOTIFY pgrst, 'reload schema';
