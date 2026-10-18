-- ============================================================
-- STEP196: Fix "new employee doesn't show up" — admin-created users were
-- silently landing in the WRONG organization.
--
-- ROOT CAUSE: adminCreateUser() (src/lib/supabase.js) calls
-- supabase.auth.signUp() passing only {full_name, role} as metadata — no
-- org_mode. The handle_new_user() trigger (STEP181, and every version
-- before it) only knows two real branches: org_mode='create' (spin up a
-- brand new org) and org_mode='join' (a valid invite code). Anything
-- else — exactly this case — falls into its ELSE branch:
--     SELECT id INTO v_org_id FROM organizations WHERE slug = 'default-org'
-- i.e. the new profile gets organization_id = the 'default-org' row, NOT
-- the admin's actual organization. The follow-up client-side
-- `.update(payload)` call (UsersPage.jsx / ExcelImport.jsx, setting
-- department/phone/designation/etc.) then silently affects ZERO rows,
-- because the "open" RLS policy's USING clause requires
-- organization_id = current_org_id() — which never matches a row still
-- sitting in default-org — and Supabase reports that as success (0 rows
-- updated, no error). Net effect: the new employee is real, but invisible
-- in User Management (wrong org) and missing every field beyond
-- full_name/role (the two the trigger itself already sets correctly from
-- signup metadata).
--
-- FIX — a SECURITY DEFINER RPC the client now calls right after
-- signUp(), instead of the plain `.update()`:
--   - Reassigns organization_id to the CALLER's own org
--   - ...but ONLY if the target's current organization_id is NULL or is
--     'default-org' — so this can't be used to yank an already-correctly-
--     assigned user out of a different real organization.
--   - Applies the rest of the profile fields in the same call.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_finalize_new_profile(
  p_user_id UUID,
  p_designation TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_department_id UUID DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_reporting_manager_id UUID DEFAULT NULL,
  p_employment_type TEXT DEFAULT NULL,
  p_default_weekly_capacity_hours NUMERIC DEFAULT NULL,
  p_date_joined DATE DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_caller_org UUID;
  v_target_org UUID;
  v_default_org UUID;
BEGIN
  SELECT organization_id INTO v_caller_org
  FROM profiles WHERE id = auth.uid();

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Your own account has no organization set — cannot assign one to another user';
  END IF;

  SELECT id INTO v_default_org FROM organizations WHERE slug = 'default-org';
  SELECT organization_id INTO v_target_org FROM profiles WHERE id = p_user_id;

  IF v_target_org IS NOT NULL AND v_target_org != v_caller_org AND v_target_org != v_default_org THEN
    RAISE EXCEPTION 'This user already belongs to a different organization — refusing to reassign';
  END IF;

  UPDATE profiles SET
    organization_id = v_caller_org,
    designation = COALESCE(p_designation, designation),
    phone = COALESCE(p_phone, phone),
    department_id = COALESCE(p_department_id, department_id),
    is_active = COALESCE(p_is_active, is_active),
    reporting_manager_id = COALESCE(p_reporting_manager_id, reporting_manager_id),
    employment_type = COALESCE(p_employment_type, employment_type),
    default_weekly_capacity_hours = COALESCE(p_default_weekly_capacity_hours, default_weekly_capacity_hours),
    date_joined = COALESCE(p_date_joined, date_joined)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION admin_finalize_new_profile(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, NUMERIC, DATE) TO authenticated;

-- ── ONE-OFF REPAIR: find whoever is already stuck in default-org ──
-- Run this SELECT first to see who's affected (very likely includes the
-- employee you just created):
--   SELECT p.id, p.full_name, p.email, p.role, p.created_at
--   FROM profiles p JOIN organizations o ON o.id = p.organization_id
--   WHERE o.slug = 'default-org'
--   ORDER BY p.created_at DESC;
--
-- Then move a specific person into your real org (replace the email and
-- slug below — 'thingsalive' matches every other script in this repo):
--   UPDATE profiles SET organization_id = (SELECT id FROM organizations WHERE slug = 'thingsalive')
--   WHERE email = 'the-new-employees-email@example.com';

NOTIFY pgrst, 'reload schema';
