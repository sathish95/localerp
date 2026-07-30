-- ============================================================
-- SEED_spend_analyzer_data.sql — purpose-built data to validate every
-- section of the Enterprise Spend Analyzer end to end: Overview KPIs +
-- 12-month trend, By Category/Department/Project/Vendor cuts, all 6
-- finding types, Forecast at-risk list, and Benchmark peer comparison.
--
-- Run AFTER: STEP31-36 (Budget & Finance + Spend Analyzer migrations) and
-- SEED_demo_data.sql + SEED_demo_data_part2.sql (this script reuses
-- SEED-VEND-1..4 vendors from part2 for the vendor rollup — those rows are
-- skipped gracefully if part2 hasn't been run, via empty-subquery joins).
--
-- ⚠️ IMPORTANT: this script seeds actual_cost_snapshots / profit_margins
-- DIRECTLY with crafted numbers, bypassing src/lib/actualCost.js's real
-- computation (which derives people_cost from allocations x role_rates —
-- none of which this script creates for these 6 projects). This is
-- deliberate: it lets every Spend Analyzer view show rich data immediately
-- after one click of "Recompute All", without first requiring allocations
-- to be staffed on 6 fake projects. The one thing this breaks: if you open
-- one of these SEED projects' Finance subtab and click "Recompute Now" (or
-- "Recompute All Margins"), it will OVERWRITE these seeded numbers with
-- freshly computed (near-zero) ones, since there's no real allocation data
-- behind them. Don't click those two buttons on SEED-PRJ-* projects — only
-- the Spend Analyzer's own "Recompute All" is safe to re-run (it only
-- reads actual_cost_snapshots, never writes it).
--
-- Idempotent: every INSERT is guarded (WHERE NOT EXISTS on a natural key,
-- or ON CONFLICT DO UPDATE on tables with a real UNIQUE constraint) so this
-- is safe to re-run.
--
-- What this data validates, section by section:
--   Overview        -> 2 projects over budget (red), 2 at 90%+ (amber), 2 healthy;
--                       6 months of trend data per project
--   By Category     -> Engineering under-budgets Hardware by ~18%, Sales
--                       under-budgets Resource by ~16%, Operations
--                       under-budgets Support by ~20%
--   By Department    -> 3 departments with materially different variance %
--   By Project       -> 6 projects with a real spend/overrun spread
--   By Vendor        -> 4 vendors, 2 of them supplying 2+ projects each
--   RecurringOverrun -> Engineering/Hardware, Sales/Resource, Operations/Support
--                       and Operations/Resource all clear the 15% threshold
--   ContingencyPattern -> Engineering's 2 projects average 50% contingency
--                       drawdown (>= 40% threshold)
--   UnderutilizedBudget -> Client Portal (30% spent) and Helpdesk Tool (25%)
--   VendorConsolidation -> "IoT Sensor Module" and "Edge Gateway Unit" each
--                       bought from 2 vendors at 30%+ different unit prices
--   AllocationInefficiency -> low utilization_percent seeded for 3 employees
--                       in whichever real department has the most headcount
--                       (additive only — see section 10 note)
--   ChangeCostCreep  -> IoT Rollout Alpha (19% of budget) and Client
--                       Onboarding Suite (17%) via approved/implemented CRs
--   Forecast         -> Client Onboarding Suite and Internal Analytics Tool
--                       are both active, over/near-over budget, with a
--                       near-term end date -> should surface as at-risk
--   Benchmark        -> 2 projects per project_type, with a deliberately
--                       wide margin spread within "Client Services" and
--                       "Internal Tool" so the peer comparison is visibly
--                       meaningful, not just two identical numbers
-- ============================================================

-- ── 1. DEPARTMENTS (3, only created if missing) ──
INSERT INTO departments (name, code)
SELECT 'Engineering (Seed)', 'SEED-DEPT-ENG'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'SEED-DEPT-ENG');
INSERT INTO departments (name, code)
SELECT 'Sales (Seed)', 'SEED-DEPT-SALES'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'SEED-DEPT-SALES');
INSERT INTO departments (name, code)
SELECT 'Operations (Seed)', 'SEED-DEPT-OPS'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'SEED-DEPT-OPS');

