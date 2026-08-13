-- ============================================================
-- STEP131: Module/plan pricing admin UI support + per-user module
-- allocation for utilization-based bill estimation.
--
-- 1. billing_bundles had SELECT-only RLS since STEP124 (same gap
--    payment_providers had before STEP129) — nothing could ever edit a
--    module's price from the app. Adds the missing super-admin write
--    policy, same shape as billing_plans_write (STEP107).
--
-- 2. organization_module_allocations — NEW. Module/bundle activation
--    (STEP124) is org-wide: once a bundle is active, its price applies
--    against the org's total seat count regardless of who actually uses
--    that module. This adds an explicit "which specific members use
--    this module" list per org+bundle, and a companion RPC that prices
--    against THAT count instead — an additional, informational
--    utilization estimate. It does NOT change org_bundle_monthly_total()
--    or anything create-payment-order actually charges — those still
--    price by total seats, unchanged, since altering a real charge
--    calculation is a bigger decision than "show an estimate" and
--    wasn't asked for. Allocation is managed by the org's own admin/ceo
--    (it's "who on my team uses this," an operational call, not a
--    billing-approval one — unlike bundle activation itself) or a
--    platform super admin from the org detail console.
-- ============================================================

DROP POLICY IF EXISTS billing_bundles_write ON billing_bundles;
CREATE POLICY billing_bundles_write ON billing_bundles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
);
GRANT INSERT, UPDATE, DELETE ON public.billing_bundles TO authenticated;

CREATE TABLE IF NOT EXISTS organization_module_allocations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bundle_key      TEXT        NOT NULL REFERENCES billing_bundles(key),
  user_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  allocated_by    UUID        REFERENCES profiles(id),
  allocated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, bundle_key, user_id)
);
CREATE INDEX IF NOT EXISTS organization_module_allocations_org_idx ON organization_module_allocations(organization_id);

ALTER TABLE organization_module_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_module_allocations_select ON organization_module_allocations;
DROP POLICY IF EXISTS organization_module_allocations_write  ON organization_module_allocations;
CREATE POLICY organization_module_allocations_select ON organization_module_allocations FOR SELECT USING (
  is_platform_super_admin() OR organization_id = current_org_id()
);
CREATE POLICY organization_module_allocations_write ON organization_module_allocations FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
GRANT SELECT, INSERT, DELETE ON public.organization_module_allocations TO authenticated;

-- ── org_bundle_utilization_estimate() — per-active-bundle breakdown:
-- how many of the org's members are actually allocated to each module,
-- and what that module alone would cost at that count. Informational
-- only (see header) — SECURITY DEFINER because a platform super admin
-- needs to run this for orgs they don't belong to. ──
CREATE OR REPLACE FUNCTION org_bundle_utilization_estimate(p_org_id UUID)
RETURNS TABLE (
  bundle_key TEXT, bundle_name TEXT,
  price_per_seat_monthly NUMERIC, price_per_seat_yearly NUMERIC,
  allocated_count BIGINT, estimated_monthly NUMERIC, estimated_yearly NUMERIC
) AS $$
BEGIN
  IF NOT (is_platform_super_admin() OR p_org_id = current_org_id()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT bb.key, bb.name, bb.price_per_seat_monthly, bb.price_per_seat_yearly,
      (SELECT count(*) FROM organization_module_allocations oma WHERE oma.organization_id = p_org_id AND oma.bundle_key = bb.key),
      bb.price_per_seat_monthly * (SELECT count(*) FROM organization_module_allocations oma WHERE oma.organization_id = p_org_id AND oma.bundle_key = bb.key),
      bb.price_per_seat_yearly * (SELECT count(*) FROM organization_module_allocations oma WHERE oma.organization_id = p_org_id AND oma.bundle_key = bb.key)
    FROM organization_bundle_subscriptions obs
    JOIN billing_bundles bb ON bb.key = obs.bundle_key
    WHERE obs.organization_id = p_org_id AND obs.status = 'active'
    ORDER BY bb.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION org_bundle_utilization_estimate(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
