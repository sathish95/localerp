-- ============================================================
-- STEP130: Two fully-populated demo organizations, one per every role,
-- for walking the end-to-end flow (org onboarding/billing state, role-
-- based access, module bundles, payment transactions, and — once
-- STEP122/STEP123 are re-run afterwards, see note at the bottom — the
-- full Performance Award lifecycle).
--
-- LOGIN — every seeded account uses the SAME password:
--     Demo@12345
-- Emails are <role>@<domain> — see the RAISE NOTICE block at the end
-- for the full list, or query:
--     SELECT email, role FROM profiles WHERE organization_id IN
--       (SELECT id FROM organizations WHERE slug IN ('northwind-textiles','aurora-robotics'));
--
-- HOW THIS WORKS — a note on the technique, not just the data:
-- This app has no server-side code that can call Supabase Auth's admin
-- "create user" API (no service-role key in the frontend, no custom
-- backend) — every account so far has been created through the real
-- signup/invite flow. For a from-scratch demo with 22 known-password
-- logins across two tenants, that flow is impractical to script, so
-- this migration inserts directly into auth.users (+ sets the standard
-- empty-string token columns that a NULL value is known to break
-- password-grant login on) rather than tokens columns being left NULL,
-- then upserts the matching `profiles` row itself rather than relying
-- on the handle_new_user() trigger's org-resolution branches (which
-- only understand 'create'/'join' org_mode, not "this exact org").
-- This bypasses Supabase Auth's own signup validation entirely — it is
-- the right call for throwaway demo data, never for real user
-- provisioning. It has NOT been exercised against every possible
-- Supabase/GoTrue schema version; if the auth.users INSERT below fails
-- on a column mismatch, the fallback is the app's own UI — Settings ->
-- Users -> "Bulk Add New Employees" — which goes through the real
-- supabase.auth.signUp() path and is guaranteed schema-compatible, just
-- slower for 22 accounts.
--
-- Two organizations, deliberately in different billing states so the
-- Billing tab / super-admin console / payment-provider restriction
-- (STEP129) all have something real to show:
--   Northwind Textiles  — plan 'pro',     billing_status 'active',   all
--                          3 gateways available, one paid + one pending order.
--   Aurora Robotics     — plan 'starter', billing_status 'trialing', only
--                          razorpay+cashfree allowed (stripe excluded, to
--                          demo the per-org allow-list), one failed + one
--                          pending order.
-- Every module bundle (STEP124) is activated for both, so nav isn't
-- gated behind add-on requests while exploring.
--
-- Each org gets one of every role (admin, ceo, manager, department_head,
-- finance, hr) plus 5 employees reporting to that org's manager — enough
-- direct reports for STEP123's award demo to populate all four
-- recommendation bands once re-run (see bottom note).
--
-- Idempotent at the org level: skipped entirely if the slug already
-- exists. Re-running is safe.
-- ============================================================

-- crypt()/gen_salt() (used below to hash the demo password) come from
-- pgcrypto — enabled by default on every Supabase project, but
-- explicit here rather than assumed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION _seed_demo_user(
  p_org_id UUID, p_email TEXT, p_full_name TEXT, p_role TEXT,
  p_dept_id UUID, p_manager_id UUID, p_designation TEXT
) RETURNS UUID AS $$
DECLARE
  v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = p_email;

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      p_email, crypt('Demo@12345', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'role', p_role),
      now(), now(), '', '', '', ''
    );
  END IF;

  -- Upsert rather than relying on the handle_new_user() trigger's own
  -- INSERT — that trigger only knows how to resolve an org via
  -- 'create'/'join' org_mode metadata, not "this specific org row",
  -- and its EXCEPTION WHEN OTHERS handler can silently swallow a
  -- failure without leaving any profiles row at all. This is correct
  -- either way: overwrite whatever (if anything) the trigger produced.
  INSERT INTO profiles (id, email, full_name, role, is_active, organization_id, department_id, reporting_manager_id, designation)
  VALUES (v_uid, p_email, p_full_name, p_role, true, p_org_id, p_dept_id, p_manager_id, p_designation)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true,
    organization_id = EXCLUDED.organization_id, department_id = EXCLUDED.department_id,
    reporting_manager_id = EXCLUDED.reporting_manager_id, designation = EXCLUDED.designation;

  RETURN v_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- extensions is appended (not just public) because Supabase installs
-- pgcrypto into a dedicated `extensions` schema, not `public` — crypt()/
-- gen_salt() above are unqualified calls that only resolve if that
-- schema is on the search_path.

