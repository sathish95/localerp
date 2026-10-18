-- ============================================================
-- STEP181: Industry-Adaptive Platform — Phase 2 onboarding flag.
--
-- Adds workspace_profiles.needs_onboarding, additive, default false.
-- Existing rows (every org seeded by STEP180) are explicitly backfilled
-- to false even though that's already the column default, for safety.
--
-- The precise, non-heuristic hook: handle_new_user() (STEP133's version,
-- rewritten again here in full per this repo's established convention —
-- same body verbatim, ONE addition) already has an exact `org_mode =
-- 'create'` branch that fires ONLY when a brand-new organization is
-- created at signup — never for 'join' (invite code, joining an
-- existing already-configured org) and never for the anonymous
-- 'default-org' fallback (legacy/demo signups). That branch now also
-- inserts this new org's workspace_profiles row directly, with
-- is_legacy_default = false and needs_onboarding = true — so the
-- distinction between "pre-existing org that predates this feature"
-- (is_legacy_default = true, needs_onboarding = false, seeded by
-- STEP180) and "brand new org that should onboard" is exact, not a
-- time-based guess. src/lib/workspace.js's getWorkspaceProfile()
-- auto-create fallback (is_legacy_default = true) now only ever fires
-- for the truly-unreachable edge case of an org existing with no
-- workspace_profiles row at all, which this trigger prevents for every
-- future 'create' signup.
-- ============================================================

ALTER TABLE workspace_profiles ADD COLUMN IF NOT EXISTS needs_onboarding BOOLEAN NOT NULL DEFAULT false;
UPDATE workspace_profiles SET needs_onboarding = false WHERE needs_onboarding IS DISTINCT FROM false;

-- Master prompt's onboarding Step 1 asks for Company Size, which has no
-- existing home anywhere (organizations already has industry/country/
-- timezone/currency/address/logo from the pre-existing onboarding
-- system in src/lib/onboarding.js — this is the one genuinely missing
-- field). Nullable, additive, no default-value assumption forced onto
-- existing orgs.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_size TEXT;

