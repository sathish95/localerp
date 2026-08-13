-- ============================================================
-- STEP138: Self-serve "Become a Promoter" application flow — a public,
-- unauthenticated form on the landing page submits a pending
-- application; a super admin reviews it and, on approval, sets the
-- seat allocation + discount (and optionally commission) right there,
-- which creates the vendor row AND its login in one atomic call. Only
-- after approval can that person actually sign in and start promoting
-- — nothing in the public submission path grants access to anything.
-- ============================================================

CREATE TABLE IF NOT EXISTS promoter_applications (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name     TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  company_name  TEXT,
  message       TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   UUID        REFERENCES profiles(id),
  reviewed_at   TIMESTAMPTZ,
  vendor_id     UUID        REFERENCES referral_vendors(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE promoter_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promoter_applications_insert ON promoter_applications;
DROP POLICY IF EXISTS promoter_applications_select ON promoter_applications;
DROP POLICY IF EXISTS promoter_applications_update ON promoter_applications;

-- Public submission — WITH CHECK pins every reviewer-only column to its
-- default so a crafted request can't insert a pre-approved row.
CREATE POLICY promoter_applications_insert ON promoter_applications FOR INSERT WITH CHECK (
  status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND vendor_id IS NULL
);
GRANT INSERT ON public.promoter_applications TO anon, authenticated;

-- Contains PII (email, phone) — platform-internal only, never an
-- applicant's own read (they don't have an account yet to read as).
CREATE POLICY promoter_applications_select ON promoter_applications FOR SELECT USING (is_platform_super_admin());
CREATE POLICY promoter_applications_update ON promoter_applications FOR UPDATE USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, UPDATE ON public.promoter_applications TO authenticated;

-- ── super_admin_approve_promoter_application() — creates the vendor
-- row AND its login (same direct-auth.users technique as STEP130/136,
-- extensions.crypt/gen_salt since this project keeps pgcrypto in the
-- extensions schema, not public) in one atomic call, then marks the
-- application approved and links the new vendor. ──
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

CREATE OR REPLACE FUNCTION super_admin_reject_promoter_application(p_application_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE promoter_applications SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_application_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_reject_promoter_application(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
