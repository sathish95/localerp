-- ============================================================
-- STEP100: Multi-tenant RLS retrofit — Batch 5 (Proposals).
-- Exact current policy names/definitions confirmed by reading STEP62/64/65
-- directly — nothing has altered these since creation.
--
-- The 10 proposal_* tables already share one DO $$ FOREACH codegen loop
-- (STEP62) with a consistent {table}_select/{table}_write naming
-- convention — reused here unchanged, just adding the org column +
-- backfill + org predicate ANDed into both policies.
--
-- Child tables (proposal_resource_plans/hardware_lines/software_lines/
-- misc_lines) only carry proposal_cost_section_id, not proposal_id
-- directly — but since there's only ever been one org's worth of data
-- until now, a flat backfill to default-org is correct regardless of the
-- FK chain; DEFAULT current_org_id() handles every insert going forward.
--
-- proposal_budget_category_map's UNIQUE(proposal_category) is widened to
-- (organization_id, proposal_category) so each org can carry its own copy
-- of the 7 seeded mapping rows (seeded per-org below) — same reasoning as
-- proposal_templates staying per-org rather than shared, since an org may
-- eventually want to customize this mapping even though no UI exists yet.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';

  FOREACH t IN ARRAY ARRAY[
    'proposals','proposal_cost_sections','proposal_resource_plans','proposal_hardware_lines',
    'proposal_software_lines','proposal_misc_lines','proposal_vendor_costs','proposal_timeline',
    'proposal_templates','proposal_value_summary'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       )', t, t
    );
  END LOOP;
END $$;

-- project_planned_budget
ALTER TABLE project_planned_budget ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE project_planned_budget SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE project_planned_budget ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE project_planned_budget ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS project_planned_budget_select ON project_planned_budget;
DROP POLICY IF EXISTS project_planned_budget_write  ON project_planned_budget;
CREATE POLICY project_planned_budget_select ON project_planned_budget FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY project_planned_budget_write ON project_planned_budget FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','pm','manager','department_head'))
);

-- proposal_budget_category_map — widen UNIQUE(proposal_category) to include org, seed per-org
ALTER TABLE proposal_budget_category_map ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE proposal_budget_category_map SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE proposal_budget_category_map DROP CONSTRAINT IF EXISTS proposal_budget_category_map_proposal_category_key;
ALTER TABLE proposal_budget_category_map DROP CONSTRAINT IF EXISTS proposal_budget_category_map_org_category_key;
ALTER TABLE proposal_budget_category_map ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE proposal_budget_category_map ADD CONSTRAINT proposal_budget_category_map_org_category_key UNIQUE (organization_id, proposal_category);
ALTER TABLE proposal_budget_category_map ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS proposal_budget_category_map_select ON proposal_budget_category_map;
DROP POLICY IF EXISTS proposal_budget_category_map_write  ON proposal_budget_category_map;
CREATE POLICY proposal_budget_category_map_select ON proposal_budget_category_map FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY proposal_budget_category_map_write ON proposal_budget_category_map FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

-- Seed the 7 mapping rows for every org that doesn't have them yet (covers
-- any org created between STEP64's original seed and this migration).
INSERT INTO proposal_budget_category_map (organization_id, proposal_category, budget_category)
SELECT o.id, m.proposal_category, m.budget_category
FROM organizations o
CROSS JOIN (VALUES
  ('Application Development',        'planned_resource_cost'),
  ('Firmware Development',           'planned_resource_cost'),
  ('Hardware Design & Production',   'planned_resource_cost'),
  ('ERP Integration',                'planned_erp_cost'),
  ('Hardware',                       'planned_hardware_cost'),
  ('Software/SaaS/Third-Party',      'planned_software_cost'),
  ('Miscellaneous',                  'planned_misc_cost')
) AS m(proposal_category, budget_category)
ON CONFLICT (organization_id, proposal_category) DO NOTHING;

NOTIFY pgrst, 'reload schema';
