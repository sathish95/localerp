-- ============================================================
-- STEP136: Demo data for the promoter dashboard — one vendor that is
-- BOTH a commission-earning partner AND a promoter with a seat pool,
-- referring the two STEP130 demo organizations (if present), with a
-- real commission ledger (one paid, one pending) so every part of the
-- dashboard has something to show.
--
-- LOGIN: promoter@growth.demo / Demo@12345 (same password convention as
-- STEP130's demo org accounts).
--
-- Idempotent: skipped entirely if a vendor with this code already
-- exists. Requires STEP134/STEP135 already applied (vendors table +
-- promoter columns), and picks up STEP130's demo orgs if they exist —
-- runs fine without them too, just with fewer referred orgs to show.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_vendor_id UUID;
  v_uid UUID;
  v_northwind_id UUID;
  v_aurora_id UUID;
  v_paid_order_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM referral_vendors WHERE code = 'GROWTH20') THEN
    RAISE NOTICE 'STEP136: promoter demo vendor already exists, skipping';
    RETURN;
  END IF;

  INSERT INTO referral_vendors (name, code, commission_type, commission_rate, is_active, is_promoter, promoter_seat_allocation, promoter_discount_percent)
  VALUES ('Growth Partners Co', 'GROWTH20', 'percent', 10, true, true, 50, 20)
  RETURNING id INTO v_vendor_id;

  -- ── Login (same direct-auth.users technique as STEP130 — see that
  -- file's header for the full rationale/caveats). ──
  SELECT id INTO v_uid FROM auth.users WHERE email = 'promoter@growth.demo';
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'promoter@growth.demo', extensions.crypt('Demo@12345', extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Growth Partners Co'),
      now(), now(), '', '', '', ''
    );
  END IF;

  INSERT INTO profiles (id, email, full_name, role, is_active, vendor_id)
  VALUES (v_uid, 'promoter@growth.demo', 'Growth Partners Co', 'employee', true, v_vendor_id)
  ON CONFLICT (id) DO UPDATE SET vendor_id = v_vendor_id, is_active = true;

  -- ── Tag STEP130's demo orgs to this promoter, if they exist. ──
  SELECT id INTO v_northwind_id FROM organizations WHERE slug = 'northwind-textiles';
  SELECT id INTO v_aurora_id FROM organizations WHERE slug = 'aurora-robotics';

  IF v_northwind_id IS NOT NULL THEN
    UPDATE organizations SET referred_by_vendor_id = v_vendor_id WHERE id = v_northwind_id;
  END IF;
  IF v_aurora_id IS NOT NULL THEN
    UPDATE organizations SET referred_by_vendor_id = v_vendor_id WHERE id = v_aurora_id;
  END IF;

  -- ── Commission ledger: one paid (linked to Northwind's existing paid
  -- order from STEP130, if present), one pending. ──
  IF v_northwind_id IS NOT NULL THEN
    SELECT id INTO v_paid_order_id FROM payment_orders WHERE organization_id = v_northwind_id AND status = 'paid' LIMIT 1;
    INSERT INTO vendor_commissions (vendor_id, organization_id, payment_order_id, amount, status, paid_at)
    VALUES (v_vendor_id, v_northwind_id, v_paid_order_id, 1499.90, 'paid', now() - interval '4 days');
  END IF;
  IF v_aurora_id IS NOT NULL THEN
    INSERT INTO vendor_commissions (vendor_id, organization_id, amount, status)
    VALUES (v_vendor_id, v_aurora_id, 499.90, 'pending');
  END IF;

  RAISE NOTICE 'STEP136: seeded promoter demo vendor % — login promoter@growth.demo / Demo@12345', v_vendor_id;
END $$;

NOTIFY pgrst, 'reload schema';
