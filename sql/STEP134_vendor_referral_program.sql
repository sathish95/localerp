-- ============================================================
-- STEP134: Vendor/reseller referral program — external partners with
-- their own login, a referral code that tags new orgs to them at
-- signup, and a real commission ledger accrued automatically from
-- actual paid subscription revenue.
--
-- A vendor is a NEW, separate account type — not an organization
-- member. profiles.vendor_id is orthogonal to organization_id/role,
-- same relationship is_super_admin already has to role (STEP89's own
-- comment: "platform-level flag, NOT a 12th roles row"). A vendor
-- account's organization_id still lands in 'default-org' via the
-- existing handle_new_user() fallback (unchanged) — it's irrelevant,
-- since the frontend routes any profile with vendor_id set straight to
-- a dedicated vendor-only shell, never the normal org-scoped app.
--
-- Referral attribution: a vendor's unique `code`, carried through
-- signup as raw_user_meta_data->>'referral_code' (mirrors STEP133's
-- intended_plan_key hand-off exactly), sets the new org's
-- referred_by_vendor_id. Commission accrues automatically inside
-- record_payment_success() whenever a referred org's payment succeeds
-- — a real ledger row per paid order, not a live-computed number, so a
-- vendor's payout history is an actual auditable record and can be
-- marked paid independent of whatever the org does afterward.
--
-- KNOWN LIMITATION, stated plainly: organizations_select (STEP89) is
-- permissive for ANY authenticated user (`auth.uid() IS NOT NULL`),
-- which was fine when every authenticated user was a company employee.
-- A vendor is now an external party, and that same broad policy would
-- let a vendor's own client query the raw `organizations` table
-- directly and see every OTHER org's name/plan/billing_status too, not
-- just their own referrals. Deliberately NOT tightened here — the
-- vendor dashboard is built to go through vendor_list_my_organizations()
-- below instead of raw table access, which fixes the vendor UI's own
-- data access, but the underlying table-level exposure to a
-- sufficiently technical vendor remains and would need its own,
-- separately-tested migration to narrow safely.
-- ============================================================