-- ── 2. PROJECTS (6) ──
-- status is a single shared literal ('active') pulled out of the VALUES
-- list entirely — every row uses it, so it's just a plain constant in the
-- outer SELECT, never passing through the VALUES-derived-table's own type
-- resolution. project_type/department_id vary per row but are both
-- confirmed plain TEXT/soft-UUID columns added by this app's own STEP36
-- migration, so there's no enum-ambiguity risk here either way.
INSERT INTO projects (name, code, description, department_id, project_type, budget, reserved_budget, spent, start_date, end_date, status, created_by)
SELECT v.name, v.code, v.description, d.id, v.project_type, v.budget, v.reserved_budget, v.spent, v.start_date, v.end_date, 'active', admin.id
FROM (VALUES
  ('Seed IoT Rollout Alpha',        'SEED-PRJ-A', 'Seed data for Spend Analyzer validation — on-budget IoT project', 'SEED-DEPT-ENG',   'IoT Deployment',  1000000::numeric, 100000::numeric, 550000::numeric, (CURRENT_DATE-180), (CURRENT_DATE+60)),
  ('Seed IoT Rollout Beta',         'SEED-PRJ-B', 'Seed data for Spend Analyzer validation — over-budget IoT project', 'SEED-DEPT-ENG', 'IoT Deployment',   800000::numeric,  80000::numeric, 900000::numeric, (CURRENT_DATE-200), (CURRENT_DATE+30)),
  ('Seed Client Portal',            'SEED-PRJ-C', 'Seed data for Spend Analyzer validation — underutilized budget',     'SEED-DEPT-SALES','Client Services',  500000::numeric,      0::numeric, 150000::numeric, (CURRENT_DATE-90),  (CURRENT_DATE+90)),
  ('Seed Client Onboarding Suite',  'SEED-PRJ-D', 'Seed data for Spend Analyzer validation — near-budget, at risk',     'SEED-DEPT-SALES','Client Services',  600000::numeric,      0::numeric, 580000::numeric, (CURRENT_DATE-300), (CURRENT_DATE+10)),
  ('Seed Internal Analytics Tool',  'SEED-PRJ-E', 'Seed data for Spend Analyzer validation — over-budget internal tool','SEED-DEPT-OPS',  'Internal Tool',    300000::numeric,  30000::numeric, 320000::numeric, (CURRENT_DATE-150), (CURRENT_DATE+20)),
  ('Seed Internal Helpdesk Tool',   'SEED-PRJ-F', 'Seed data for Spend Analyzer validation — underutilized budget',     'SEED-DEPT-OPS',  'Internal Tool',    400000::numeric,      0::numeric, 100000::numeric, (CURRENT_DATE-60),  (CURRENT_DATE+120))
) AS v(name, code, description, dept_code, project_type, budget, reserved_budget, spent, start_date, end_date)
JOIN departments d ON d.code = v.dept_code
CROSS JOIN (SELECT id FROM profiles WHERE role IN ('admin','ceo') ORDER BY created_at LIMIT 1) admin
WHERE NOT EXISTS (SELECT 1 FROM projects p2 WHERE p2.code = v.code);

