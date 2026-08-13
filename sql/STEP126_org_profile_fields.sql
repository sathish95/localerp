-- ============================================================
-- STEP126: Organization profile fields for the onboarding wizard's
-- Step 1 (industry/country/timezone/currency/address/logo — none of
-- these existed on `organizations` before; name/slug already did).
--
-- No new tracking table for onboarding progress: every wizard step's
-- "done" state is DERIVED live from data that already exists (org
-- profile fields set, a department exists, a second admin/hr/finance
-- user exists, more than one profile exists, someone has a manager set,
-- a performance cycle or award exists) — see src/lib/onboarding.js.
-- Avoids a second source of truth that could drift from reality, same
-- reasoning as this app's other self-healing/derived-state screens
-- (syncModulesFromConfig, computed dashboards) rather than a stateful
-- checklist that has to be kept in sync by hand.
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country  TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address  TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo     TEXT;

-- STEP89's organizations_write policy is deliberately super-admin-only —
-- "an org's own admin/ceo must NOT be able to rename/create/deactivate
-- organizations, including their own." That boundary stays exactly as
-- is: slug, is_active, plan_key, billing_status, seat_limit_override
-- remain untouchable by an org's own admin. This RPC is narrowly scoped
-- to the handful of branding/profile fields an org owner filling out
-- their own onboarding wizard should reasonably control, matching this
-- codebase's existing pattern of a narrow SECURITY DEFINER function
-- rather than loosening the table's RLS (same shape as
-- super_admin_set_org_billing() being the only writer of billing
-- columns — this is that same idea, scoped to the org's own admin
-- instead of a platform super admin).
CREATE OR REPLACE FUNCTION update_org_profile(
  p_name     TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country  TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_address  TEXT DEFAULT NULL,
  p_logo     TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can update the organization profile';
  END IF;

  UPDATE organizations SET
    name     = COALESCE(p_name, name),
    industry = COALESCE(p_industry, industry),
    country  = COALESCE(p_country, country),
    timezone = COALESCE(p_timezone, timezone),
    currency = COALESCE(p_currency, currency),
    address  = COALESCE(p_address, address),
    logo     = COALESCE(p_logo, logo)
  WHERE id = current_org_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_org_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
