-- ============================================================
-- STEP161: Mobile app — module capability + per-org mobile config.
--
-- Two separate concerns, deliberately kept apart:
--
--  1. CAPABILITY (code-owned, global) — does a mobile screen even exist
--     for this module? That's a product fact, not an org setting. Lives
--     in mobile_module_capable_keys(); extend it with a one-line
--     follow-up migration each time a new mobile screen ships.
--
--  2. PREFERENCE (data, per-org) — an org admin wants to hide an
--     otherwise mobile-capable module from their mobile users, or raise
--     the role floor for it. Lives in mobile_module_config. Absence of a
--     row = "capable ⇒ shown" (default-on, same posture as the web
--     `modules` / `module_role_visibility` tables).
--
-- The actual resolution (purchased ∩ org-enabled ∩ role-visible ∩
-- allocated ∩ mobile-eligible) is get_effective_modules() in STEP162.
-- This file only defines the inputs it reads.
-- ============================================================

-- ── Capability: module keys with a built mobile screen (companion set) ──
-- Keep in sync with the mobile app's src/lib/modules.ts registry.
CREATE OR REPLACE FUNCTION mobile_module_capable_keys() RETURNS TEXT[] AS $$
  SELECT ARRAY[
    'dashboard',
    'org-home',
    'tasks',
    'expenses',
    'travel',
    'approvals',
    'it-helpdesk',
    'leave',
    'timesheet'
  ]::text[]
$$ LANGUAGE sql IMMUTABLE;

-- ── Coarse role ranking for mobile_module_config.min_role ──
-- Fine-grained per-screen allow-lists stay in the app; this is only the
-- optional "manager and above" style floor an admin can set per module.
CREATE OR REPLACE FUNCTION mobile_role_rank(p_role TEXT) RETURNS INT AS $$
  SELECT CASE p_role
    WHEN 'admin'            THEN 100
    WHEN 'ceo'              THEN 100
    WHEN 'cto'              THEN 90
    WHEN 'finance'          THEN 60
    WHEN 'hr'               THEN 60
    WHEN 'manager'          THEN 50
    WHEN 'department_head'  THEN 50
    WHEN 'procurement_lead' THEN 50
    WHEN 'pm'               THEN 50
    ELSE 10  -- employee, field_technician, custom/unknown roles
  END
$$ LANGUAGE sql IMMUTABLE;

-- The web "Mobile App" settings tab calls mobile_module_capable_keys()
-- directly to know which modules to show; grant it explicitly.
GRANT EXECUTE ON FUNCTION mobile_module_capable_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION mobile_role_rank(TEXT) TO authenticated;

-- ── Per-org preference override ──
CREATE TABLE IF NOT EXISTS mobile_module_config (
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  module_key      TEXT        NOT NULL,
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  min_role        TEXT,                         -- NULL = no extra floor beyond web role-visibility
  updated_by      UUID        REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (organization_id, module_key)
);

ALTER TABLE mobile_module_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_module_config_select ON mobile_module_config;
DROP POLICY IF EXISTS mobile_module_config_write  ON mobile_module_config;
-- Any org member reads (the mobile client + the resolver need it); only
-- admin/ceo writes — matches the app's isAdmin gate for settings screens.
CREATE POLICY mobile_module_config_select ON mobile_module_config FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY mobile_module_config_write ON mobile_module_config FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_module_config TO authenticated;

-- set_updated_at() is the shared trigger fn from STEP43.
DROP TRIGGER IF EXISTS mobile_module_config_updated_at ON mobile_module_config;
CREATE TRIGGER mobile_module_config_updated_at BEFORE UPDATE ON mobile_module_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

NOTIFY pgrst, 'reload schema';