-- update_org_profile() (STEP126) is the ONLY writer of organizations'
-- profile columns for an org's own admin/ceo (STEP89's organizations_write
-- policy is deliberately super-admin-only for direct table writes — this
-- SECURITY DEFINER function is the narrow exception). Re-declared here
-- with one new trailing optional param so existing callers (Settings ->
-- Organization tab, via src/lib/onboarding.js's updateOrgProfile()) are
-- entirely unaffected — they simply never pass p_company_size and it
-- stays NULL-coalesced to the existing value, same as every other param.
--
-- IMPORTANT: Postgres identifies a function by (name, parameter TYPES
-- AND COUNT) — CREATE OR REPLACE with a different arg count does not
-- replace STEP126's 7-arg version, it creates an ambiguous second
-- overload. Drop the old signature explicitly first.
DROP FUNCTION IF EXISTS update_org_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION update_org_profile(
  p_name         TEXT DEFAULT NULL,
  p_industry     TEXT DEFAULT NULL,
  p_country      TEXT DEFAULT NULL,
  p_timezone     TEXT DEFAULT NULL,
  p_currency     TEXT DEFAULT NULL,
  p_address      TEXT DEFAULT NULL,
  p_logo         TEXT DEFAULT NULL,
  p_company_size TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can update the organization profile';
  END IF;

  UPDATE organizations SET
    name         = COALESCE(p_name, name),
    industry     = COALESCE(p_industry, industry),
    country      = COALESCE(p_country, country),
    timezone     = COALESCE(p_timezone, timezone),
    currency     = COALESCE(p_currency, currency),
    address      = COALESCE(p_address, address),
    logo         = COALESCE(p_logo, logo),
    company_size = COALESCE(p_company_size, company_size)
  WHERE id = current_org_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_org_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role      TEXT := 'employee';
  v_name      TEXT;
  v_org_id    UUID;
  v_org_mode  TEXT;
  v_org_name  TEXT;
  v_slug      TEXT;
  v_inv       organization_invites%ROWTYPE;
  v_seat_cap  INT;
  v_intended_plan     TEXT;
  v_intended_bundles  TEXT;
  v_plan_trial_days   INT;
  v_bundle_key        TEXT;
BEGIN
  v_role := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'employee');

  v_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(split_part(NEW.email, '@', 1)), ''),
    'User'
  );

  v_org_mode := NEW.raw_user_meta_data->>'org_mode';

  IF v_org_mode = 'create' AND NULLIF(TRIM(NEW.raw_user_meta_data->>'org_name'), '') IS NOT NULL THEN
    v_org_name := TRIM(NEW.raw_user_meta_data->>'org_name');
    v_slug := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    IF v_slug = '' THEN v_slug := 'org'; END IF;
    IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
    END IF;
    -- created_by left NULL here deliberately — see STEP105's comment,
    -- unchanged reasoning. New orgs created through this branch get the
    -- schema defaults (plan_key='free', billing_status='trialing',
    -- trial_ends_at=now()+14d) — no explicit INSERT column list needed.
    INSERT INTO organizations (slug, name) VALUES (v_slug, v_org_name)
    RETURNING id INTO v_org_id;
    v_role := 'admin';

    -- STEP133: apply the landing-page estimator's selection, if any.
    v_intended_plan := NULLIF(TRIM(NEW.raw_user_meta_data->>'intended_plan_key'), '');
    IF v_intended_plan IS NOT NULL THEN
      SELECT trial_days INTO v_plan_trial_days FROM billing_plans WHERE key = v_intended_plan AND is_active = true;
      IF v_plan_trial_days IS NOT NULL THEN
        UPDATE organizations SET
          plan_key = v_intended_plan,
          trial_ends_at = CASE WHEN v_plan_trial_days > 0 THEN now() + make_interval(days => v_plan_trial_days) ELSE NULL END,
          billing_status = CASE WHEN v_plan_trial_days > 0 THEN 'trialing' ELSE 'active' END
        WHERE id = v_org_id;
      END IF;
    END IF;

    v_intended_bundles := NULLIF(TRIM(NEW.raw_user_meta_data->>'intended_bundle_keys'), '');
    IF v_intended_bundles IS NOT NULL THEN
      FOREACH v_bundle_key IN ARRAY string_to_array(v_intended_bundles, ',') LOOP
        INSERT INTO organization_bundle_subscriptions (organization_id, bundle_key, status)
        SELECT v_org_id, v_bundle_key, 'active'
        WHERE EXISTS (SELECT 1 FROM billing_bundles WHERE key = v_bundle_key AND is_active = true)
        ON CONFLICT (organization_id, bundle_key) DO NOTHING;
      END LOOP;
    END IF;

    -- STEP181 (NEW): this org needs the industry/workspace onboarding
    -- wizard — precise, not a heuristic. Every other branch below
    -- (join / default-org fallback) never reaches here, so those orgs
    -- simply never get a row inserted by this trigger; STEP180's own
    -- seed already covers every org that existed before this migration,
    -- and getWorkspaceProfile()'s defensive auto-create (is_legacy_default
    -- = true) covers the remaining theoretical gap.
    INSERT INTO workspace_profiles (organization_id, is_legacy_default, needs_onboarding, terminology_overrides)
    VALUES (v_org_id, false, true, '{}'::jsonb)
    ON CONFLICT (organization_id) DO NOTHING;

  ELSIF v_org_mode = 'join' AND NULLIF(TRIM(NEW.raw_user_meta_data->>'invite_code'), '') IS NOT NULL THEN
    SELECT * INTO v_inv FROM organization_invites
      WHERE code = upper(trim(NEW.raw_user_meta_data->>'invite_code'))
        AND revoked = false
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR use_count < max_uses);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or expired invite code';
    END IF;
    v_org_id := v_inv.organization_id;
    v_role := v_inv.role;

    v_seat_cap := org_seat_limit(v_org_id);
    IF v_seat_cap IS NOT NULL AND (SELECT count(*) FROM profiles WHERE organization_id = v_org_id) >= v_seat_cap THEN
      RAISE EXCEPTION 'This organization has reached its seat limit for its current plan';
    END IF;

    UPDATE organization_invites SET use_count = use_count + 1 WHERE id = v_inv.id;

  ELSE
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'default-org';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (NEW.id, NEW.email, v_name, v_role, TRUE, v_org_id)
  ON CONFLICT (id) DO UPDATE
    SET
      email            = EXCLUDED.email,
      full_name        = CASE WHEN EXCLUDED.full_name <> 'User' THEN EXCLUDED.full_name ELSE profiles.full_name END,
      role             = EXCLUDED.role,
      organization_id  = COALESCE(profiles.organization_id, EXCLUDED.organization_id);

  IF v_org_mode = 'create' AND v_org_id IS NOT NULL THEN
    UPDATE organizations SET created_by = NEW.id WHERE id = v_org_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
