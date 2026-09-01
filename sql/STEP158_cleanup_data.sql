-- ============================================================================
-- STEP158_cleanup_data.sql
-- PURPOSE: Wipe ALL transactional / business data, keep users + org config/setup.
-- TARGET : PRODUCTION Supabase project (prod.env).
-- ============================================================================
--
--   *** THIS IS DESTRUCTIVE AND IRREVERSIBLE. TAKE A DB BACKUP FIRST.  ***
--   Supabase Dashboard -> Database -> Backups -> "Start a new backup"
--   (or pg_dump) before running Section 2.
--
-- WHAT IT KEEPS (allow-list `_cleanup_keep` below):
--   * auth.users              -- untouched, different schema; never referenced here
--   * profiles                -- the "users" you asked to keep
--   * organizations, departments, invites, module allocations/subscriptions
--   * roles, permissions, role/resource rate cards, modules, nav visibility
--   * billing plans / bundles, payment providers, platform settings & branding
--   * approval chains + steps
--   * all *_settings / *_config / lookup / template tables (document, proposal,
--     certificate, landing-page, scenario, sales, marketing, award, support, LLM,
--     warranty policy/tiers, finance, capacity, holidays, leave types/policies)
--
-- WHAT IT WIPES (everything else in schema `public`):
--   expenses, travel, procurement (PR/PO/GRN), invoices, payments, projects,
--   tasks, timesheets/time logs, leave balances/requests, leads, opportunities,
--   proposals, notifications, app_events, chat, AI analysis sessions, warranty
--   claims/devices/budgets, scenarios + runs, support tickets, award/appraisal
--   instances, spend analyzer, custom dashboards, audit logs, rollups, etc.
--   Also any table that predates the tracked migrations and isn't in the
--   allow-list -- it is caught automatically because the script enumerates
--   pg_tables rather than a fixed drop-list.
--
-- MASTER DATA (customers / vendors / products / BOMs / skills):
--   WIPED by default. To KEEP them instead, uncomment the marked INSERT in
--   Section 1 before running.
--
-- HOW TO RUN (Supabase SQL Editor):
--   1. Run SECTION 1 alone. Read both result grids:
--        - grid A: every public table tagged KEEP or WIPE + approx row count
--        - grid B: MUST be empty. Rows here = a KEEP table that a FK would drag
--          into the CASCADE. If non-empty, tell me before proceeding.
--   2. When satisfied, run SECTION 2. It runs in one transaction; flip the last
--      line to ROLLBACK for a dry run, then back to COMMIT for real.
-- ============================================================================


-- ############################################################################
-- ## SECTION 1 -- READ ONLY. Safe to run repeatedly. Nothing is modified.    ##
-- ############################################################################

DROP TABLE IF EXISTS _cleanup_keep;
CREATE TABLE _cleanup_keep (t text PRIMARY KEY);

INSERT INTO _cleanup_keep (t) VALUES
  -- identity / tenancy -------------------------------------------------------
  ('profiles'),
  ('organizations'), ('departments'),
  ('organization_invites'), ('organization_bundle_subscriptions'),
  ('organization_module_allocations'),
  -- roles / permissions / modules / nav ------------------------------------
  ('roles'), ('role_permissions'), ('permissions'), ('task_role_permissions'),
  ('role_rates'), ('resource_rates'),
  ('modules'), ('module_role_visibility'),
  -- billing / payment / platform config -----------------------------------
  ('billing_plans'), ('billing_bundles'), ('billing_module_bundles'),
  ('module_pricing'),
  ('payment_providers'), ('payment_gateway_secrets'),
  ('platform_settings'), ('platform_branding'),
  -- approval config ------------------------------------------------------
  ('approval_chains'), ('approval_chain_steps'),
  -- templates ----------------------------------------------------------
  ('document_templates'), ('document_settings'),
  ('proposal_templates'), ('proposal_budget_category_map'),
  ('certificate_templates'),
  ('award_certificate_templates'), ('award_certificate_template_versions'),
  ('landing_page_templates'), ('landing_page_template_blocks'),
  ('scenario_templates'), ('scenario_template_variables'),
  -- settings / lookups -----------------------------------------------
  ('finance_settings'), ('capacity_settings'),
  ('warranty_settings'), ('warranty_depreciation_tiers'), ('warranty_policies'),
  ('llm_settings'), ('ai_capability_settings'),
  ('support_settings'), ('support_sla_policies'), ('support_assignment_rules'),
  ('support_project_tag_role_visibility'), ('support_agents'),
  ('holidays'), ('leave_types'), ('leave_policies'),
  ('kb_modules'), ('org_home_widget_config'),
  -- sales config ---------------------------------------------------
  ('sales_config_flags'), ('sales_pipeline_stages'), ('sales_regions'),
  ('sales_lead_sources'), ('sales_task_types'), ('sales_activity_types'),
  ('sales_activity_outcomes'), ('sales_assignment_rules'),
  ('sales_role_definitions'), ('sales_stale_threshold_config'),
  ('sales_public_form_secrets'), ('sales_landing_links'),
  -- marketing lookups --------------------------------------------
  ('marketing_campaign_types'), ('marketing_campaign_cost_types'),
  -- award / performance config ---------------------------------
  ('award_categories'), ('award_questions'), ('award_scoring_config'),
  ('award_workflow_steps'), ('award_eligibility_rules'),
  ('performance_score_weights'), ('performance_cycles'),
  -- internal / bookkeeping -------------------------------------
  ('_role_policy_backup'), ('_schema_migration_flags'), ('_cleanup_keep')