-- ── 3. BUDGETS — project-scoped, deliberately under-budgeting the
-- category each department will overrun in (see header). budgets.category
-- is a free-text <input> in BudgetPage.jsx (placeholder "e.g. Software,
-- Travel, Payroll"), not a <select> — confirmed not an enum. ──
INSERT INTO budgets (department_id, project_id, category, fiscal_year, allocated, spent, committed_amount, currency, created_by)
SELECT NULL, p.id, v.category, EXTRACT(YEAR FROM CURRENT_DATE)::int, v.allocated, 0, 0, 'INR', admin.id
FROM (VALUES
  ('SEED-PRJ-A','Hardware',300000::numeric), ('SEED-PRJ-A','Software',150000::numeric),
  ('SEED-PRJ-B','Hardware',200000::numeric), ('SEED-PRJ-B','Software',100000::numeric),
  ('SEED-PRJ-C','Resource',250000::numeric), ('SEED-PRJ-C','Software',100000::numeric),
  ('SEED-PRJ-D','Resource',300000::numeric), ('SEED-PRJ-D','Software',150000::numeric),
  ('SEED-PRJ-E','Hardware',150000::numeric), ('SEED-PRJ-E','Support', 50000::numeric),
  ('SEED-PRJ-F','Software',200000::numeric), ('SEED-PRJ-F','Payroll',100000::numeric)
) AS v(code, category, allocated)
JOIN projects p ON p.code = v.code
CROSS JOIN (SELECT id FROM profiles WHERE role IN ('admin','ceo') ORDER BY created_at LIMIT 1) admin
WHERE NOT EXISTS (SELECT 1 FROM budgets b WHERE b.project_id = p.id AND b.category = v.category AND b.fiscal_year = EXTRACT(YEAR FROM CURRENT_DATE)::int);

-- ── 4. PROJECT_HARDWARE_COSTS — "IoT Sensor Module" and "Edge Gateway
-- Unit" each bought from 2 vendors at 30%+ different unit prices
-- (VendorConsolidation finding), and Engineering's hardware total (590000)
-- deliberately exceeds its 500000 planned budget by 18% (RecurringOverrun).
-- name/vendor/category are all free-text fields (category editable via the
-- CatMgr widget — user-extensible, cannot be a fixed DB enum). ──
INSERT INTO project_hardware_costs (project_id, name, category, qty, unit_price, cost_company, vendor)
SELECT p.id, v.name, 'component', v.qty, v.unit_price, v.cost_company, v.vendor
FROM (VALUES
  ('SEED-PRJ-A','IoT Sensor Module', 200::numeric, 450::numeric,  90000::numeric, 'Acme Supplies'),
  ('SEED-PRJ-A','Edge Gateway Unit',  25::numeric,8000::numeric, 200000::numeric, 'Acme Supplies'),
  ('SEED-PRJ-B','IoT Sensor Module', 150::numeric, 600::numeric,  90000::numeric, 'BetaTech Traders'),
  ('SEED-PRJ-B','Edge Gateway Unit',  20::numeric,10500::numeric,210000::numeric, 'GammaHardware'),
  ('SEED-PRJ-E','Sensor Kit',         30::numeric,4000::numeric, 120000::numeric, 'Acme Supplies')
) AS v(code, name, qty, unit_price, cost_company, vendor)
JOIN projects p ON p.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM project_hardware_costs h WHERE h.project_id = p.id AND h.name = v.name AND h.vendor = v.vendor);

-- ── 5. PROJECT_SOFTWARE_COSTS ──
INSERT INTO project_software_costs (project_id, name, category, cost_company, billing_cycle)
SELECT p.id, v.name, 'saas', v.cost_company, 'monthly'
FROM (VALUES
  ('SEED-PRJ-A','AWS IoT Core',              80000::numeric),
  ('SEED-PRJ-B','Device Management SaaS',    70000::numeric),
  ('SEED-PRJ-C','CRM License',               90000::numeric),
  ('SEED-PRJ-D','Portal SaaS',              140000::numeric),
  ('SEED-PRJ-F','Helpdesk Software License',180000::numeric)
) AS v(code, name, cost_company)
JOIN projects p ON p.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM project_software_costs s WHERE s.project_id = p.id AND s.name = v.name);

-- ── 6. PROJECT_SUPPORT_COSTS — Operations' Support total (60000) exceeds
-- its 50000 planned budget by 20% (RecurringOverrun for Operations/Support). ──
INSERT INTO project_support_costs (project_id, name, category, cost_company, date)
SELECT p.id, 'Maintenance Contract', 'maintenance', 60000, CURRENT_DATE - 15
FROM (SELECT id FROM projects WHERE code = 'SEED-PRJ-E') p
WHERE NOT EXISTS (SELECT 1 FROM project_support_costs s WHERE s.project_id = p.id AND s.name = 'Maintenance Contract');

