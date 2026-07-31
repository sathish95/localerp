-- ============================================================
-- STEP102: Multi-tenant RLS retrofit — Batch 8 (Marketing, 8 tables).
-- Exact current policy names/definitions confirmed by reading STEP76
-- directly (STEP77/80/81 touched public_submit_lead()/sales_leads/
-- sales_landing_links, already handled in STEP101 — not this module's
-- own RLS).
--
-- marketing_campaign_channel_links' two partial UNIQUE indexes
-- (one landing page / one bootstrap program attributes to exactly one
-- campaign) don't need org-widening — linked_landing_page_id and
-- linked_bootstrap_program_id are themselves specific UUIDs already
-- scoped to one org's row, so no two orgs' rows could collide on them.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY[
    'marketing_campaign_types','marketing_campaign_cost_types','marketing_campaigns',
    'marketing_campaign_budgets','marketing_campaign_cost_entries','marketing_campaign_channel_links',
    'marketing_campaign_results','marketing_content_assets'
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
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager'',''finance''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager'',''finance''))
       )', t, t
    );
  END LOOP;
END $$;

-- marketing_campaign_types.name / marketing_campaign_cost_types.name are
-- UNIQUE, same lookup-list shape as the sales_* lookup lists — widen to
-- (organization_id, name) so each org can carry its own seeded copy.
ALTER TABLE marketing_campaign_types DROP CONSTRAINT IF EXISTS marketing_campaign_types_name_key;
ALTER TABLE marketing_campaign_types ADD CONSTRAINT marketing_campaign_types_org_name_key UNIQUE (organization_id, name);
ALTER TABLE marketing_campaign_cost_types DROP CONSTRAINT IF EXISTS marketing_campaign_cost_types_name_key;
ALTER TABLE marketing_campaign_cost_types ADD CONSTRAINT marketing_campaign_cost_types_org_name_key UNIQUE (organization_id, name);

NOTIFY pgrst, 'reload schema';
