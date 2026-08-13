-- ============================================================
-- STEP156: Support Desk — "tag with project" toggle (Phase 2).
-- Platform-wide, not per-org — the same two-layer pattern this app
-- already uses for module visibility (CLAUDE.md: modules = company-wide
-- kill switch, module_role_visibility = per-role override, default
-- visible unless a row says otherwise), except here "company-wide"
-- really means platform-wide, since this setting lives on the Support
-- Desk Settings page alongside SLA/agents — a platform-super-admin
-- concern, not something each org's own admin configures for
-- themselves. Singleton-row shape mirrors platform_settings (STEP142).
-- ============================================================

CREATE TABLE IF NOT EXISTS support_settings (
  singleton            BOOLEAN     PRIMARY KEY DEFAULT true CHECK (singleton),
  project_tag_enabled  BOOLEAN     NOT NULL DEFAULT true,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  updated_by           UUID        REFERENCES profiles(id)
);
INSERT INTO support_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_project_tag_role_visibility (
  role_key TEXT    PRIMARY KEY,
  visible  BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE support_settings                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_project_tag_role_visibility     ENABLE ROW LEVEL SECURITY;

-- Every authenticated user needs to READ these (to know whether to show
-- the field on their own ticket form) — only platform staff can write.
DROP POLICY IF EXISTS support_settings_select ON support_settings;
DROP POLICY IF EXISTS support_settings_write  ON support_settings;
CREATE POLICY support_settings_select ON support_settings FOR SELECT USING (true);
CREATE POLICY support_settings_write ON support_settings FOR UPDATE USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, UPDATE ON public.support_settings TO authenticated;

DROP POLICY IF EXISTS support_project_tag_role_visibility_select ON support_project_tag_role_visibility;
DROP POLICY IF EXISTS support_project_tag_role_visibility_write  ON support_project_tag_role_visibility;
CREATE POLICY support_project_tag_role_visibility_select ON support_project_tag_role_visibility FOR SELECT USING (true);
CREATE POLICY support_project_tag_role_visibility_write ON support_project_tag_role_visibility FOR ALL USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_project_tag_role_visibility TO authenticated;

NOTIFY pgrst, 'reload schema';