-- ── 7. CHANGE_REQUESTS — approved/implemented CRs adding a material % to
-- budget (ChangeCostCreep). status/priority are dropdown-driven in the UI
-- (same convention as the confirmed invoices.status enum), so each is kept
-- to its own single-literal statement rather than a multi-row VALUES list. ──
INSERT INTO change_requests (project_id, title, description, reason, priority, status, estimated_hours, actual_hours, estimated_cost, actual_cost, requested_by, created_at)
SELECT p.id, 'Add offline sync mode', 'Sensors need to buffer readings during connectivity gaps', 'Field testing revealed intermittent connectivity at customer sites', 'high', 'approved', 320, 340, 180000, 190000, admin.id, now() - interval '25 days'
FROM (SELECT id FROM projects WHERE code = 'SEED-PRJ-A') p, (SELECT id FROM profiles WHERE role IN ('admin','ceo') ORDER BY created_at LIMIT 1) admin
WHERE NOT EXISTS (SELECT 1 FROM change_requests WHERE project_id = p.id AND title = 'Add offline sync mode');

INSERT INTO change_requests (project_id, title, description, reason, priority, status, estimated_hours, actual_hours, estimated_cost, actual_cost, requested_by, created_at)
SELECT p.id, 'Additional SSO integration', 'Client requested SAML SSO after contract signing', 'Late-breaking client security requirement', 'medium', 'implemented', 180, 190, 95000, 100000, admin.id, now() - interval '40 days'
FROM (SELECT id FROM projects WHERE code = 'SEED-PRJ-D') p, (SELECT id FROM profiles WHERE role IN ('admin','ceo') ORDER BY created_at LIMIT 1) admin
WHERE NOT EXISTS (SELECT 1 FROM change_requests WHERE project_id = p.id AND title = 'Additional SSO integration');

-- ── 8. INVOICES (vendor) — reuses SEED-VEND-1..4 from
-- SEED_demo_data_part2.sql for the By-Vendor rollup; skipped gracefully
-- (0 rows) if those vendors don't exist yet. invoices.status is a
-- CONFIRMED real Postgres enum (invoice_status) — hit this exact error
-- earlier this session — so each row is its own single-literal statement,
-- never a multi-row VALUES list, to guarantee the safe auto-coercion path. ──
INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-01', v.id, p.id, CURRENT_DATE-20, CURRENT_DATE+10, 200000, 200000, 'paid', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-1') v, (SELECT id FROM projects WHERE code='SEED-PRJ-A') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-01');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-02', v.id, p.id, CURRENT_DATE-15, CURRENT_DATE+15, 90000, 90000, 'verified', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-1') v, (SELECT id FROM projects WHERE code='SEED-PRJ-C') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-02');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-03', v.id, p.id, CURRENT_DATE-25, CURRENT_DATE+5, 250000, 250000, 'paid', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-2') v, (SELECT id FROM projects WHERE code='SEED-PRJ-B') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-03');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-04', v.id, p.id, CURRENT_DATE-10, CURRENT_DATE+20, 60000, 60000, 'matched', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-2') v, (SELECT id FROM projects WHERE code='SEED-PRJ-E') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-04');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-05', v.id, p.id, CURRENT_DATE-30, CURRENT_DATE, 180000, 180000, 'paid', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-3') v, (SELECT id FROM projects WHERE code='SEED-PRJ-D') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-05');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-06', v.id, p.id, CURRENT_DATE-12, CURRENT_DATE+18, 70000, 70000, 'verified', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-4') v, (SELECT id FROM projects WHERE code='SEED-PRJ-F') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-06');

