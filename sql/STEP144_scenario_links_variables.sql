-- ============================================================
-- STEP144: Universal Link Picker backing tables (Phase 6) + variables/
-- overrides the simulation engine reads (Phase 9).
--
-- scenario_links uses a soft polymorphic reference (linked_type +
-- linked_id, plain UUID, no hard FK) — CLAUDE.md's own stated
-- convention for referencing a table that varies by row ("use soft FK
-- references when referencing tables that may not exist yet / vary").
-- Here it's not that the target table might not exist, it's that ONE
-- column needs to point at nine different tables depending on
-- linked_type — a hard FK can only ever point at one.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_links (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID       NOT NULL REFERENCES scenario_versions(id) ON DELETE CASCADE,
  linked_type        TEXT        NOT NULL CHECK (linked_type IN (
                        'project', 'customer', 'task', 'resource', 'budget',
                        'employee', 'vendor', 'contract', 'sales_opportunity'
                      )),
  linked_id          UUID        NOT NULL, -- soft ref — target table depends on linked_type
  link_mode          TEXT        NOT NULL DEFAULT 'live' CHECK (link_mode IN ('live', 'snapshot')),
  snapshot           JSONB, -- populated when link_mode='snapshot' — the linked record's values at link time, frozen
  created_by         UUID        REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scenario_version_id, linked_type, linked_id)
);
CREATE INDEX IF NOT EXISTS scenario_links_version_idx ON scenario_links(scenario_version_id);
CREATE INDEX IF NOT EXISTS scenario_links_target_idx ON scenario_links(linked_type, linked_id);

CREATE TABLE IF NOT EXISTS scenario_variables (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID        NOT NULL REFERENCES scenario_versions(id) ON DELETE CASCADE,
  key                 TEXT        NOT NULL,
  label               TEXT        NOT NULL,
  data_type           TEXT        NOT NULL DEFAULT 'number' CHECK (data_type IN ('number', 'percent', 'currency', 'text', 'boolean', 'date')),
  value               TEXT,
  sort_order          INT         NOT NULL DEFAULT 0,
  UNIQUE (scenario_version_id, key)
);
CREATE INDEX IF NOT EXISTS scenario_variables_version_idx ON scenario_variables(scenario_version_id);

-- Overrides are deltas applied ON TOP of a linked record's baseline
-- value, read by the simulation engine — never written back to the
-- linked record itself. e.g. {field:'budget_amount', adjustment_type:'percent', adjustment_value:10}
-- means "simulate this budget as if it were 10% higher," full stop.
CREATE TABLE IF NOT EXISTS scenario_overrides (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID        NOT NULL REFERENCES scenario_versions(id) ON DELETE CASCADE,
  scenario_link_id    UUID        REFERENCES scenario_links(id) ON DELETE CASCADE, -- null = applies globally, not to one link
  field               TEXT        NOT NULL,
  adjustment_type     TEXT        NOT NULL DEFAULT 'percent' CHECK (adjustment_type IN ('percent', 'flat', 'absolute')),
  adjustment_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  note                TEXT,
  created_by          UUID        REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_overrides_version_idx ON scenario_overrides(scenario_version_id);

ALTER TABLE scenario_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenario_links_select ON scenario_links;
DROP POLICY IF EXISTS scenario_links_write  ON scenario_links;
CREATE POLICY scenario_links_select ON scenario_links FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_links_write ON scenario_links FOR ALL USING (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_links TO authenticated;

DROP POLICY IF EXISTS scenario_variables_select ON scenario_variables;
DROP POLICY IF EXISTS scenario_variables_write  ON scenario_variables;
CREATE POLICY scenario_variables_select ON scenario_variables FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_variables_write ON scenario_variables FOR ALL USING (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_variables TO authenticated;

DROP POLICY IF EXISTS scenario_overrides_select ON scenario_overrides;
DROP POLICY IF EXISTS scenario_overrides_write  ON scenario_overrides;
CREATE POLICY scenario_overrides_select ON scenario_overrides FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_overrides_write ON scenario_overrides FOR ALL USING (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_overrides TO authenticated;

NOTIFY pgrst, 'reload schema';