CREATE OR REPLACE FUNCTION _seed_demo_org(
  p_org_name TEXT, p_slug TEXT, p_domain TEXT,
  p_plan_key TEXT, p_billing_status TEXT, p_trial_days INT, p_period_days INT,
  p_payment_provider TEXT, p_allowed_providers TEXT[],
  p_order_specs JSONB -- array of {provider, plan_key, amount, status, days_ago}
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
  v_dept_eng UUID; v_dept_ops UUID;
  v_admin_id UUID; v_ceo_id UUID; v_mgr_id UUID; v_depthead_id UUID; v_finance_id UUID; v_hr_id UUID;
  v_emp_id UUID;
  v_emp_names TEXT[] := ARRAY['Employee One','Employee Two','Employee Three','Employee Four','Employee Five'];
  v_emp_desigs TEXT[] := ARRAY['Software Engineer','Software Engineer II','QA Engineer','Product Analyst','Support Engineer'];
  o JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug) THEN
    RAISE NOTICE 'STEP130: demo org % already exists, skipping', p_slug;
    RETURN;
  END IF;

  INSERT INTO organizations (name, slug, plan_key, billing_status, trial_ends_at, current_period_end, payment_provider, allowed_payment_providers)
  VALUES (
    p_org_name, p_slug, p_plan_key, p_billing_status,
    CASE WHEN p_trial_days IS NOT NULL THEN now() + make_interval(days => p_trial_days) END,
    CASE WHEN p_period_days IS NOT NULL THEN now() + make_interval(days => p_period_days) END,
    p_payment_provider, p_allowed_providers
  ) RETURNING id INTO v_org_id;

  INSERT INTO departments (name, code, organization_id) VALUES (p_org_name || ' - Engineering', upper(replace(p_slug,'-','_')) || '_ENG', v_org_id) RETURNING id INTO v_dept_eng;
  INSERT INTO departments (name, code, organization_id) VALUES (p_org_name || ' - Finance & Ops', upper(replace(p_slug,'-','_')) || '_OPS', v_org_id) RETURNING id INTO v_dept_ops;

  v_ceo_id      := _seed_demo_user(v_org_id, 'ceo@'||p_domain,      'Priya Sharma',    'ceo',             NULL,        NULL,        'Chief Executive Officer');
  v_admin_id    := _seed_demo_user(v_org_id, 'admin@'||p_domain,    'Arjun Mehta',     'admin',           NULL,        NULL,        'Platform Administrator');
  v_depthead_id := _seed_demo_user(v_org_id, 'depthead@'||p_domain, 'Kavita Rao',      'department_head', v_dept_eng,  v_ceo_id,    'Head of Engineering');
  v_mgr_id      := _seed_demo_user(v_org_id, 'manager@'||p_domain,  'Rohan Verma',     'manager',         v_dept_eng,  v_depthead_id,'Engineering Manager');
  v_finance_id  := _seed_demo_user(v_org_id, 'finance@'||p_domain,  'Neha Kapoor',     'finance',         v_dept_ops,  v_ceo_id,    'Finance Lead');
  v_hr_id       := _seed_demo_user(v_org_id, 'hr@'||p_domain,       'Sanjay Gupta',    'hr',              v_dept_ops,  v_ceo_id,    'HR Manager');

  FOR i IN 1..5 LOOP
    v_emp_id := _seed_demo_user(v_org_id, 'employee'||i||'@'||p_domain, v_emp_names[i], 'employee', v_dept_eng, v_mgr_id, v_emp_desigs[i]);
  END LOOP;

  INSERT INTO organization_bundle_subscriptions (organization_id, bundle_key, status)
  SELECT v_org_id, key, 'active' FROM billing_bundles
  ON CONFLICT (organization_id, bundle_key) DO NOTHING;

  FOR o IN SELECT * FROM jsonb_array_elements(p_order_specs) LOOP
    INSERT INTO payment_orders (organization_id, provider, plan_key, billing_cycle, amount, currency, status, created_by, created_at, paid_at)
    VALUES (
      v_org_id, o->>'provider', o->>'plan_key', 'monthly', (o->>'amount')::numeric, 'INR', o->>'status', v_admin_id,
      now() - make_interval(days => (o->>'days_ago')::int),
      CASE WHEN o->>'status' = 'paid' THEN now() - make_interval(days => (o->>'days_ago')::int) END
    );
  END LOOP;

  RAISE NOTICE 'STEP130: seeded org % (%) with 11 users — password Demo@12345 for all', p_org_name, p_domain;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

SELECT _seed_demo_org(
  'Northwind Textiles', 'northwind-textiles', 'northwind.demo',
  'pro', 'active', NULL, 30,
  'razorpay', NULL,
  '[{"provider":"razorpay","plan_key":"pro","amount":14999,"status":"paid","days_ago":5},
    {"provider":"razorpay","plan_key":null,"amount":1490,"status":"created","days_ago":1}]'::jsonb
);

SELECT _seed_demo_org(
  'Aurora Robotics', 'aurora-robotics', 'aurora.demo',
  'starter', 'trialing', 10, NULL,
  NULL, ARRAY['razorpay','cashfree'],
  '[{"provider":"cashfree","plan_key":"starter","amount":4999,"status":"failed","days_ago":3},
    {"provider":"razorpay","plan_key":"starter","amount":4999,"status":"created","days_ago":0}]'::jsonb
);

DROP FUNCTION _seed_demo_org(TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT[], JSONB);
DROP FUNCTION _seed_demo_user(UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT);

DO $$
BEGIN
  RAISE NOTICE '=== STEP130 demo logins (password: Demo@12345 for every account) ===';
  RAISE NOTICE 'Northwind Textiles: ceo@northwind.demo, admin@northwind.demo, depthead@northwind.demo, manager@northwind.demo, finance@northwind.demo, hr@northwind.demo, employee1..5@northwind.demo';
  RAISE NOTICE 'Aurora Robotics:    ceo@aurora.demo, admin@aurora.demo, depthead@aurora.demo, manager@aurora.demo, finance@aurora.demo, hr@aurora.demo, employee1..5@aurora.demo';
  RAISE NOTICE 'Next: re-run STEP122 (certificate templates) then STEP123 (award demo) — both loop over every organization and are safe to re-run, and will now also populate the full award/certificate lifecycle for these two new orgs.';
END $$;

NOTIFY pgrst, 'reload schema';