INSERT INTO invoices (invoice_number, vendor_id, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT 'SEED-SPEND-INV-07', v.id, p.id, CURRENT_DATE-8, CURRENT_DATE+22, 40000, 40000, 'paid', 'INR'
FROM (SELECT id FROM vendors WHERE code='SEED-VEND-3') v, (SELECT id FROM projects WHERE code='SEED-PRJ-A') p
WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-SPEND-INV-07');

-- ── 9. CUSTOMER_INVOICES — revenue for Overview KPIs + input to profit_margins
-- below. status is confirmed plain TEXT (this app's own STEP34 CHECK
-- constraint), so the bulk VALUES+JOIN pattern is safe here. ──
INSERT INTO customer_invoices (invoice_number, project_id, invoice_date, due_date, subtotal, total_amount, status, currency)
SELECT v.inv_no, p.id, CURRENT_DATE - v.days_ago, CURRENT_DATE + (30 - v.days_ago), v.amount, v.amount, v.status, 'INR'
FROM (VALUES
  ('SEED-CINV-A', 'SEED-PRJ-A', 650000::numeric, 40, 'paid'),
  ('SEED-CINV-B', 'SEED-PRJ-B', 500000::numeric, 20, 'sent'),
  ('SEED-CINV-C', 'SEED-PRJ-C', 260000::numeric, 35, 'paid'),
  ('SEED-CINV-D', 'SEED-PRJ-D', 430000::numeric, 15, 'partially_paid'),
  ('SEED-CINV-E', 'SEED-PRJ-E', 310000::numeric, 28, 'paid'),
  ('SEED-CINV-F', 'SEED-PRJ-F', 150000::numeric, 10, 'sent')
) AS v(inv_no, code, amount, days_ago, status)
JOIN projects p ON p.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM customer_invoices c WHERE c.invoice_number = v.inv_no);

-- ── 10. ACTUAL_COST_SNAPSHOTS — lifetime 'ALL' rows (drive Burn Rate,
-- Forecast, and the Resource category of company_spend_rollup) plus 6
-- months of 'month' rows per project (drive the 12-month trend line). No
-- enum-risk column here (period_type is plain TEXT, this app's own STEP33
-- CHECK constraint) and a real UNIQUE(project_id,period_type,period_key)
-- constraint exists, so ON CONFLICT DO UPDATE is used — re-running this
-- script refreshes the numbers instead of erroring. ──
INSERT INTO actual_cost_snapshots (project_id, period_type, period_key, people_cost, hardware_cost, total_actual_cost, computed_at)
SELECT p.id, 'to_date', 'ALL', v.people_cost, v.hardware_cost, v.people_cost + v.hardware_cost, now()
FROM (VALUES
  ('SEED-PRJ-A', 200000::numeric, 290000::numeric),
  ('SEED-PRJ-B', 150000::numeric, 300000::numeric),
  ('SEED-PRJ-C', 180000::numeric,      0::numeric),
  ('SEED-PRJ-D', 460000::numeric,      0::numeric),
  ('SEED-PRJ-E', 140000::numeric, 120000::numeric),
  ('SEED-PRJ-F',  90000::numeric,      0::numeric)
) AS v(code, people_cost, hardware_cost)
JOIN projects p ON p.code = v.code
ON CONFLICT (project_id, period_type, period_key) DO UPDATE SET
  people_cost = EXCLUDED.people_cost, hardware_cost = EXCLUDED.hardware_cost,
  total_actual_cost = EXCLUDED.total_actual_cost, computed_at = now();

INSERT INTO actual_cost_snapshots (project_id, period_type, period_key, people_cost, hardware_cost, total_actual_cost, computed_at)
SELECT p.id, 'month',
  to_char(date_trunc('month', CURRENT_DATE) - (m.n::text || ' months')::interval, 'YYYY-MM'),
  round(v.people_cost / 6.0 * (0.7 + 0.12 * m.n), 2),
  round(v.hardware_cost / 6.0 * (0.7 + 0.12 * m.n), 2),
  round((v.people_cost + v.hardware_cost) / 6.0 * (0.7 + 0.12 * m.n), 2),
  now()
FROM (VALUES
  ('SEED-PRJ-A', 200000::numeric, 290000::numeric),
  ('SEED-PRJ-B', 150000::numeric, 300000::numeric),
  ('SEED-PRJ-C', 180000::numeric,      0::numeric),
  ('SEED-PRJ-D', 460000::numeric,      0::numeric),
  ('SEED-PRJ-E', 140000::numeric, 120000::numeric),
  ('SEED-PRJ-F',  90000::numeric,      0::numeric)
) AS v(code, people_cost, hardware_cost)
JOIN projects p ON p.code = v.code
CROSS JOIN generate_series(0, 5) AS m(n)
ON CONFLICT (project_id, period_type, period_key) DO UPDATE SET
  people_cost = EXCLUDED.people_cost, hardware_cost = EXCLUDED.hardware_cost,
  total_actual_cost = EXCLUDED.total_actual_cost, computed_at = now();

