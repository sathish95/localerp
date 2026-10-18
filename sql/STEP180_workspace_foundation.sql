-- ============================================================
-- STEP180: Industry-Adaptive Platform — Phase 1 Workspace Foundation.
--
-- Fully additive. No existing table is altered, no existing RLS policy
-- is touched, no existing column changes type/nullability. Every
-- existing organization gets a `workspace_profiles` row seeded with
-- is_legacy_default = true / industry_profile_id = NULL /
-- enabled_module_keys = NULL / terminology_overrides = '{}' — the app
-- layer (src/context/WorkspaceContext.jsx) is wired into the provider
-- tree in this same phase but reads nothing anywhere else yet, so this
-- migration ships with ZERO observable behavior change for any existing
-- user. See docs/industry-adaptive/MIGRATION_PLAN.md for the full
-- rationale and docs/industry-adaptive/IMPLEMENTATION_PLAN.md for how
-- Phase 2+ will actually start reading these tables.
--
-- What this adds:
--   industry_profiles        — platform-wide lookup (not org-scoped),
--                               readable by every authenticated user,
--                               writable only by is_platform_super_admin().
--   business_types            — same posture, soft-ref to
--                               industry_profiles(id) (own-table ref,
--                               kept soft for reseed flexibility, not
--                               because industry_profiles might not
--                               exist — it's created two statements up).
--   operating_models          — same posture, no parent (flat lookup).
--   workspace_profiles        — ONE ROW PER ORGANIZATION. organization_id
--                               is a HARD FK to organizations(id) —
--                               deliberately matching STEP89's own
--                               modules.organization_id and STEP168's
--                               wiki_spaces.organization_id precedent
--                               (organizations is foundational and
--                               stable; nothing about this table needs
--                               the "table might not exist yet" soft-ref
--                               exception CLAUDE.md carves out for
--                               user_stories/project_tasks). industry_
--                               profile_id/business_type_id stay soft
--                               (plain UUID, no REFERENCES) since they
--                               point at brand-new lookup tables an
--                               admin may reseed/reorder later.
--   workspace_operating_models — many-to-many, workspace_profile_id
--                               soft-ref (same reasoning).
--
-- current_org_id() / is_platform_super_admin() are STEP89's existing
-- SECURITY DEFINER helpers — reused verbatim, not redefined.
-- ============================================================

-- ── industry_profiles ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS industry_profiles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  icon       TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── business_types ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_profile_id UUID NOT NULL, -- soft ref -> industry_profiles(id)
  key                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  sort_order          INT NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (industry_profile_id, key)
);
CREATE INDEX IF NOT EXISTS business_types_industry_idx ON business_types(industry_profile_id);

-- ── operating_models ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operating_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── workspace_profiles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL UNIQUE REFERENCES organizations(id),
  industry_profile_id    UUID, -- soft ref -> industry_profiles(id)
  business_type_id       UUID, -- soft ref -> business_types(id)
  is_legacy_default      BOOLEAN NOT NULL DEFAULT true,
  enabled_module_keys    JSONB, -- NULL = no override, defer entirely to existing modules/module_role_visibility
  terminology_overrides  JSONB NOT NULL DEFAULT '{}',
  onboarding_completed_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS workspace_profiles_updated_at ON workspace_profiles;
CREATE TRIGGER workspace_profiles_updated_at BEFORE UPDATE ON workspace_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── workspace_operating_models ───────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_operating_models (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_profile_id UUID NOT NULL, -- soft ref -> workspace_profiles(id)
  operating_model_id   UUID NOT NULL, -- soft ref -> operating_models(id)
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_profile_id, operating_model_id)
);
CREATE INDEX IF NOT EXISTS workspace_operating_models_wp_idx ON workspace_operating_models(workspace_profile_id);

-- ── seed lookup data ─────────────────────────────────────────
INSERT INTO industry_profiles (key, name, icon, sort_order) VALUES
  ('construction',       'Construction',          'HardHat',       10),
  ('manufacturing',       'Manufacturing',         'Factory',       20),
  ('it_software',         'IT & Software',         'Code2',         30),
  ('professional_services','Professional Services','Briefcase',     40),
  ('facility_management', 'Facility Management',   'Building2',     50),
  ('security',            'Security',              'ShieldCheck',   60),
  ('retail',              'Retail',                'Store',         70),
  ('healthcare',          'Healthcare',             'HeartPulse',    80),
  ('hospitality',         'Hospitality',            'BedDouble',     90),
  ('logistics',           'Logistics',              'Truck',        100),
  ('warehousing',         'Warehousing',            'Warehouse',    110),
  ('field_service',       'Field Service',          'Wrench',       120),
  ('maintenance',         'Maintenance',            'Settings2',    130),
  ('agriculture',         'Agriculture',            'Sprout',       140),
  ('mining',              'Mining',                 'Mountain',     150),
  ('education',           'Education',              'GraduationCap',160),
  ('cleaning_services',   'Cleaning Services',      'Sparkles',     170),
  ('other',               'Other',                  'MoreHorizontal',999)
ON CONFLICT (key) DO NOTHING;

