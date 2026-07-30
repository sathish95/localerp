-- ============================================================
-- STEP64: Project planned-budget categories — the schema the Proposal
-- Module's "convert to project" step actually needs, since no genuine
-- "Budget Wizard" with a hardware/software/resource/misc/contingency
-- breakdown exists in this codebase today (only a free-text `budgets`
-- .category, three actual-cost-entry tables — project_hardware_costs/
-- project_software_costs/project_support_costs — and a client-only
-- localStorage markup calculator on ProjectsPage). This table is the
-- missing "planned" side, giving a real planned-vs-actual comparison
-- against those existing actual-cost tables as a side benefit.
--
-- planned_erp_cost is its own category (not folded into misc) per
-- stakeholder decision — ERP Integration is called out as a major cost
-- driver and deserves independent tracking/traceability.
--
-- proposal_budget_category_map makes the proposal-category → budget-
-- category mapping a configurable table (per this module's own
-- non-functional requirement), not hardcoded in application logic —
-- src/lib/proposalConvert.js reads this table rather than switch/casing
-- category strings itself.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_planned_budget (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id          UUID          NOT NULL,   -- soft ref -> projects
  category            TEXT          NOT NULL CHECK (category IN (
                        'planned_resource_cost','planned_hardware_cost','planned_software_cost',
                        'planned_erp_cost','planned_misc_cost','planned_contingency_cost'
                      )),
  planned_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  source              TEXT          NOT NULL DEFAULT 'manual' CHECK (source IN ('proposal','manual')),
  source_proposal_id  UUID,          -- soft ref -> proposals, set when source = 'proposal'
  notes               TEXT,
  created_by          UUID          REFERENCES profiles(id),
  created_at          TIMESTAMPTZ   DEFAULT now(),
  updated_at          TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(project_id, category)
);
CREATE INDEX IF NOT EXISTS project_planned_budget_project_idx  ON project_planned_budget(project_id);
CREATE INDEX IF NOT EXISTS project_planned_budget_proposal_idx ON project_planned_budget(source_proposal_id);

DROP TRIGGER IF EXISTS project_planned_budget_updated_at ON project_planned_budget;
CREATE TRIGGER project_planned_budget_updated_at BEFORE UPDATE ON project_planned_budget
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS proposal_budget_category_map (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_category  TEXT NOT NULL UNIQUE CHECK (proposal_category IN (
                       'Application Development','Firmware Development','Hardware Design & Production',
                       'ERP Integration','Hardware','Software/SaaS/Third-Party','Miscellaneous'
                     )),
  budget_category    TEXT NOT NULL CHECK (budget_category IN (
                       'planned_resource_cost','planned_hardware_cost','planned_software_cost',
                       'planned_erp_cost','planned_misc_cost','planned_contingency_cost'
                     ))
);

INSERT INTO proposal_budget_category_map (proposal_category, budget_category) VALUES
  ('Application Development',        'planned_resource_cost'),
  ('Firmware Development',           'planned_resource_cost'),
  ('Hardware Design & Production',   'planned_resource_cost'),
  ('ERP Integration',                'planned_erp_cost'),
  ('Hardware',                       'planned_hardware_cost'),
  ('Software/SaaS/Third-Party',      'planned_software_cost'),
  ('Miscellaneous',                  'planned_misc_cost')
ON CONFLICT (proposal_category) DO NOTHING;

ALTER TABLE project_planned_budget       ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_budget_category_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_planned_budget_select ON project_planned_budget;
DROP POLICY IF EXISTS project_planned_budget_write  ON project_planned_budget;
CREATE POLICY project_planned_budget_select ON project_planned_budget FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY project_planned_budget_write  ON project_planned_budget FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','pm','manager','department_head'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS proposal_budget_category_map_select ON proposal_budget_category_map;
DROP POLICY IF EXISTS proposal_budget_category_map_write  ON proposal_budget_category_map;
CREATE POLICY proposal_budget_category_map_select ON proposal_budget_category_map FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY proposal_budget_category_map_write  ON proposal_budget_category_map FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

NOTIFY pgrst, 'reload schema';
