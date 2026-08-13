-- ============================================================
-- STEP143: Scenario Management Platform — core entities.
-- Scenario Center Phase 2/19. Additive only — no existing table is
-- altered. Same conventions audited across this codebase: every table
-- carries organization_id defaulted to current_org_id(), permissive
-- org-scoped SELECT, role/permission-gated WRITE.
--
-- scenarios = the parent record (identity, ownership, objective).
-- scenario_versions = where all real content + lifecycle STATE lives —
-- a scenario's "current state" is just its latest version's state.
-- Reforecasting (Phase 14) creates a new version with parent_version_id
-- set, never mutates an executed version.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_templates (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name            TEXT        NOT NULL,
  category        TEXT        NOT NULL DEFAULT 'general',
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version         INT         NOT NULL DEFAULT 1,
  sections        JSONB       NOT NULL DEFAULT '[]', -- ordered [{key,label,sort_order}]
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_templates_org_idx ON scenario_templates(organization_id);

CREATE TABLE IF NOT EXISTS scenario_template_variables (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id   UUID        NOT NULL REFERENCES scenario_templates(id) ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  data_type     TEXT        NOT NULL DEFAULT 'number' CHECK (data_type IN ('number', 'percent', 'currency', 'text', 'boolean', 'date')),
  default_value TEXT,
  formula       TEXT, -- optional derived-value expression, evaluated client-side by the simulation engine
  sort_order    INT         NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name            TEXT        NOT NULL,
  code            TEXT,
  objective       TEXT,
  category        TEXT        NOT NULL DEFAULT 'general',
  template_id     UUID        REFERENCES scenario_templates(id),
  created_by      UUID        REFERENCES profiles(id),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenarios_org_idx ON scenarios(organization_id);
CREATE INDEX IF NOT EXISTS scenarios_created_by_idx ON scenarios(created_by);

CREATE TABLE IF NOT EXISTS scenario_versions (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_id        UUID        NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  version_number     INT         NOT NULL,
  parent_version_id  UUID        REFERENCES scenario_versions(id),
  status             TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft', 'simulated', 'submitted', 'under_review', 'changes_requested',
                        'approved', 'rejected', 'executed', 'superseded'
                      )),
  -- wizard content (Phases 5/6): context/assumptions/resources/finance/risks are
  -- free-form JSON per-section rather than dozens of narrow columns — mirrors
  -- award_workflow_steps' own config JSONB convention for the same reason
  -- (section shape varies by template, a fixed column set can't).
  context         JSONB       NOT NULL DEFAULT '{}',
  assumptions     JSONB       NOT NULL DEFAULT '{}',
  start_date      DATE,
  end_date        DATE,
  is_active_read  BOOLEAN     NOT NULL DEFAULT true, -- soft "still relevant" flag, distinct from lifecycle status
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scenario_id, version_number)
);
CREATE INDEX IF NOT EXISTS scenario_versions_scenario_idx ON scenario_versions(scenario_id);
CREATE INDEX IF NOT EXISTS scenario_versions_org_idx ON scenario_versions(organization_id);
CREATE INDEX IF NOT EXISTS scenario_versions_status_idx ON scenario_versions(status);

-- ── has_permission_or_role() — small shared helper so every scenario
-- RLS policy below reads consistently: pass a permission key that
-- might exist in the STEP125 matrix, plus a role fallback list for
-- orgs that haven't configured that key yet. Mirrors the existing
-- hasPermission()/role-boolean dual-check already used client-side in
-- TabVisibilityContext, enforced here at the database layer too rather
-- than only in the UI. Defined BEFORE any CREATE POLICY below — Postgres
-- must resolve this function at policy-creation time, not just at query
-- time, so it has to exist first in file order. ──
CREATE OR REPLACE FUNCTION has_permission_or_role(p_permission_key TEXT, p_fallback_roles TEXT[])
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM role_permissions WHERE role_key = v_role AND permission_key = p_permission_key) THEN
    RETURN true;
  END IF;
  RETURN v_role = ANY(p_fallback_roles);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION next_scenario_code() RETURNS TEXT AS $$
  SELECT 'SCN-' || to_char(now(), 'YYYY') || '-' || lpad((
    SELECT COALESCE(count(*), 0) + 1 FROM scenarios WHERE organization_id = current_org_id() AND created_at >= date_trunc('year', now())
  )::text, 4, '0')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE scenario_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_template_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_versions           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenario_templates_select ON scenario_templates;
DROP POLICY IF EXISTS scenario_templates_write  ON scenario_templates;
CREATE POLICY scenario_templates_select ON scenario_templates FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_templates_write ON scenario_templates FOR ALL USING (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_TEMPLATE_MANAGE', ARRAY['admin','ceo'])
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_TEMPLATE_MANAGE', ARRAY['admin','ceo'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_templates TO authenticated;

DROP POLICY IF EXISTS scenario_template_variables_select ON scenario_template_variables;
DROP POLICY IF EXISTS scenario_template_variables_write  ON scenario_template_variables;
CREATE POLICY scenario_template_variables_select ON scenario_template_variables FOR SELECT USING (
  EXISTS (SELECT 1 FROM scenario_templates t WHERE t.id = template_id AND t.organization_id = current_org_id())
);
CREATE POLICY scenario_template_variables_write ON scenario_template_variables FOR ALL USING (
  EXISTS (SELECT 1 FROM scenario_templates t WHERE t.id = template_id AND t.organization_id = current_org_id())
  AND has_permission_or_role('SCENARIO_TEMPLATE_MANAGE', ARRAY['admin','ceo'])
) WITH CHECK (
  EXISTS (SELECT 1 FROM scenario_templates t WHERE t.id = template_id AND t.organization_id = current_org_id())
  AND has_permission_or_role('SCENARIO_TEMPLATE_MANAGE', ARRAY['admin','ceo'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_template_variables TO authenticated;

DROP POLICY IF EXISTS scenarios_select ON scenarios;
DROP POLICY IF EXISTS scenarios_write  ON scenarios;
CREATE POLICY scenarios_select ON scenarios FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenarios_write ON scenarios FOR ALL USING (
  organization_id = current_org_id()
  AND (created_by = auth.uid() OR has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo']))
) WITH CHECK (
  organization_id = current_org_id()
  AND has_permission_or_role('SCENARIO_CREATE', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;

DROP POLICY IF EXISTS scenario_versions_select ON scenario_versions;
DROP POLICY IF EXISTS scenario_versions_write  ON scenario_versions;
CREATE POLICY scenario_versions_select ON scenario_versions FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_versions_write ON scenario_versions FOR ALL USING (
  organization_id = current_org_id()
  AND (created_by = auth.uid() OR has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo']))
) WITH CHECK (
  organization_id = current_org_id()
  AND (created_by = auth.uid() OR has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance']))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_versions TO authenticated;

NOTIFY pgrst, 'reload schema';