INSERT INTO business_types (industry_profile_id, key, name, sort_order)
SELECT ip.id, bt.key, bt.name, bt.sort_order
FROM industry_profiles ip
JOIN (VALUES
  ('construction', 'general_contractor',   'General Contractor',    10),
  ('construction', 'civil_contractor',      'Civil Contractor',      20),
  ('construction', 'electrical_contractor', 'Electrical Contractor', 30),
  ('construction', 'plumbing_contractor',   'Plumbing Contractor',   40),
  ('construction', 'interior_contractor',   'Interior Contractor',   50),
  ('construction', 'infrastructure',        'Infrastructure',        60),
  ('construction', 'real_estate_developer', 'Real Estate Developer', 70),
  ('construction', 'other',                 'Other',                999),

  ('manufacturing', 'automotive', 'Automotive',  10),
  ('manufacturing', 'electronics', 'Electronics', 20),
  ('manufacturing', 'food',        'Food',        30),
  ('manufacturing', 'textile',     'Textile',     40),
  ('manufacturing', 'machinery',   'Machinery',   50),
  ('manufacturing', 'chemical',    'Chemical',    60),
  ('manufacturing', 'fmcg',        'FMCG',        70),
  ('manufacturing', 'other',       'Other',       999),

  ('it_software', 'software_product', 'Software Product', 10),
  ('it_software', 'it_services',      'IT Services',       20),
  ('it_software', 'saas',             'SaaS',              30),
  ('it_software', 'consulting',       'Consulting',        40),
  ('it_software', 'managed_services', 'Managed Services',  50),
  ('it_software', 'other',            'Other',             999)
) AS bt(industry_key, key, name, sort_order) ON bt.industry_key = ip.key
ON CONFLICT (industry_profile_id, key) DO NOTHING;

INSERT INTO operating_models (key, name, description, sort_order) VALUES
  ('projects',            'Projects',             'Work organized as time-bound projects with budgets and milestones', 10),
  ('daily_tasks',         'Daily Tasks',           'Ad-hoc or recurring tasks not tied to a project',                    20),
  ('shifts',              'Shifts',                'Workforce scheduled in shifts/rosters',                              30),
  ('work_orders',         'Work Orders',           'Discrete work orders raised against clients or assets',              40),
  ('field_service',       'Field Service',         'Technicians dispatched to client/site locations',                    50),
  ('production',          'Production',            'Manufacturing/production-line work',                                60),
  ('client_service',      'Client Service',        'Ongoing service delivery to named clients',                         70),
  ('recurring_operations','Recurring Operations',  'Repeating operational checklists (opening/closing, patrols, etc.)',100)
ON CONFLICT (key) DO NOTHING;

-- ── seed a legacy-default workspace_profiles row for every existing org ──
INSERT INTO workspace_profiles (organization_id, industry_profile_id, business_type_id, is_legacy_default, enabled_module_keys, terminology_overrides)
SELECT o.id, NULL, NULL, true, NULL, '{}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM workspace_profiles wp WHERE wp.organization_id = o.id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE industry_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_types            ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_models          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_operating_models ENABLE ROW LEVEL SECURITY;

-- Lookup tables: readable by any authenticated user, writable only by
-- the platform super admin (mirrors organizations_write in STEP89).
DROP POLICY IF EXISTS industry_profiles_select ON industry_profiles;
DROP POLICY IF EXISTS industry_profiles_write  ON industry_profiles;
CREATE POLICY industry_profiles_select ON industry_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY industry_profiles_write ON industry_profiles FOR ALL USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);

DROP POLICY IF EXISTS business_types_select ON business_types;
DROP POLICY IF EXISTS business_types_write  ON business_types;
CREATE POLICY business_types_select ON business_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY business_types_write ON business_types FOR ALL USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);

DROP POLICY IF EXISTS operating_models_select ON operating_models;
DROP POLICY IF EXISTS operating_models_write  ON operating_models;
CREATE POLICY operating_models_select ON operating_models FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY operating_models_write ON operating_models FOR ALL USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);

-- workspace_profiles: org-scoped select, admin/ceo (or platform super
-- admin) write — mirrors STEP91's modules_update/modules_insert exactly.
DROP POLICY IF EXISTS workspace_profiles_select ON workspace_profiles;
DROP POLICY IF EXISTS workspace_profiles_write  ON workspace_profiles;
CREATE POLICY workspace_profiles_select ON workspace_profiles FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY workspace_profiles_write ON workspace_profiles FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

-- workspace_operating_models: scoped via its parent workspace_profiles row.
DROP POLICY IF EXISTS workspace_operating_models_select ON workspace_operating_models;
DROP POLICY IF EXISTS workspace_operating_models_write  ON workspace_operating_models;
CREATE POLICY workspace_operating_models_select ON workspace_operating_models FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM workspace_profiles wp
    WHERE wp.id = workspace_profile_id AND (wp.organization_id = current_org_id() OR is_platform_super_admin())
  )
);
CREATE POLICY workspace_operating_models_write ON workspace_operating_models FOR ALL USING (
  is_platform_super_admin() OR EXISTS (
    SELECT 1 FROM workspace_profiles wp
    WHERE wp.id = workspace_profile_id AND wp.organization_id = current_org_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR EXISTS (
    SELECT 1 FROM workspace_profiles wp
    WHERE wp.id = workspace_profile_id AND wp.organization_id = current_org_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.industry_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_models TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_operating_models TO authenticated;

NOTIFY pgrst, 'reload schema';
