-- ============================================================
-- STEP36: Enterprise Spend Analyzer — company-wide rollup sitting above
-- all projects/departments. This is an aggregation layer on top of
-- EXISTING data (budgets, actual_cost_snapshots, invoices, customer_invoices,
-- allocations, change_requests, project_hardware/software/support_costs) —
-- it does not duplicate any of those tables.
--
-- Run AFTER STEP31-35 (Budget & Finance module) — depends on
-- actual_cost_snapshots, profit_margins, customer_invoices, role_rates.
--
-- Two new columns on `projects` are added here because the rollup's core
-- promise (company -> department -> project drill-down, and "compare
-- similar projects" benchmarking) is impossible without them:
--   - projects had NO department linkage anywhere (only budgets.department_id
--     and profiles.department_id, neither of which reliably maps to a
--     project — project-scoped budget rows have department_id NULL by
--     this app's own "one FK or the other" convention).
--   - projects had NO project_type, which the spec's benchmarking section
--     explicitly requires ("compare similar projects, same project type").
-- Both are soft, nullable, no default — existing rows are simply
-- unclassified until backfilled via the Projects edit form.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id UUID;  -- soft ref -> departments(id)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT;   -- free text, e.g. 'IoT Deployment','Internal Tool','Client Services'
CREATE INDEX IF NOT EXISTS projects_department_idx ON projects(department_id);
CREATE INDEX IF NOT EXISTS projects_type_idx ON projects(project_type);

-- ── CompanySpendRollup — pre-aggregated by period + department + category ──
-- Performance-critical table: company-wide "where is spend happening" reads
-- from here, never from a live cross-project join, so query cost stays flat
-- as project count grows into the hundreds.
--
-- category is one of a fixed set: 'Resource','Hardware','Software','Support',
-- 'Change' (free TEXT, not an enum — every status/category column discovered
-- this session across the app is free TEXT, matching convention).
--   Resource -> actual_cost_snapshots.people_cost (allocations x role_rates)
--   Hardware -> project_hardware_costs.cost_company
--   Software -> project_software_costs.cost_company
--   Support  -> project_support_costs.cost_company
--   Change   -> change_requests (actual_cost, falling back to estimated_cost)
-- planned_amount for a (department,category) cell sums the matching
-- budgets.allocated rows whose free-text `category` loosely matches
-- (ILIKE) the fixed category name; a budget row that matches nothing
-- lands in 'Misc' so the planned total always reconciles to
-- SUM(budgets.allocated) for that department.
CREATE TABLE IF NOT EXISTS company_spend_rollup (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_key       TEXT        NOT NULL,           -- 'YYYY-MM' or 'ALL' (lifetime-to-date)
  department_id    UUID,                            -- NULL = unassigned/company-wide bucket
  category         TEXT        NOT NULL,
  planned_amount   NUMERIC(14,2) DEFAULT 0,
  actual_amount    NUMERIC(14,2) DEFAULT 0,
  variance_amount  NUMERIC(14,2) DEFAULT 0,          -- client-computed = actual - planned
  variance_percent NUMERIC(6,2)  DEFAULT 0,
  computed_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_key, department_id, category)
);
CREATE INDEX IF NOT EXISTS company_spend_rollup_period_idx ON company_spend_rollup(period_key);
CREATE INDEX IF NOT EXISTS company_spend_rollup_dept_idx ON company_spend_rollup(department_id);

-- ── VendorSpendSummary — total spend per vendor across all invoices ──
-- avg_unit_cost_by_product is a best-effort secondary signal for vendor
-- consolidation: project_hardware_costs has a free-text `vendor` column
-- (distinct from invoices.vendor_id's real FK) recording what was actually
-- typed at cost-entry time, grouped by item `name`. It is NOT a reliable
-- join key (no FK, free text, may typo/vary) — flagged here and in the lib
-- code as approximate, good enough to surface a "check this" finding, not
-- to drive an automated action.
CREATE TABLE IF NOT EXISTS vendor_spend_summary (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id                UUID        NOT NULL REFERENCES vendors(id),
  period_key               TEXT        NOT NULL DEFAULT 'ALL',
  total_spend              NUMERIC(14,2) DEFAULT 0,   -- SUM(invoices.total_amount) for this vendor/period
  invoice_count            INT         DEFAULT 0,
  project_count            INT         DEFAULT 0,     -- COUNT(DISTINCT invoices.project_id)
  avg_unit_cost_by_product JSONB       DEFAULT '{}',   -- { "<hardware item name>": avg_unit_price }
  computed_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (vendor_id, period_key)
);
CREATE INDEX IF NOT EXISTS vendor_spend_summary_period_idx ON vendor_spend_summary(period_key);

-- ── SpendFinding — persisted prescriptive findings (Section 3) ──
-- Persisted rather than recomputed fresh every page load so Finance/PMO can
-- mark one as seen/handled and it stops resurfacing identically.
CREATE TABLE IF NOT EXISTS spend_findings (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_type          TEXT        NOT NULL CHECK (finding_type IN (
                            'RecurringOverrun','ContingencyPattern','UnderutilizedBudget',
                            'VendorConsolidation','AllocationInefficiency','ChangeCostCreep')),
  title                 TEXT        NOT NULL,
  description           TEXT        NOT NULL,          -- auto-generated summary text
  impact_amount         NUMERIC(14,2) DEFAULT 0,        -- estimated Rs impact if addressed
  related_project_ids   UUID[]      DEFAULT '{}',
  related_department_ids UUID[]     DEFAULT '{}',
  detected_date         DATE        NOT NULL DEFAULT CURRENT_DATE,
  status                TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','actioned','dismissed')),
  status_changed_by     UUID        REFERENCES profiles(id),
  status_changed_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spend_findings_type_idx ON spend_findings(finding_type);
CREATE INDEX IF NOT EXISTS spend_findings_status_idx ON spend_findings(status);

ALTER TABLE company_spend_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_spend_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE spend_findings ENABLE ROW LEVEL SECURITY;
-- Permissive RLS (auth.uid() IS NOT NULL) matching this app's usual convention —
-- restriction to Finance/Leadership/PMO roles is enforced client-side in
-- SpendAnalyzerPage.jsx + the route gate in App.jsx, same as every other page
-- in this app except profit_margins (STEP35), which had an explicit spec
-- requirement for server-side enforcement that this spec does not repeat.
CREATE POLICY company_spend_rollup_all ON company_spend_rollup FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY vendor_spend_summary_all ON vendor_spend_summary FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY spend_findings_all ON spend_findings FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_spend_rollup TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_spend_summary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spend_findings TO authenticated;

NOTIFY pgrst, 'reload schema';
