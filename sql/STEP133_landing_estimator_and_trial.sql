-- ============================================================
-- STEP133: Landing-page module/plan estimator + admin-configurable
-- trial length applied to what a visitor actually picked.
--
-- 1. billing_bundles SELECT widened to anon, same reasoning STEP109
--    already used for billing_plans — module name/price is public
--    pricing information, nothing per-organization or sensitive.
--
-- 2. billing_plans gains trial_days (admin-editable from Settings ->
--    Estimation, per plan). organizations.trial_ends_at has used a
--    flat, hardcoded 14-day column default since STEP89 regardless of
--    which plan a signup intends to land on — this makes the trial
--    length follow the ADMIN'S OWN pricing configuration for whichever
--    plan the visitor actually picked on the landing page, not a fixed
--    constant.
--
-- 3. handle_new_user() (rewritten again in full, same convention as
--    every prior STEP that's touched it) reads two new, OPTIONAL
--    signup metadata fields on the 'create' org_mode branch only:
--      intended_plan_key    — a billing_plans.key the visitor picked
--                              on the landing-page estimator
--      intended_bundle_keys — comma-separated billing_bundles.key list
--    If present and valid, the new org's plan_key/trial_ends_at are set
--    from that plan's own price/trial_days (instead of the 'free'
--    schema default + flat 14-day column default), and the picked
--    bundles are activated immediately — so signing up from the
--    estimator lands the new org already configured with exactly what
--    was estimated, trial already running against it, ready to pay
--    from Settings -> Billing whenever they choose to. Absent metadata
--    (every other existing signup path) behaves exactly as before.
-- ============================================================

DROP POLICY IF EXISTS billing_bundles_select ON billing_bundles;
CREATE POLICY billing_bundles_select ON billing_bundles FOR SELECT USING (true);
GRANT SELECT ON public.billing_bundles TO anon;

ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 14;

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

    -- NEW (STEP133): apply the landing-page estimator's selection, if any.
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
  -- A raised seat-limit or invalid-invite-code exception lands here too:
  -- the auth.users row still gets created but no profiles row does,
  -- which AuthContext's existing retry-then-fallback loop already
  -- handles — same safety net as any other signup failure mode
  -- (STEP105's convention, unchanged).
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
