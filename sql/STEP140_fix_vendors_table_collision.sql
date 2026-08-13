-- ============================================================
-- STEP140: Fix a genuine schema-level naming collision introduced by
-- STEP134-139. `vendors` was ALREADY a real table before this session
-- — the pre-existing procurement/supplier feature (STEP25 already
-- alters it: "ALTER TABLE vendors ADD COLUMN supplier_type ..."). The
-- referral-program migrations wrote `CREATE TABLE IF NOT EXISTS
-- vendors (...)`, which silently no-op'd against that existing table —
-- so commission_type/code/commission_rate never actually got created
-- (hence the "column v.commission_type does not exist" error), while
-- STEP134 ALSO ran `ALTER TABLE vendors ENABLE ROW LEVEL SECURITY` +
-- restrictive policies (write = super-admin-only) against the REAL
-- supplier table for the first time ever — no earlier migration had
-- ever put RLS on it, so this was a full read/write lockout of the
-- existing Vendors (suppliers) page for every non-super-admin user
-- until this migration runs. STEP135 also bolted is_promoter/
-- promoter_seat_allocation/promoter_discount_percent onto the real
-- supplier table via ALTER TABLE ADD COLUMN, which DID succeed (those
-- ran as separate statements, not inside the no-op CREATE TABLE).
--
-- Fix, in order:
--   1. Revert the real `vendors` table to its original, no-RLS state
--      and remove the three stray promoter columns.
--   2. Create the referral program's table under its own name,
--      `referral_vendors`, with the FULL schema it was always meant to
--      have (this is what every "vendors" reference in STEP134-139
--      should have said from the start).
--   3. Re-point every FK that was wrongly pointing at `vendors(id)` —
--      profiles.vendor_id, organizations.referred_by_vendor_id,
--      payment_orders.promoter_vendor_id, vendor_commissions.vendor_id,
--      vendor_payouts.vendor_id, promoter_applications.vendor_id — to
--      `referral_vendors(id)` instead. Constraint names use Postgres'
--      default auto-naming (`<table>_<column>_fkey`), which is what
--      every affected column actually got since none were explicitly
--      named.
--   4. Redefine every function that queried `vendors` (super_admin_
--      list_vendors, vendor_my_seat_pool_status, super_admin_set_
--      promoter, check_promo_code, super_admin_approve_promoter_
--      application) against `referral_vendors` instead.
--
-- No real referral-program data existed before this — every INSERT
-- INTO vendors(...) in STEP134/136/138's demo/approval paths would
-- itself have failed on the same missing-column error, so there is
-- nothing to migrate, only schema to fix.
-- ============================================================

-- ── 1. Revert the real (supplier) vendors table ──
DROP POLICY IF EXISTS vendors_select ON vendors;
DROP POLICY IF EXISTS vendors_write ON vendors;
ALTER TABLE vendors DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendors DROP COLUMN IF EXISTS is_promoter;
ALTER TABLE vendors DROP COLUMN IF EXISTS promoter_seat_allocation;
ALTER TABLE vendors DROP COLUMN IF EXISTS promoter_discount_percent;

-- ── 2. The referral program's real table ──
CREATE TABLE IF NOT EXISTS referral_vendors (
  id                          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name                        TEXT        NOT NULL,
  code                        TEXT        NOT NULL UNIQUE,
  commission_type             TEXT        NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'flat')),
  commission_rate             NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active                   BOOLEAN     NOT NULL DEFAULT true,
  is_promoter                 BOOLEAN     NOT NULL DEFAULT false,
  promoter_seat_allocation    INT,
  promoter_discount_percent   NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_by                  UUID        REFERENCES profiles(id),
  created_at                  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE referral_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_vendors_select ON referral_vendors;
DROP POLICY IF EXISTS referral_vendors_write ON referral_vendors;
CREATE POLICY referral_vendors_select ON referral_vendors FOR SELECT USING (
  is_platform_super_admin() OR id = current_vendor_id()
);
CREATE POLICY referral_vendors_write ON referral_vendors FOR ALL USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_vendors TO authenticated;

-- ── 3. Re-point every FK that was wrongly aimed at `vendors(id)` ──
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_vendor_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES referral_vendors(id);

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_referred_by_vendor_id_fkey;
ALTER TABLE organizations ADD CONSTRAINT organizations_referred_by_vendor_id_fkey FOREIGN KEY (referred_by_vendor_id) REFERENCES referral_vendors(id);

ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_promoter_vendor_id_fkey;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_promoter_vendor_id_fkey FOREIGN KEY (promoter_vendor_id) REFERENCES referral_vendors(id);

ALTER TABLE vendor_commissions DROP CONSTRAINT IF EXISTS vendor_commissions_vendor_id_fkey;
ALTER TABLE vendor_commissions ADD CONSTRAINT vendor_commissions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES referral_vendors(id) ON DELETE CASCADE;

ALTER TABLE vendor_payouts DROP CONSTRAINT IF EXISTS vendor_payouts_vendor_id_fkey;
ALTER TABLE vendor_payouts ADD CONSTRAINT vendor_payouts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES referral_vendors(id) ON DELETE CASCADE;

ALTER TABLE promoter_applications DROP CONSTRAINT IF EXISTS promoter_applications_vendor_id_fkey;
ALTER TABLE promoter_applications ADD CONSTRAINT promoter_applications_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES referral_vendors(id);