;

-- >>> OPTIONAL: also KEEP master data. Uncomment this block to retain
-- >>> customers / vendors / products / BOMs / skills.
-- INSERT INTO _cleanup_keep (t) VALUES
--   ('customers'), ('vendors'), ('referral_vendors'), ('component_vendors'),
--   ('products'),
--   ('product_bom_versions'), ('product_bom_version_components'),
--   ('product_bom_components'),
--   ('skills'), ('employee_skills')
-- ON CONFLICT DO NOTHING;

-- ---- GRID A: classification + approximate row counts -----------------------
SELECT
  p.tablename                                              AS table_name,
  CASE WHEN k.t IS NULL THEN 'WIPE' ELSE 'KEEP' END        AS action,
  COALESCE(s.n_live_tup, 0)                                AS approx_rows
FROM pg_tables p
LEFT JOIN _cleanup_keep k       ON k.t = p.tablename
LEFT JOIN pg_stat_user_tables s ON s.schemaname = 'public' AND s.relname = p.tablename
WHERE p.schemaname = 'public'
ORDER BY action, p.tablename;

-- ---- GRID B: KEEP tables a FK would pull into TRUNCATE ... CASCADE ---------
-- ----         EXPECTED RESULT: 0 rows. If not empty, stop and review.       --
SELECT DISTINCT
  rel.relname  AS keep_table_at_risk,
  ref.relname  AS references_a_wiped_table,
  con.conname  AS via_constraint
FROM pg_constraint con
JOIN pg_class     rel ON rel.oid = con.conrelid
JOIN pg_class     ref ON ref.oid = con.confrelid
JOIN pg_namespace n   ON n.oid = rel.relnamespace AND n.nspname = 'public'
JOIN _cleanup_keep k  ON k.t = rel.relname                 -- referencing table is KEEP
LEFT JOIN _cleanup_keep k2 ON k2.t = ref.relname           -- referenced table ...
WHERE con.contype = 'f'
  AND k2.t IS NULL                                          -- ... is WIPE
  AND ref.relname <> rel.relname
ORDER BY 1, 2;


-- ############################################################################
-- ## SECTION 2 -- DESTRUCTIVE. Run only after Section 1 grids check out.     ##
-- ## Requires Section 1 to have been run in the same session (needs         ##
-- ## _cleanup_keep). One transaction: flip COMMIT -> ROLLBACK for dry run.  ##
-- ############################################################################

BEGIN;

DO $$
DECLARE
  v_tables text;
  v_count  int;
BEGIN
  IF to_regclass('public._cleanup_keep') IS NULL THEN
    RAISE EXCEPTION 'Run SECTION 1 first (in this same session) -- _cleanup_keep is missing.';
  END IF;

  SELECT string_agg(format('public.%I', p.tablename), ', '), count(*)
    INTO v_tables, v_count
  FROM pg_tables p
  LEFT JOIN _cleanup_keep k ON k.t = p.tablename
  WHERE p.schemaname = 'public'
    AND k.t IS NULL;

  IF v_tables IS NULL THEN
    RAISE NOTICE 'Nothing to truncate.';
    RETURN;
  END IF;

  RAISE NOTICE 'Truncating % table(s): %', v_count, v_tables;
  EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';
  RAISE NOTICE 'Truncate complete.';
END $$;

DROP TABLE _cleanup_keep;

-- ---- verification: row counts of everything still standing ----------------
SELECT relname AS kept_table, n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

-- Flip to ROLLBACK for a dry run; COMMIT to apply for real.
COMMIT;

-- ============================================================================
-- POST-RUN NOTES
--   * Sequence numbering (nextNum / EXP,PO,INV...): if backed by a table it was
--     reset by RESTART IDENTITY / truncated; if backed by a real SEQUENCE object
--     it is untouched -- reset manually with ALTER SEQUENCE ... RESTART if you
--     want counters to start from 1.
--   * Storage buckets (file uploads) are NOT touched by this script. Clear them
--     from Dashboard -> Storage if needed.
--   * auth.users is untouched. Users can still log in; their profiles remain.
--   * Run  NOTIFY pgrst, 'reload schema';  is not required (no schema change).
-- ============================================================================
