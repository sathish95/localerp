-- ============================================================
-- STEP110: Per-organization enable/disable for each AI capability
-- (Neo Task AI, BOM AI, Product Catalog AI, Task Actions — the real,
-- shipped features from STEP107-109's app-layer work). Same posture as
-- STEP43's module enablement: permissive SELECT (every member needs to
-- know what's on to render their own bubble), writes restricted to
-- admin/ceo of that org.
--
-- Absence of a row means "enabled" — the application layer treats a
-- missing (organization_id, capability_key) row as the default-on state,
-- so this table only ever needs to store the exceptions (orgs that
-- turned something off), not a row per capability per org up front.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_capability_settings (
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  capability_key  TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  updated_by      UUID        REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (organization_id, capability_key)
);

DROP TRIGGER IF EXISTS ai_capability_settings_updated_at ON ai_capability_settings;
CREATE TRIGGER ai_capability_settings_updated_at BEFORE UPDATE ON ai_capability_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE ai_capability_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_capability_settings_select ON ai_capability_settings;
DROP POLICY IF EXISTS ai_capability_settings_write  ON ai_capability_settings;

CREATE POLICY ai_capability_settings_select ON ai_capability_settings FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY ai_capability_settings_write ON ai_capability_settings FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_capability_settings TO authenticated;

NOTIFY pgrst, 'reload schema';
