-- ============================================================
-- STEP42: Dynamic Roles — converts profiles.role from a fixed Postgres
-- ENUM (user_role) into a proper table-backed system so an admin can
-- create/rename/delete custom roles from the UI with no SQL migration.
--
-- Why: every new built-in role so far (STEP25a, STEP37a) needed its own
-- standalone ALTER TYPE ... ADD VALUE script — Postgres won't let a
-- newly-added enum value be referenced in the same transaction that
-- added it. Converting to TEXT + a roles table eliminates that entirely.
--
-- The RLS expressions themselves need no rewriting: every role check
-- app-wide uses `role IN ('admin','ceo',...)` (string comparison), never
-- `role = 'x'::user_role` — TEXT vs enum makes no difference to IN (...).
-- BUT Postgres refuses ALTER COLUMN ... TYPE on a column that ANY policy
-- anywhere in the database depends on (not just policies on `profiles`
-- itself) — this app's dominant RLS pattern, `EXISTS (SELECT 1 FROM
-- profiles WHERE id=auth.uid() AND role IN (...))`, means dozens of
-- policies across many tables depend on profiles.role, including ones
-- not tracked in this repo's SQL files (some tables predate the tracked
-- migrations). So this script drops every policy that depends on
-- profiles.role (discovered live via pg_depend — the same catalog
-- Postgres itself consults to block the ALTER — not a manual list),
-- performs the type change, then recreates every dropped policy from
-- its captured definition, unchanged.
--
-- The old `user_role` enum type is left in place, unused — dropping it
-- isn't necessary and risks an error if anything undiscovered still
-- references it.
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  role_key   TEXT        PRIMARY KEY,           -- immutable once created — this is the FK target from profiles.role
  label      TEXT        NOT NULL,
  is_system  BOOLEAN     NOT NULL DEFAULT false, -- true for the 11 original built-in roles; blocks delete
  color      TEXT,                                -- hex, for UI badges; custom roles without one get a deterministic fallback client-side
  created_by UUID        REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the 11 built-in roles (colors mirror src/pages/UsersPage.jsx's
-- existing ROLE_CFG where that page already defines one; sensible new
-- ones picked for the 4 it didn't cover).
INSERT INTO roles (role_key, label, is_system, color) VALUES
  ('admin',            'Admin',            true, '#7c3aed'),
  ('ceo',               'CEO',               true, '#dc2626'),
  ('manager',           'Manager',           true, '#0284c7'),
  ('finance',           'Finance',           true, '#059669'),
  ('hr',                'HR',                true, '#0891b2'),
  ('employee',          'Employee',          true, '#d97706'),
  ('department_head',   'Department Head',  true, '#7c3aed'),
  ('procurement_lead',  'Procurement Lead',  true, '#0d9488'),
  ('pm',                 'PM',                true, '#2563eb'),
  ('cto',                'CTO',               true, '#be185d'),
  ('field_technician',  'Field Technician',  true, '#65a30d')
ON CONFLICT (role_key) DO NOTHING;

-- ── Capture + drop every policy (on any table) that depends on
-- profiles.role, so the ALTER below can proceed. ──
CREATE TABLE IF NOT EXISTS _role_policy_backup (
  schema_name TEXT, table_name TEXT, policy_name TEXT,
  cmd TEXT, permissive TEXT, roles TEXT[], qual TEXT, with_check TEXT
);
TRUNCATE _role_policy_backup;

INSERT INTO _role_policy_backup (schema_name, table_name, policy_name, cmd, permissive, roles, qual, with_check)
SELECT pp.schemaname, pp.tablename, pp.policyname, pp.cmd, pp.permissive, pp.roles, pp.qual, pp.with_check
FROM pg_policies pp
WHERE EXISTS (
  SELECT 1 FROM pg_depend d
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  JOIN pg_policy pol ON pol.oid = d.objid
  WHERE d.refobjid = 'public.profiles'::regclass
    AND a.attname = 'role'
    AND d.classid = 'pg_policy'::regclass
    AND pol.polrelid = (quote_ident(pp.schemaname) || '.' || quote_ident(pp.tablename))::regclass
    AND pol.polname = pp.policyname
);

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM _role_policy_backup LOOP
    RAISE NOTICE 'Dropping policy % on %.% (will be recreated below)', r.policy_name, r.schema_name, r.table_name;
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policy_name, r.schema_name, r.table_name);
  END LOOP;
END $$;

-- ── Convert profiles.role from the user_role enum to plain TEXT ──
ALTER TABLE profiles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE profiles ALTER COLUMN role TYPE TEXT USING role::TEXT;
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'employee';

-- FK validates cleanly since every value currently in profiles.role is
-- one of the 11 rows just seeded above.
ALTER TABLE profiles ADD CONSTRAINT profiles_role_fkey FOREIGN KEY (role) REFERENCES roles(role_key);

-- ── Recreate every policy captured above. Postgres deparses the
-- captured qual/with_check with the literal comparisons cast to the
-- column's ORIGINAL type baked in (e.g. 'admin'::user_role, even though
-- the source SQL just wrote 'admin') — replayed as-is against the new
-- TEXT column that fails with "operator does not exist: text =
-- user_role" (no implicit cast from the old enum to text). Stripping
-- the now-stale ::user_role casts leaves plain text literals, which is
-- exactly correct for the new column type — semantics unchanged. ──
DO $$
DECLARE
  r RECORD;
  roles_clause TEXT;
  clean_qual TEXT;
  clean_check TEXT;
  using_clause TEXT;
  check_clause TEXT;
BEGIN
  FOR r IN SELECT * FROM _role_policy_backup LOOP
    roles_clause := array_to_string(r.roles, ', ');
    clean_qual := regexp_replace(r.qual, '::user_role', '', 'g');
    clean_check := regexp_replace(r.with_check, '::user_role', '', 'g');
    using_clause := CASE WHEN clean_qual IS NOT NULL THEN format(' USING (%s)', clean_qual) ELSE '' END;
    check_clause := CASE WHEN clean_check IS NOT NULL THEN format(' WITH CHECK (%s)', clean_check) ELSE '' END;
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      r.policy_name, r.schema_name, r.table_name,
      r.permissive, r.cmd, roles_clause, using_clause, check_clause
    );
    RAISE NOTICE 'Recreated policy % on %.%', r.policy_name, r.schema_name, r.table_name;
  END LOOP;
END $$;

-- Backup table is kept (not dropped) purely as an audit trail of what
-- was touched — harmless to leave, safe to drop manually later:
--   DROP TABLE IF EXISTS _role_policy_backup;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
-- Permissive SELECT — role dropdowns/badges need this readable by anyone
-- authenticated. Writes restricted to admin/ceo, hardcoded (not
-- configurable) since this table bootstraps the permission system itself.
CREATE POLICY roles_select ON roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY roles_insert ON roles FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY roles_update ON roles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY roles_delete ON roles FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;

NOTIFY pgrst, 'reload schema';
