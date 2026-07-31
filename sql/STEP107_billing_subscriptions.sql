-- ============================================================
-- STEP107: Billing / subscription layer — Phase 5 of the multi-tenant
-- SaaS conversion (Phases 1-4 shipped in STEP89-106, see that range's
-- headers). Organizations exist with no plan, seat limit, or paid/trial
-- status anywhere in the schema — this closes that gap so real paying
-- customers can be onboarded.
--
-- No payment gateway is wired up here (no Stripe/Razorpay credentials
-- exist in this repo to integrate against) — this is the schema +
-- self-serve request workflow a gateway would plug into later:
--   billing_plans            — platform-wide catalog (free/starter/pro/
--                               enterprise), super-admin-writable only.
--   organizations             gains plan_key / billing_status /
--                               trial_ends_at / seat_limit_override.
--   billing_upgrade_requests — an org admin/ceo asks for a plan change;
--                               a super admin actions it from the
--                               console. Manual-fulfillment MVP — the
--                               same posture STEP105's admin-invite
--                               bootstrap already uses for onboarding.
--   org_seat_limit()          — resolves the effective seat cap (an
--                               explicit per-org override, else the
--                               plan default; NULL = unlimited).
--   handle_new_user()         — rewritten again (full body, same as
--                               every prior STEP that's touched it) to
--                               reject an invite-join once the target
--                               org is at its seat cap. Falls into the
--                               function's existing EXCEPTION WHEN
--                               OTHERS safety net (STEP105) — same
--                               "auth.users row exists, no profiles row
--                               does" fallback as an invalid invite code.
--
-- Existing organizations (anything created before this migration, i.e.
-- default-org and any org onboarded during Phases 1-4) are grandfathered
-- onto the 'enterprise' plan with 'active' status and no trial clock —
-- they predate billing entirely and must not suddenly be trial-limited
-- or seat-capped by a migration.
-- ============================================================

-- ── billing_plans ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_plans (
  key           TEXT        PRIMARY KEY,
  name          TEXT        NOT NULL,
  seat_limit    INT,                              -- null = unlimited
  price_monthly NUMERIC(10,2),                     -- null = "contact sales"
  price_yearly  NUMERIC(10,2),
  features      JSONB       NOT NULL DEFAULT '[]',
  sort_order    INT         NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO billing_plans (key, name, seat_limit, price_monthly, price_yearly, features, sort_order) VALUES
  ('free',       'Free',       3,  0,     0,      '["Up to 3 seats","Core modules","Community support"]', 0),
  ('starter',    'Starter',    10, 4999,  49990,  '["Up to 10 seats","All core modules","Email support"]', 1),
  ('pro',        'Pro',        50, 14999, 149990, '["Up to 50 seats","All modules incl. Sales & Marketing CRM","Priority support","Neo Task AI"]', 2),
  ('enterprise', 'Enterprise', NULL, NULL, NULL,   '["Unlimited seats","All modules","Dedicated support","Custom SLAs"]', 3)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_plans_select ON billing_plans;
DROP POLICY IF EXISTS billing_plans_write  ON billing_plans;
-- Every signed-in user needs to see the catalog (Settings -> Billing plan
-- comparison) — same permissive-SELECT posture as organizations/modules.
-- Only a platform super admin can create/edit/retire a plan.
CREATE POLICY billing_plans_select ON billing_plans FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY billing_plans_write ON billing_plans FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plans TO authenticated;

-- ── organizations: plan + subscription state ───────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_key TEXT NOT NULL DEFAULT 'free' REFERENCES billing_plans(key);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'trialing'
  CHECK (billing_status IN ('trialing','active','past_due','canceled'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days');
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_limit_override INT;

-- Grandfather every org that already existed before this migration ran.
UPDATE organizations
  SET plan_key = 'enterprise', billing_status = 'active', trial_ends_at = NULL
  WHERE created_at < now();

-- organizations_write (STEP89) already restricts writes to a platform
-- super admin, and organizations_select is already permissive — both
-- already cover these new columns, no policy change needed.

-- ── org_seat_limit() — effective seat cap for an org, NULL = unlimited ──
CREATE OR REPLACE FUNCTION org_seat_limit(p_org_id UUID) RETURNS INT AS $$
  SELECT COALESCE(o.seat_limit_override, bp.seat_limit)
  FROM organizations o LEFT JOIN billing_plans bp ON bp.key = o.plan_key
  WHERE o.id = p_org_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── billing_upgrade_requests ────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_upgrade_requests (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_plan_key  TEXT        NOT NULL REFERENCES billing_plans(key),
  note                TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','dismissed')),
  created_by          UUID        REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  resolved_by         UUID        REFERENCES profiles(id),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS billing_upgrade_requests_org_idx ON billing_upgrade_requests(organization_id);

ALTER TABLE billing_upgrade_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_upgrade_requests_select ON billing_upgrade_requests;
DROP POLICY IF EXISTS billing_upgrade_requests_insert ON billing_upgrade_requests;
DROP POLICY IF EXISTS billing_upgrade_requests_update ON billing_upgrade_requests;

CREATE POLICY billing_upgrade_requests_select ON billing_upgrade_requests FOR SELECT USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
CREATE POLICY billing_upgrade_requests_insert ON billing_upgrade_requests FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
-- Resolving (fulfilled/dismissed) is a platform-level action only — an
-- org admin can ask, not self-approve.
CREATE POLICY billing_upgrade_requests_update ON billing_upgrade_requests FOR UPDATE USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT SELECT, INSERT, UPDATE ON public.billing_upgrade_requests TO authenticated;

-- ── request_billing_upgrade() — org admin/ceo asks for a plan change;
-- logs the request and notifies every platform super admin. Plain INSERT
-- would satisfy RLS for the request row itself, but notifying super
-- admins needs to read across every org's profiles for is_super_admin,
-- which profiles RLS (org-scoped) does not allow a regular org admin to
-- do directly — same cross-org-visibility gap STEP105 solved with
-- super_admin_list_organizations(). ──
CREATE OR REPLACE FUNCTION request_billing_upgrade(p_plan_key TEXT, p_note TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_org_id   UUID := current_org_id();
  v_org_name TEXT;
  v_req_id   UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can request a plan change';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM billing_plans WHERE key = p_plan_key AND is_active = true) THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  INSERT INTO billing_upgrade_requests (organization_id, requested_plan_key, note, created_by)
  VALUES (v_org_id, p_plan_key, p_note, auth.uid())
  RETURNING id INTO v_req_id;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_org_id;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT id, 'billing_upgrade_request', 'Plan change requested',
    COALESCE(v_org_name, 'An organization') || ' requested the "' || p_plan_key || '" plan.',
    '/super-admin'
  FROM profiles WHERE is_super_admin = true;

  RETURN v_req_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_billing_upgrade(TEXT, TEXT) TO authenticated;

-- ── handle_new_user() — STEP105's version + a seat-limit check on the
-- 'join' branch. Full body reproduced (CREATE OR REPLACE replaces the
-- whole function, not a diff) — same convention as STEP95 -> STEP105. ──
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

    -- NEW (STEP107): reject the join if the target org is already at its
    -- plan's seat cap. The org's first user (org_mode='create' branch
    -- above) is never subject to this — every plan's minimum seat_limit
    -- is >= 1, so a brand-new org can always seat its own creator.
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

-- ── super_admin_list_organizations() — extended with billing columns.
-- DROP first: CREATE OR REPLACE cannot change a function's OUT-parameter
-- row type, only its body — this adds 4 new output columns to STEP105's
-- version, so the old signature has to go before the new one lands. ──
DROP FUNCTION IF EXISTS super_admin_list_organizations();
CREATE OR REPLACE FUNCTION super_admin_list_organizations()
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ,
  member_count BIGINT, enabled_module_count BIGINT,
  plan_key TEXT, billing_status TEXT, trial_ends_at TIMESTAMPTZ, seat_limit INT
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.is_active, o.created_at,
      (SELECT count(*) FROM profiles p WHERE p.organization_id = o.id),
      (SELECT count(*) FROM modules m WHERE m.organization_id = o.id AND m.enabled = true),
      o.plan_key, o.billing_status, o.trial_ends_at, org_seat_limit(o.id)
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_organizations() TO authenticated;

-- ── super_admin_set_org_billing() — the only writer for plan/status/
-- trial/seat-override; optionally resolves the upgrade request that
-- prompted the change in the same call. ──
CREATE OR REPLACE FUNCTION super_admin_set_org_billing(
  p_org_id              UUID,
  p_plan_key            TEXT,
  p_billing_status      TEXT,
  p_trial_ends_at       TIMESTAMPTZ DEFAULT NULL,
  p_seat_limit_override INT DEFAULT NULL,
  p_request_id          UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_billing_status NOT IN ('trialing','active','past_due','canceled') THEN
    RAISE EXCEPTION 'Invalid billing status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM billing_plans WHERE key = p_plan_key) THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  UPDATE organizations SET
    plan_key             = p_plan_key,
    billing_status        = p_billing_status,
    trial_ends_at         = p_trial_ends_at,
    seat_limit_override   = p_seat_limit_override
  WHERE id = p_org_id;

  IF p_request_id IS NOT NULL THEN
    UPDATE billing_upgrade_requests
      SET status = 'fulfilled', resolved_at = now(), resolved_by = auth.uid()
      WHERE id = p_request_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_org_billing(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, UUID) TO authenticated;

-- ── super_admin_dismiss_billing_request() — reject without changing plan ──
CREATE OR REPLACE FUNCTION super_admin_dismiss_billing_request(p_request_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE billing_upgrade_requests
    SET status = 'dismissed', resolved_at = now(), resolved_by = auth.uid()
    WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_dismiss_billing_request(UUID) TO authenticated;

-- ── super_admin_list_billing_requests() — cross-org queue for the
-- console (billing_upgrade_requests_select already lets a super admin
-- read every row directly, but this joins in the org name in one call). ──
CREATE OR REPLACE FUNCTION super_admin_list_billing_requests()
RETURNS TABLE (
  id UUID, organization_id UUID, org_name TEXT, requested_plan_key TEXT,
  note TEXT, status TEXT, created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT r.id, r.organization_id, o.name, r.requested_plan_key, r.note, r.status, r.created_at
    FROM billing_upgrade_requests r
    JOIN organizations o ON o.id = r.organization_id
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_billing_requests() TO authenticated;

NOTIFY pgrst, 'reload schema';
