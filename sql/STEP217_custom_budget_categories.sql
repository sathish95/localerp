-- ============================================================
-- STEP217: custom Budget Categories, and pre-registering a Proposal
-- Category before any live proposal uses it.
--
-- STEP215 already let a custom Proposal Category be typed on any
-- proposal. This migration does the matching thing on the OTHER side of
-- the mapping: `budget_category` (in both proposal_budget_category_map
-- and project_planned_budget — the real destination table money lands in
-- on "Convert to Project") was still locked to the original 6 fixed
-- values. Both CHECKs are relaxed to non-blank, and a small per-org
-- catalog table (budget_category_catalog) gives custom budget categories
-- a real display label instead of a raw snake_case key, seeded with the
-- original 6 so they keep their existing labels.
--
-- Settings -> Proposal Budget Mapping can now also add a brand-new
-- Proposal Category mapping directly (via proposals.js's existing
-- upsertBudgetCategoryMapping — no schema change needed there, it already
-- accepted any category name) without that category existing on a live
-- proposal first — this migration is what makes the BUDGET side of that
-- pairing equally extensible.
-- ============================================================

ALTER TABLE proposal_budget_category_map DROP CONSTRAINT IF EXISTS proposal_budget_category_map_budget_category_check;
ALTER TABLE proposal_budget_category_map ADD CONSTRAINT proposal_budget_category_map_budget_category_notblank CHECK (length(trim(budget_category)) > 0);

ALTER TABLE project_planned_budget DROP CONSTRAINT IF EXISTS project_planned_budget_category_check;
ALTER TABLE project_planned_budget ADD CONSTRAINT project_planned_budget_category_notblank CHECK (length(trim(category)) > 0);

CREATE TABLE IF NOT EXISTS budget_category_catalog (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  key              TEXT          NOT NULL,   -- the actual value stored in budget_category / project_planned_budget.category
  label            TEXT          NOT NULL,
  is_custom        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(organization_id, key)
);

ALTER TABLE budget_category_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_category_catalog_select ON budget_category_catalog;
DROP POLICY IF EXISTS budget_category_catalog_write ON budget_category_catalog;
CREATE POLICY budget_category_catalog_select ON budget_category_catalog FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY budget_category_catalog_write ON budget_category_catalog FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

DO $$
DECLARE v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO budget_category_catalog (organization_id, key, label, is_custom) VALUES
      (v_org.id, 'planned_resource_cost',     'Resource / Labor', false),
      (v_org.id, 'planned_hardware_cost',      'Hardware', false),
      (v_org.id, 'planned_software_cost',      'Software', false),
      (v_org.id, 'planned_erp_cost',            'ERP Integration', false),
      (v_org.id, 'planned_misc_cost',           'Miscellaneous', false),
      (v_org.id, 'planned_contingency_cost',    'Contingency', false)
    ON CONFLICT (organization_id, key) DO NOTHING;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
