-- ============================================================
-- STEP39: Warranty Management — age-based depreciation schedule.
-- Run AFTER STEP37 (warranty_policies must exist).
--
-- A device's warranty claim value is no longer always "full standard
-- cost" — it now depreciates with the device's age at the time of the
-- claim, per a configurable tiered schedule attached to the policy
-- (e.g. 0-3mo -> 100%, 3-6mo -> 75%, 6-9mo -> 50%, 9-12mo -> 25%).
-- A policy with no tiers configured falls back to 100% at any age
-- (the original flat-standard_cost behaviour), so this is additive
-- and backward-compatible with existing policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS warranty_depreciation_tiers (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  warranty_policy_id UUID        NOT NULL,             -- soft ref -> warranty_policies.id
  min_age_months     NUMERIC(6,2) NOT NULL DEFAULT 0,
  max_age_months     NUMERIC(6,2),                       -- NULL = no upper bound (open-ended final tier)
  claim_percentage   NUMERIC(5,2) NOT NULL DEFAULT 100,   -- % of standard_cost payable as the claim value in this age band
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_depreciation_tiers_policy_idx ON warranty_depreciation_tiers(warranty_policy_id);

ALTER TABLE warranty_depreciation_tiers ENABLE ROW LEVEL SECURITY;
-- Permissive, same as warranty_policies — this is policy configuration
-- metadata, not a booked $ figure; edit access is gated client-side to
-- finance/admin/ceo in WarrantyPage.jsx same as the rest of Policies.
-- DROP POLICY IF EXISTS first so this script is safely re-runnable — the
-- table itself is already idempotent via CREATE TABLE IF NOT EXISTS above,
-- but CREATE POLICY has no IF NOT EXISTS form in Postgres.
DROP POLICY IF EXISTS warranty_depreciation_tiers_all ON warranty_depreciation_tiers;
CREATE POLICY warranty_depreciation_tiers_all ON warranty_depreciation_tiers FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_depreciation_tiers TO authenticated;

NOTIFY pgrst, 'reload schema';
