-- ============================================================
-- STEP74: Sales & Pre-Sales CRM — fixes two schema bugs found while
-- testing STEP68-73 against the running app.
--
-- 1. PGRST200 ("Could not find a relationship between 'sales_leads' and
--    'sales_regions'"). CLAUDE.md's soft-ref convention (plain UUID, no
--    REFERENCES) exists for tables that may not exist yet at migration
--    time — but src/lib/salesLeads.js etc. use Supabase's embedded-select
--    syntax (`region:sales_regions(region_name)`), and PostgREST can only
--    resolve that shorthand against a REAL foreign key in its schema
--    cache, not an unconstrained UUID column. Every referenced table here
--    (sales_regions, profiles, sales_leads, sales_role_definitions,
--    sales_marketing_budget_lines) is created earlier in this same
--    migration set or already exists — none of them have the "may not
--    exist yet" problem soft refs are for — so adding real FKs is safe
--    and correct, not a convention violation.
--
-- 2. Type mismatch: sales_pilot_projects.product_piloted and
--    sales_bootstrap_programs.product_provided were declared UUID, but
--    every product picker in this codebase (and the ones just built)
--    passes products.part_number — a TEXT value, matching
--    proposal_hardware_lines.part_number's established convention
--    (STEP62), not products.id. Inserting a part_number into a UUID
--    column would fail outright, so there's no real data to preserve —
--    dropped and re-added as TEXT REFERENCES products(part_number).
--    product_launches.linked_product_id and sales_leads.product_interest_id
--    get the same fix for consistency, even though no UI writes them yet.
--
-- Safe to run whether or not STEP68-73 already ran with the original
-- (buggy) column definitions — every ALTER below is idempotent.
-- ============================================================

-- ── Product references: UUID -> TEXT REFERENCES products(part_number) ──
ALTER TABLE sales_leads DROP COLUMN IF EXISTS product_interest_id;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS product_interest_id TEXT REFERENCES products(part_number);

ALTER TABLE sales_pilot_projects DROP COLUMN IF EXISTS product_piloted;
ALTER TABLE sales_pilot_projects ADD COLUMN IF NOT EXISTS product_piloted TEXT REFERENCES products(part_number);

ALTER TABLE sales_bootstrap_programs DROP COLUMN IF EXISTS product_provided;
ALTER TABLE sales_bootstrap_programs ADD COLUMN IF NOT EXISTS product_provided TEXT REFERENCES products(part_number);

ALTER TABLE product_launches DROP COLUMN IF EXISTS linked_product_id;
ALTER TABLE product_launches ADD COLUMN IF NOT EXISTS linked_product_id TEXT REFERENCES products(part_number);

-- ── Real FKs for every soft ref that src/lib/*.js embeds via PostgREST ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_leads_region_fk') THEN
    ALTER TABLE sales_leads ADD CONSTRAINT sales_leads_region_fk FOREIGN KEY (region_id) REFERENCES sales_regions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_leads_rep_fk') THEN
    ALTER TABLE sales_leads ADD CONSTRAINT sales_leads_rep_fk FOREIGN KEY (assigned_rep_id) REFERENCES profiles(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_opportunities_region_fk') THEN
    ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_region_fk FOREIGN KEY (region_id) REFERENCES sales_regions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_opportunities_rep_fk') THEN
    ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_rep_fk FOREIGN KEY (assigned_rep_id) REFERENCES profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_opportunities_lead_fk') THEN
    ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_lead_fk FOREIGN KEY (lead_id) REFERENCES sales_leads(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_rep_assignments_profile_fk') THEN
    ALTER TABLE sales_rep_assignments ADD CONSTRAINT sales_rep_assignments_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_rep_assignments_roledef_fk') THEN
    ALTER TABLE sales_rep_assignments ADD CONSTRAINT sales_rep_assignments_roledef_fk FOREIGN KEY (sales_role_definition_id) REFERENCES sales_role_definitions(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_role_definitions_region_fk') THEN
    ALTER TABLE sales_role_definitions ADD CONSTRAINT sales_role_definitions_region_fk FOREIGN KEY (region_id) REFERENCES sales_regions(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_assignment_rules_region_fk') THEN
    ALTER TABLE sales_assignment_rules ADD CONSTRAINT sales_assignment_rules_region_fk FOREIGN KEY (region_id) REFERENCES sales_regions(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_stale_threshold_config_region_fk') THEN
    ALTER TABLE sales_stale_threshold_config ADD CONSTRAINT sales_stale_threshold_config_region_fk FOREIGN KEY (applies_to_region_id) REFERENCES sales_regions(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_bootstrap_programs_budgetline_fk') THEN
    ALTER TABLE sales_bootstrap_programs ADD CONSTRAINT sales_bootstrap_programs_budgetline_fk FOREIGN KEY (marketing_budget_line_id) REFERENCES sales_marketing_budget_lines(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_profit_attribution_region_fk') THEN
    ALTER TABLE sales_profit_attribution ADD CONSTRAINT sales_profit_attribution_region_fk FOREIGN KEY (region_id) REFERENCES sales_regions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_profit_attribution_rep_fk') THEN
    ALTER TABLE sales_profit_attribution ADD CONSTRAINT sales_profit_attribution_rep_fk FOREIGN KEY (sales_rep_id) REFERENCES profiles(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