-- ── 11. PROFIT_MARGINS — computed from the customer_invoices + snapshot
-- data just inserted, so the numbers are always internally consistent.
-- No status/category column at all here (all numeric), so no enum risk
-- regardless of pattern. Deliberately wide margin spread within each
-- project_type pair for a meaningful Benchmark view (Client Services:
-- Portal 30.8% vs Onboarding Suite -7%; Internal Tool: Analytics 16.1%
-- vs Helpdesk 40%). ──
INSERT INTO profit_margins (project_id, period_key, revenue_recognized, total_actual_cost, gross_margin, margin_percent, computed_at)
SELECT p.id, 'ALL',
  COALESCE(rev.total, 0),
  COALESCE(acs.total_actual_cost, 0),
  COALESCE(rev.total, 0) - COALESCE(acs.total_actual_cost, 0),
  CASE WHEN COALESCE(rev.total,0) > 0 THEN round(((COALESCE(rev.total,0) - COALESCE(acs.total_actual_cost,0)) / rev.total) * 100, 2) ELSE 0 END,
  now()
FROM projects p
JOIN (VALUES ('SEED-PRJ-A'),('SEED-PRJ-B'),('SEED-PRJ-C'),('SEED-PRJ-D'),('SEED-PRJ-E'),('SEED-PRJ-F')) AS seed(code) ON seed.code = p.code
LEFT JOIN actual_cost_snapshots acs ON acs.project_id = p.id AND acs.period_type = 'to_date' AND acs.period_key = 'ALL'
LEFT JOIN (
  SELECT project_id, SUM(total_amount) AS total FROM customer_invoices
  WHERE status IN ('sent','partially_paid','paid') GROUP BY project_id
) rev ON rev.project_id = p.id
ON CONFLICT (project_id, period_key) DO UPDATE SET
  revenue_recognized = EXCLUDED.revenue_recognized, total_actual_cost = EXCLUDED.total_actual_cost,
  gross_margin = EXCLUDED.gross_margin, margin_percent = EXCLUDED.margin_percent, computed_at = now();

-- ── 12. CAPACITY_SNAPSHOTS — AllocationInefficiency finding needs a real
-- department with >=3 employees averaging <50% utilization. Rather than
-- inventing fake employees (profiles has a hard FK to auth.users, so fake
-- rows aren't safely creatable here), this reuses whichever REAL department
-- already has the most headcount and adds low-utilization weeks for its
-- first 3 employees. Purely additive — guarded per employee+week against
-- the table's real UNIQUE constraint, so it never overwrites a week your
-- capacity engine already computed; it only fills in weeks that are empty.
-- No status/category column here either (utilization_percent is numeric).
INSERT INTO capacity_snapshots (employee_id, week_start_date, available_hours, allocated_hours, leave_hours, utilization_percent, computed_at)
SELECT e.id,
  (date_trunc('week', CURRENT_DATE) - (w.n::text || ' weeks')::interval)::date,
  40, 40 * 0.3, 0, 25 + w.n * 3, now()
FROM (
  SELECT id FROM profiles
  WHERE department_id = (
    SELECT department_id FROM profiles WHERE department_id IS NOT NULL
    GROUP BY department_id ORDER BY count(*) DESC LIMIT 1
  )
  ORDER BY created_at LIMIT 3
) e
CROSS JOIN generate_series(1, 4) AS w(n)
WHERE NOT EXISTS (
  SELECT 1 FROM capacity_snapshots x
  WHERE x.employee_id = e.id
    AND x.week_start_date = (date_trunc('week', CURRENT_DATE) - (w.n::text || ' weeks')::interval)::date
);

NOTIFY pgrst, 'reload schema';
