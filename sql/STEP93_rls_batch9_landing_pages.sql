-- ============================================================
-- STEP93: Multi-tenant RLS retrofit — Batch 9 (Landing Page Builder).
--
-- Scoped to landing_pages / landing_page_blocks only — these are the
-- actual per-organization tenant content (the pages an org builds).
--
-- landing_page_templates / landing_page_template_blocks are
-- DELIBERATELY left unscoped, same design call already made for
-- `roles`/`skills` in Batch 1: they're a shared starter-template
-- library (the 5 seed templates from STEP79 plus the "SaaS Product
-- Launch" template from STEP88), meant to be available to every
-- organization as starting points, not tenant-owned data.
--
-- Original RLS (STEP79) was generated via a DO $$ FOREACH ... EXECUTE
-- format() loop across all 4 tables at once — this migration keeps that
-- exact codegen structure but narrows the loop's array to the 2 tables
-- actually being org-scoped here, and adds one AND clause to the
-- generated policy text.
-- ============================================================

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE landing_pages SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE landing_pages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE landing_pages ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE landing_page_blocks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE landing_page_blocks SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE landing_page_blocks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE landing_page_blocks ALTER COLUMN organization_id SET DEFAULT current_org_id();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['landing_pages','landing_page_blocks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL AND organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager''))
       ) WITH CHECK (
         organization_id = current_org_id() AND
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager''))
       )', t, t
    );
  END LOOP;
END $$;

-- The public-facing RPC (get_landing_page_public, called from the
-- anonymous /l/:slug and /book/:slug pages) resolves its landing_pages
-- row via sales_landing_links.landing_page_id, NOT via auth.uid()
-- (the caller is unauthenticated) — it is SECURITY DEFINER and bypasses
-- RLS entirely already, so this migration does not need to touch it.
-- Revisit only once sales_landing_links itself is org-scoped (Sales/CRM
-- batch) to confirm the two tables' organization_id values are kept
-- consistent for a given link.

NOTIFY pgrst, 'reload schema';
