-- ============================================================================
-- STEP159_rebuild_after_wipe.sql
-- Emergency reconstruction after STEP158's TRUNCATE ... CASCADE wiped
-- profiles, organizations, roles and every org-scoped table.
-- Only auth.users (40 accounts), billing_plans (4) and permissions (25)
-- survived.
--
-- Run in the Supabase SQL Editor (runs as postgres -> bypasses RLS).
-- This restores APP ACCESS only. All business data is gone and must be
-- re-entered. See the checklist at the bottom for the remaining config.
-- ============================================================================
BEGIN;

-- 1. Built-in roles. profiles.role is a FK -> roles(role_key)
--    (profiles_role_fkey, STEP42), so roles MUST exist before any profile
--    row can be inserted. Values/colours copied verbatim from STEP42.
INSERT INTO roles (role_key, label, is_system, color) VALUES
  ('admin',            'Admin',            true, '#7c3aed'),
  ('ceo',              'CEO',              true, '#dc2626'),
  ('manager',          'Manager',          true, '#0284c7'),
  ('finance',          'Finance',          true, '#059669'),
  ('hr',               'HR',               true, '#0891b2'),
  ('employee',         'Employee',         true, '#d97706'),
  ('department_head',  'Department Head',  true, '#7c3aed'),
  ('procurement_lead', 'Procurement Lead', true, '#0d9488'),
  ('pm',               'PM',               true, '#2563eb'),
  ('cto',              'CTO',              true, '#be185d'),
  ('field_technician', 'Field Technician', true, '#65a30d')
ON CONFLICT (role_key) DO NOTHING;

-- 2. The organization. plan_key has DEFAULT 'free' and a FK to
--    billing_plans(key); billing_plans survived, and 'free' is the schema
--    default, so the default applies cleanly. If this INSERT fails on
--    plan_key, run  SELECT key FROM billing_plans;  and set plan_key
--    explicitly to one of those.
INSERT INTO organizations (slug, name, is_active)
VALUES ('thingsalive', 'ThingsAlive NeoX', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. One profile per surviving auth user.
--    pixlagroup@gmail.com  -> org admin + platform super admin
--    everyone else         -> employee, active (re-assign real roles later
--                             from the Users page)
INSERT INTO profiles (id, email, full_name, role, is_active, is_super_admin, organization_id)
SELECT
  u.id,
  u.email,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)),
  CASE WHEN lower(u.email) = 'pixlagroup@gmail.com' THEN 'admin' ELSE 'employee' END,
  true,
  lower(u.email) = 'pixlagroup@gmail.com',
  (SELECT id FROM organizations WHERE slug = 'thingsalive')
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  role            = EXCLUDED.role,
  is_active       = true,
  is_super_admin  = EXCLUDED.is_super_admin;

-- 4. Stamp the org creator now that the admin profile exists.
UPDATE organizations o
SET created_by = (SELECT id FROM profiles WHERE lower(email) = 'pixlagroup@gmail.com')
WHERE o.slug = 'thingsalive' AND o.created_by IS NULL;

-- verify before commit
SELECT 'organizations' t, count(*) n FROM organizations
UNION ALL SELECT 'roles',    count(*) FROM roles
UNION ALL SELECT 'profiles', count(*) FROM profiles;

COMMIT;

-- ============================================================================
-- AFTER THIS RUNS
--   1. Clear the browser session:  localStorage.clear(); location.href='/login'
--   2. Log in as pixlagroup@gmail.com — the app should open (admin bypasses
--      the module/nav RLS; an empty `modules` table means everything shows).
--
-- STILL TO REBUILD (all empty, none block login):
--   - departments                      -> Settings / Users UI
--   - user roles for the other 39      -> Users page (all reset to employee)
--   - modules + module_role_visibility -> re-run sql/STEP112_nav_role_visibility_seed.sql
--                                         (optional; empty = all visible)
--   - document_settings                -> Settings -> GST & Document Settings
--                                         (needed for proposal / invoice PDFs)
--   - sequences (EXP/PO/INV/AST nums)  -> re-run the step that seeds them;
--                                         nextNum() has a fallback meanwhile
--   - approval_chains / _steps         -> sql/SEED_approval_chains.sql
--   - billing subscription / module allocations -> super-admin console / app
--   - every other config table you had populated
-- ============================================================================
