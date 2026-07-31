-- ============================================================
-- STEP98: Multi-tenant RLS retrofit — Batch 3 (Finance).
-- Exact current policy names/definitions confirmed by reading their
-- tracked creation scripts directly (STEP31-STEP36) — no live diagnostic
-- needed since nothing has altered these since they were created.
--
-- finance_settings is a singleton row (id INT PRIMARY KEY DEFAULT 1,
-- same pattern as capacity_settings/performance_score_weights) —
-- redesigned to organization_id UUID PRIMARY KEY, matching those two
-- precedents exactly. App code (src/lib/actualCost.js,
-- src/lib/threeWayMatch.js) reads it via `.eq('id', 1)` — fixed below to
-- drop that filter since RLS now scopes correctly on its own. No write
-- path exists in app code for finance_settings today (no Settings UI),
-- so nothing else to change.
-- ============================================================

-- role_rates
ALTER TABLE role_rates ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE role_rates SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE role_rates ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE role_rates ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS role_rates_all ON role_rates;
CREATE POLICY role_rates_all ON role_rates FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- finance_settings — singleton -> per-org PK redesign (drop id, org id becomes PK)
ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE finance_settings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
DROP POLICY IF EXISTS finance_settings_all ON finance_settings;
ALTER TABLE finance_settings DROP CONSTRAINT IF EXISTS finance_settings_pkey;
ALTER TABLE finance_settings DROP COLUMN IF EXISTS id;
ALTER TABLE finance_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE finance_settings ADD PRIMARY KEY (organization_id);
ALTER TABLE finance_settings ALTER COLUMN organization_id SET DEFAULT current_org_id();
CREATE POLICY finance_settings_all ON finance_settings FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
-- ensure every org has a row so maybeSingle() reads never come back empty for a new org
INSERT INTO finance_settings (organization_id)
  SELECT id FROM organizations WHERE id NOT IN (SELECT organization_id FROM finance_settings)
  ON CONFLICT (organization_id) DO NOTHING;

-- budget_revisions
ALTER TABLE budget_revisions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE budget_revisions SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE budget_revisions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE budget_revisions ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS budget_revisions_all ON budget_revisions;
CREATE POLICY budget_revisions_all ON budget_revisions FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- actual_cost_snapshots
ALTER TABLE actual_cost_snapshots ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE actual_cost_snapshots SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE actual_cost_snapshots ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE actual_cost_snapshots ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS actual_cost_snapshots_all ON actual_cost_snapshots;
CREATE POLICY actual_cost_snapshots_all ON actual_cost_snapshots FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- customer_invoices
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE customer_invoices SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE customer_invoices ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE customer_invoices ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS customer_invoices_all ON customer_invoices;
CREATE POLICY customer_invoices_all ON customer_invoices FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- payments (polymorphic soft-ref to invoices/customer_invoices — org column stands alone, no FK chase needed for RLS)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE payments SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE payments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS payments_all ON payments;
CREATE POLICY payments_all ON payments FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- profit_margins — the one genuinely-restricted table (admin/ceo/finance only), preserved
ALTER TABLE profit_margins ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE profit_margins SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE profit_margins ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE profit_margins ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS profit_margins_select ON profit_margins;
DROP POLICY IF EXISTS profit_margins_insert ON profit_margins;
DROP POLICY IF EXISTS profit_margins_update ON profit_margins;
CREATE POLICY profit_margins_select ON profit_margins FOR SELECT USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY profit_margins_insert ON profit_margins FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY profit_margins_update ON profit_margins FOR UPDATE USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
-- still deliberately no DELETE policy

-- company_spend_rollup
ALTER TABLE company_spend_rollup ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE company_spend_rollup SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE company_spend_rollup ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE company_spend_rollup ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS company_spend_rollup_all ON company_spend_rollup;
CREATE POLICY company_spend_rollup_all ON company_spend_rollup FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- vendor_spend_summary
ALTER TABLE vendor_spend_summary ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE vendor_spend_summary SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE vendor_spend_summary ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vendor_spend_summary ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS vendor_spend_summary_all ON vendor_spend_summary;
CREATE POLICY vendor_spend_summary_all ON vendor_spend_summary FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- spend_findings
ALTER TABLE spend_findings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE spend_findings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE spend_findings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE spend_findings ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS spend_findings_all ON spend_findings;
CREATE POLICY spend_findings_all ON spend_findings FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

NOTIFY pgrst, 'reload schema';
