-- ============================================================
-- STEP68: Sales & Pre-Sales CRM — core org structure (Part 1 of the
-- module: Region, SalesRoleDefinition, SalesRepAssignment).
--
-- New roles (dynamic roles table, STEP42/STEP61 pattern — plain INSERT,
-- no ALTER TYPE): sales_rep, regional_sales_head, sales_head, sales_ops,
-- cmo. Existing finance/cto/ceo/admin are reused for their respective
-- Part 6 dashboard views; sales_lead (STEP61) stays scoped to the
-- Proposal Builder as today — this module's Sales Head/Sales Ops own
-- config instead.
--
-- No separate "employees" table exists anywhere in this codebase — every
-- module FKs an "employee" directly to profiles.id, so this module does
-- the same throughout (soft refs, per CLAUDE.md's guidance for tables
-- that may not exist yet / to avoid unwanted cascade).
-- ============================================================

INSERT INTO roles (role_key, label, is_system, color) VALUES
  ('sales_rep',           'Sales Rep',            true, '#0ea5e9'),
  ('regional_sales_head', 'Regional Sales Head',  true, '#0369a1'),
  ('sales_head',          'Sales Head',           true, '#1d4ed8'),
  ('sales_ops',           'Sales Ops',            true, '#7c3aed'),
  ('cmo',                 'CMO',                  true, '#db2777')
ON CONFLICT (role_key) DO NOTHING;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Regions — admin-configurable, optional hierarchy ──────────
CREATE TABLE IF NOT EXISTS sales_regions (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  region_name       TEXT          NOT NULL UNIQUE,
  parent_region_id  UUID,          -- soft ref -> sales_regions, nullable
  created_at        TIMESTAMPTZ   DEFAULT now()
);

INSERT INTO sales_regions (region_name) VALUES ('North'), ('South'), ('East'), ('West')
ON CONFLICT (region_name) DO NOTHING;

-- ── Sales role definitions — the Direction × Domain × Region matrix ──
CREATE TABLE IF NOT EXISTS sales_role_definitions (
  id          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  direction   TEXT          NOT NULL CHECK (direction IN ('Inbound','Outbound')),
  domain      TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  region_id   UUID          REFERENCES sales_regions(id),  -- nullable (some roles are domain-only, e.g. D2C online). Real FK (not soft) — sales_regions is created above in this same file, and src/lib/salesAdmin.js embeds it via PostgREST, which requires one.
  role_title  TEXT          NOT NULL,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_role_definitions_domain_idx ON sales_role_definitions(domain);
CREATE INDEX IF NOT EXISTS sales_role_definitions_region_idx ON sales_role_definitions(region_id);

-- ── Rep assignments — an employee can hold multiple role definitions ──
CREATE TABLE IF NOT EXISTS sales_rep_assignments (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id                UUID          NOT NULL REFERENCES profiles(id),  -- this app's "employee" — real FK, embedded via PostgREST in src/lib/salesAdmin.js
  sales_role_definition_id  UUID          NOT NULL REFERENCES sales_role_definitions(id),
  quota_target              NUMERIC(14,2),
  quota_currency            TEXT          DEFAULT 'INR',
  active_from               DATE          NOT NULL DEFAULT CURRENT_DATE,
  active_to                 DATE,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_rep_assignments_profile_idx ON sales_rep_assignments(profile_id);
CREATE INDEX IF NOT EXISTS sales_rep_assignments_role_def_idx ON sales_rep_assignments(sales_role_definition_id);

-- ── RLS — permissive SELECT (matches this codebase's dominant pattern),
-- writes gated to admin/ceo/sales_head/sales_ops. ──
ALTER TABLE sales_regions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_role_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_rep_assignments  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_regions','sales_role_definitions','sales_rep_assignments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_regions, public.sales_role_definitions, public.sales_rep_assignments TO authenticated;

NOTIFY pgrst, 'reload schema';
