-- ============================================================
-- STEP99: Multi-tenant RLS retrofit — Batch 4 (Warranty).
-- Exact current policy names/definitions confirmed by reading STEP37/38
-- directly — nothing has altered these since creation.
--
-- warranty_settings is a singleton row (id INT PRIMARY KEY DEFAULT 1),
-- same pattern as capacity_settings/performance_score_weights/
-- finance_settings — redesigned to organization_id UUID PRIMARY KEY.
-- App code (src/lib/warranty.js getWarrantySettings/upsertWarrantySettings)
-- already fixed to drop the `.eq('id', 1)` filter.
-- ============================================================

-- warranty_policies
ALTER TABLE warranty_policies ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_policies SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE warranty_policies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_policies ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS warranty_policies_all ON warranty_policies;
CREATE POLICY warranty_policies_all ON warranty_policies FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- device_warranties
ALTER TABLE device_warranties ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE device_warranties SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE device_warranties ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE device_warranties ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS device_warranties_all ON device_warranties;
CREATE POLICY device_warranties_all ON device_warranties FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- warranty_claims
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_claims SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE warranty_claims ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_claims ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS warranty_claims_all ON warranty_claims;
CREATE POLICY warranty_claims_all ON warranty_claims FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- warranty_settings — singleton -> per-org PK redesign
ALTER TABLE warranty_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_settings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
DROP POLICY IF EXISTS warranty_settings_all ON warranty_settings;
ALTER TABLE warranty_settings DROP CONSTRAINT IF EXISTS warranty_settings_pkey;
ALTER TABLE warranty_settings DROP COLUMN IF EXISTS id;
ALTER TABLE warranty_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_settings ADD PRIMARY KEY (organization_id);
ALTER TABLE warranty_settings ALTER COLUMN organization_id SET DEFAULT current_org_id();
CREATE POLICY warranty_settings_all ON warranty_settings FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
INSERT INTO warranty_settings (organization_id)
  SELECT id FROM organizations WHERE id NOT IN (SELECT organization_id FROM warranty_settings)
  ON CONFLICT (organization_id) DO NOTHING;

-- warranty_analytics_rollup
ALTER TABLE warranty_analytics_rollup ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_analytics_rollup SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE warranty_analytics_rollup ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_analytics_rollup ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS warranty_analytics_rollup_all ON warranty_analytics_rollup;
CREATE POLICY warranty_analytics_rollup_all ON warranty_analytics_rollup FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- warranty_cost_entries — restrictive (admin/ceo/finance), preserved
ALTER TABLE warranty_cost_entries ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_cost_entries SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE warranty_cost_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_cost_entries ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS warranty_cost_entries_select ON warranty_cost_entries;
DROP POLICY IF EXISTS warranty_cost_entries_insert ON warranty_cost_entries;
DROP POLICY IF EXISTS warranty_cost_entries_update ON warranty_cost_entries;
CREATE POLICY warranty_cost_entries_select ON warranty_cost_entries FOR SELECT USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_cost_entries_insert ON warranty_cost_entries FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_cost_entries_update ON warranty_cost_entries FOR UPDATE USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

-- warranty_budgets — restrictive (admin/ceo/finance), preserved, includes DELETE
ALTER TABLE warranty_budgets ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE warranty_budgets SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE warranty_budgets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warranty_budgets ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS warranty_budgets_select ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_insert ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_update ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_delete ON warranty_budgets;
CREATE POLICY warranty_budgets_select ON warranty_budgets FOR SELECT USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_insert ON warranty_budgets FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_update ON warranty_budgets FOR UPDATE USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_delete ON warranty_budgets FOR DELETE USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

-- warranty_budgets' original UNIQUE(scope_key, period_key) and
-- warranty_analytics_rollup's UNIQUE(period_key, part_number, issue_type)
-- are now too narrow — two orgs both budgeting the same part_number/period
-- would collide. Widen to include organization_id. Default constraint names
-- are looked up dynamically (one is right at Postgres's 63-char truncation
-- boundary — not safe to guess) rather than hardcoded.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  SELECT conname INTO old_name FROM pg_constraint
    WHERE conrelid = 'warranty_budgets'::regclass AND contype = 'u'
      AND conkey = (SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
                    WHERE attrelid = 'warranty_budgets'::regclass AND attname IN ('scope_key','period_key'));
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE warranty_budgets DROP CONSTRAINT %I', old_name);
  END IF;

  SELECT conname INTO old_name FROM pg_constraint
    WHERE conrelid = 'warranty_analytics_rollup'::regclass AND contype = 'u'
      AND conkey = (SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
                    WHERE attrelid = 'warranty_analytics_rollup'::regclass AND attname IN ('period_key','part_number','issue_type'));
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE warranty_analytics_rollup DROP CONSTRAINT %I', old_name);
  END IF;
END $$;

ALTER TABLE warranty_budgets DROP CONSTRAINT IF EXISTS warranty_budgets_org_scope_period_key;
ALTER TABLE warranty_budgets ADD CONSTRAINT warranty_budgets_org_scope_period_key UNIQUE (organization_id, scope_key, period_key);
ALTER TABLE warranty_analytics_rollup DROP CONSTRAINT IF EXISTS warranty_analytics_rollup_org_period_part_issue_key;
ALTER TABLE warranty_analytics_rollup ADD CONSTRAINT warranty_analytics_rollup_org_period_part_issue_key UNIQUE (organization_id, period_key, part_number, issue_type);

NOTIFY pgrst, 'reload schema';