-- ── 4. Redefine every function that queried `vendors` against
-- `referral_vendors` instead — bodies otherwise unchanged from
-- STEP135/137/138. ──

DROP FUNCTION IF EXISTS super_admin_list_vendors();
CREATE OR REPLACE FUNCTION super_admin_list_vendors()
RETURNS TABLE (
  id UUID, name TEXT, code TEXT, commission_type TEXT, commission_rate NUMERIC,
  is_active BOOLEAN, created_at TIMESTAMPTZ,
  referred_org_count BIGINT, pending_commission NUMERIC, paid_commission NUMERIC,
  is_promoter BOOLEAN, promoter_seat_allocation INT, promoter_discount_percent NUMERIC, promoter_seats_used BIGINT
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT v.id, v.name, v.code, v.commission_type, v.commission_rate, v.is_active, v.created_at,
      (SELECT count(*) FROM organizations o WHERE o.referred_by_vendor_id = v.id AND o.deleted_at IS NULL),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'pending'),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'paid'),
      v.is_promoter, v.promoter_seat_allocation, v.promoter_discount_percent, _promoter_seats_used(v.id)
    FROM referral_vendors v
    ORDER BY v.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_vendors() TO authenticated;

CREATE OR REPLACE FUNCTION vendor_my_seat_pool_status()
RETURNS TABLE (is_promoter BOOLEAN, seat_allocation INT, discount_percent NUMERIC, seats_used BIGINT) AS $$
DECLARE v_vendor_id UUID := current_vendor_id();
BEGIN
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor account';
  END IF;
  RETURN QUERY
    SELECT v.is_promoter, v.promoter_seat_allocation, v.promoter_discount_percent, _promoter_seats_used(v.id)
    FROM referral_vendors v WHERE v.id = v_vendor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION vendor_my_seat_pool_status() TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_set_promoter(
  p_vendor_id UUID, p_is_promoter BOOLEAN, p_seat_allocation INT, p_discount_percent NUMERIC
) RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'Discount percent must be between 0 and 100';
  END IF;
  UPDATE referral_vendors SET
    is_promoter = p_is_promoter,
    promoter_seat_allocation = p_seat_allocation,
    promoter_discount_percent = p_discount_percent
  WHERE id = p_vendor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_promoter(UUID, BOOLEAN, INT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION check_promo_code(p_code TEXT)
RETURNS TABLE (valid BOOLEAN, discount_percent NUMERIC, seats_remaining INT, reason TEXT) AS $$
DECLARE
  v_vendor referral_vendors%ROWTYPE;
  v_used BIGINT;
  v_remaining INT;
BEGIN
  SELECT * INTO v_vendor FROM referral_vendors WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::INT, 'Code not found';
    RETURN;
  END IF;
  IF NOT v_vendor.is_active OR NOT v_vendor.is_promoter OR v_vendor.promoter_discount_percent <= 0 THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::INT, 'This code has no active discount';
    RETURN;
  END IF;

  v_used := _promoter_seats_used(v_vendor.id);
  v_remaining := CASE WHEN v_vendor.promoter_seat_allocation IS NULL THEN NULL ELSE GREATEST(0, v_vendor.promoter_seat_allocation - v_used::INT) END;

  IF v_remaining IS NOT NULL AND v_remaining <= 0 THEN
    RETURN QUERY SELECT false, v_vendor.promoter_discount_percent, 0, 'This code''s discount pool is fully used';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_vendor.promoter_discount_percent, v_remaining, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION check_promo_code(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION super_admin_approve_promoter_application(
  p_application_id UUID, p_code TEXT, p_temp_password TEXT,
  p_seat_allocation INT, p_discount_percent NUMERIC,
  p_commission_type TEXT DEFAULT 'percent', p_commission_rate NUMERIC DEFAULT 0
) RETURNS UUID AS $$
DECLARE
  v_app promoter_applications%ROWTYPE;
  v_vendor_id UUID;
  v_uid UUID;
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_app FROM promoter_applications WHERE id = p_application_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already reviewed';
  END IF;
  IF p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'Discount percent must be between 0 and 100';
  END IF;

  INSERT INTO referral_vendors (
    name, code, commission_type, commission_rate, is_active,
    is_promoter, promoter_seat_allocation, promoter_discount_percent, created_by
  ) VALUES (
    COALESCE(v_app.company_name, v_app.full_name), upper(trim(p_code)), p_commission_type, p_commission_rate, true,
    true, p_seat_allocation, p_discount_percent, auth.uid()
  ) RETURNING id INTO v_vendor_id;

  SELECT id INTO v_uid FROM auth.users WHERE email = v_app.email;
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_app.email, extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_app.full_name),
      now(), now(), '', '', '', ''
    );
  END IF;

  INSERT INTO profiles (id, email, full_name, role, is_active, vendor_id)
  VALUES (v_uid, v_app.email, v_app.full_name, 'employee', true, v_vendor_id)
  ON CONFLICT (id) DO UPDATE SET vendor_id = v_vendor_id, is_active = true;

  UPDATE promoter_applications SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), vendor_id = v_vendor_id
  WHERE id = p_application_id;

  RETURN v_vendor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION super_admin_approve_promoter_application(UUID, TEXT, TEXT, INT, NUMERIC, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