-- Named `referral_vendors`, NOT `vendors` — this app already has an
-- unrelated, pre-existing `vendors` table for the procurement/supplier
-- feature (see STEP25). An earlier version of this migration used
-- `CREATE TABLE IF NOT EXISTS vendors`, which silently no-op'd against
-- that existing table (so commission_type/code/etc. never actually got
-- created) while also enabling RLS on it for the first time with a
-- write policy that locked out every non-super-admin user of the real
-- Vendors/suppliers page. Fixed here at the source; STEP140 repairs any
-- database that already ran the broken version.
CREATE TABLE IF NOT EXISTS referral_vendors (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT        NOT NULL,
  code             TEXT        NOT NULL UNIQUE,
  commission_type  TEXT        NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'flat')),
  commission_rate  NUMERIC(10,2) NOT NULL DEFAULT 0, -- percent (0-100) or a flat amount per paid order, per commission_type
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_by       UUID        REFERENCES profiles(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES referral_vendors(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by_vendor_id UUID REFERENCES referral_vendors(id);
CREATE INDEX IF NOT EXISTS organizations_referred_by_vendor_idx ON organizations(referred_by_vendor_id);

CREATE TABLE IF NOT EXISTS vendor_commissions (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id         UUID        NOT NULL REFERENCES referral_vendors(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_order_id  UUID        REFERENCES payment_orders(id) ON DELETE SET NULL,
  amount            NUMERIC(10,2) NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at           TIMESTAMPTZ,
  paid_by           UUID        REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_commissions_vendor_idx ON vendor_commissions(vendor_id);

-- ── current_vendor_id() — same shape as current_org_id(), for RLS ──
CREATE OR REPLACE FUNCTION current_vendor_id() RETURNS UUID AS $$
  SELECT vendor_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE referral_vendors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_commissions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_vendors_select ON referral_vendors;
DROP POLICY IF EXISTS referral_vendors_write  ON referral_vendors;
CREATE POLICY referral_vendors_select ON referral_vendors FOR SELECT USING (
  is_platform_super_admin() OR id = current_vendor_id()
);
CREATE POLICY referral_vendors_write ON referral_vendors FOR ALL USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_vendors TO authenticated;

DROP POLICY IF EXISTS vendor_commissions_select ON vendor_commissions;
DROP POLICY IF EXISTS vendor_commissions_update ON vendor_commissions;
CREATE POLICY vendor_commissions_select ON vendor_commissions FOR SELECT USING (
  is_platform_super_admin() OR vendor_id = current_vendor_id()
);
-- Marking a commission paid is a platform action only — insertion
-- happens exclusively inside record_payment_success() below (a
-- SECURITY DEFINER function, so it bypasses this policy entirely), no
-- client (vendor or otherwise) ever inserts a commission row directly.
CREATE POLICY vendor_commissions_update ON vendor_commissions FOR UPDATE USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT SELECT, UPDATE ON public.vendor_commissions TO authenticated;

-- ── vendor_list_my_organizations() — the vendor dashboard's only read
-- path into organizations (see the header note on why: organizations_
-- select is too broad to let a vendor's raw client query it safely). ──
CREATE OR REPLACE FUNCTION vendor_list_my_organizations()
RETURNS TABLE (
  id UUID, name TEXT, slug TEXT, plan_key TEXT, billing_status TEXT,
  created_at TIMESTAMPTZ, member_count BIGINT
) AS $$
DECLARE v_vendor_id UUID := current_vendor_id();
BEGIN
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor account';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.slug, o.plan_key, o.billing_status, o.created_at,
      (SELECT count(*) FROM profiles p WHERE p.organization_id = o.id)
    FROM organizations o
    WHERE o.referred_by_vendor_id = v_vendor_id AND o.deleted_at IS NULL
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION vendor_list_my_organizations() TO authenticated;

-- ── super_admin_mark_commission_paid() — plain UPDATE would already
-- satisfy vendor_commissions_update's RLS, but a dedicated function
-- keeps "who marked it and when" consistent in one call. ──
CREATE OR REPLACE FUNCTION super_admin_mark_commission_paid(p_commission_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE vendor_commissions SET status = 'paid', paid_at = now(), paid_by = auth.uid()
  WHERE id = p_commission_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_mark_commission_paid(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_list_vendors()
RETURNS TABLE (
  id UUID, name TEXT, code TEXT, commission_type TEXT, commission_rate NUMERIC,
  is_active BOOLEAN, created_at TIMESTAMPTZ,
  referred_org_count BIGINT, pending_commission NUMERIC, paid_commission NUMERIC
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT v.id, v.name, v.code, v.commission_type, v.commission_rate, v.is_active, v.created_at,
      (SELECT count(*) FROM organizations o WHERE o.referred_by_vendor_id = v.id AND o.deleted_at IS NULL),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'pending'),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'paid')
    FROM referral_vendors v
    ORDER BY v.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_vendors() TO authenticated;

-- ── handle_new_user() — extended again (STEP107 -> STEP133 -> here),
-- same full-body-rewrite convention. Adds ONE new, optional metadata
-- field on the 'create' branch: referral_code. Everything else is
-- byte-for-byte the STEP133 version. ──
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
  v_referral_code     TEXT;
  v_vendor_id         UUID;
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
    INSERT INTO organizations (slug, name) VALUES (v_slug, v_org_name)
    RETURNING id INTO v_org_id;
    v_role := 'admin';

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

    -- NEW (STEP134): tag the org to whichever vendor's referral code
    -- (if any) was carried through signup.
    v_referral_code := NULLIF(TRIM(NEW.raw_user_meta_data->>'referral_code'), '');
    IF v_referral_code IS NOT NULL THEN
      SELECT id INTO v_vendor_id FROM referral_vendors WHERE code = upper(v_referral_code) AND is_active = true;
      IF v_vendor_id IS NOT NULL THEN
        UPDATE organizations SET referred_by_vendor_id = v_vendor_id WHERE id = v_org_id;
      END IF;
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
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── record_payment_success()/record_payment_failure() — rewritten to
-- (a) accrue a vendor_commissions row when the paying org was referred
-- by an active vendor, and (b) close a real gap the security review
-- flagged earlier: NEITHER function checked who was calling them.
-- Both are only ever meant to be called by the payment-webhook Edge
-- Function using its SERVICE ROLE key (never by a client with a user
-- JWT) — auth.role() reports 'service_role' for that key specifically,
-- distinct from 'authenticated'/'anon', which is exactly what's being
-- checked now. Previously any signed-in user could call
-- record_payment_success on their own org's order and grant themselves
-- a paid subscription for free; that path is now closed. ──
CREATE OR REPLACE FUNCTION record_payment_success(p_order_id UUID) RETURNS VOID AS $$
DECLARE
  v_order payment_orders%ROWTYPE;
  v_period_start TIMESTAMPTZ;
  v_vendor_id UUID;
  v_commission NUMERIC;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_order FROM payment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment order';
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN;
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

  -- NEW (STEP134): accrue commission for the referring vendor, if any.
  SELECT o.referred_by_vendor_id INTO v_vendor_id FROM organizations o WHERE o.id = v_order.organization_id;
  IF v_vendor_id IS NOT NULL THEN
    SELECT CASE WHEN commission_type = 'percent' THEN round(v_order.amount * commission_rate / 100, 2) ELSE commission_rate END
    INTO v_commission FROM referral_vendors WHERE id = v_vendor_id AND is_active = true;
    IF v_commission IS NOT NULL AND v_commission > 0 THEN
      INSERT INTO vendor_commissions (vendor_id, organization_id, payment_order_id, amount)
      VALUES (v_vendor_id, v_order.organization_id, v_order.id, v_commission);
    END IF;
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'payment_success', 'Payment received', 'Your subscription has been renewed. Thank you!', '/settings'
  FROM profiles p WHERE p.organization_id = v_order.organization_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION record_payment_success(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION record_payment_success(UUID) TO service_role;

CREATE OR REPLACE FUNCTION record_payment_failure(p_order_id UUID) RETURNS VOID AS $$
DECLARE v_order payment_orders%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_order FROM payment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown payment order'; END IF;
  UPDATE payment_orders SET status = 'failed' WHERE id = p_order_id;
  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'payment_failed', 'Payment failed', 'Your renewal payment did not go through. Please try again or use a different payment method.', '/settings'
  FROM profiles p WHERE p.organization_id = v_order.organization_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION record_payment_failure(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION record_payment_failure(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
