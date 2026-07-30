-- ============================================================
-- SEED_demo_data.sql — Sample data for Resource Allocation, Skill
-- Matrix, Capacity, and Budget & Finance modules (STEP29–STEP35).
--
-- Run this AFTER all STEP29–STEP35 migrations. NOT part of the
-- STEP-numbered sequence — this is optional demo data, safe to skip
-- or re-run (every block guards against duplicates).
--
-- Uses YOUR existing profiles/projects/vendors/customers/purchase_orders
-- via subqueries — no hardcoded IDs. If a section's prerequisite table
-- is empty (e.g. no purchase_orders yet), that section just inserts
-- fewer rows or none — it will not error.
-- ============================================================

-- ── 1. EMPLOYEE SKILLS (up to 10 employees × 1 skill each) ──
WITH emp AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 10),
     sk  AS (SELECT id, row_number() OVER (ORDER BY skill_name) rn FROM skills LIMIT 10)
INSERT INTO employee_skills (employee_id, skill_id, proficiency_level, years_experience, certified, last_updated)
SELECT emp.id, sk.id,
  (ARRAY['Beginner','Intermediate','Expert','Master'])[1 + (emp.rn % 4)],
  (emp.rn % 8)::numeric,
  (emp.rn % 3 = 0),
  now()
FROM emp JOIN sk ON sk.rn = ((emp.rn - 1) % GREATEST((SELECT count(*) FROM sk),1)) + 1
WHERE EXISTS (SELECT 1 FROM sk)
ON CONFLICT (employee_id, skill_id) DO NOTHING;

-- ── 2. HOLIDAYS (10 sample India holidays, current year) ──
INSERT INTO holidays (holiday_date, name, scope) VALUES
  (make_date(extract(year from now())::int, 1, 26), 'Republic Day', 'company'),
  (make_date(extract(year from now())::int, 3, 14), 'Holi', 'company'),
  (make_date(extract(year from now())::int, 4, 18), 'Good Friday', 'company'),
  (make_date(extract(year from now())::int, 5, 1), 'Labour Day', 'company'),
  (make_date(extract(year from now())::int, 8, 15), 'Independence Day', 'company'),
  (make_date(extract(year from now())::int, 8, 27), 'Ganesh Chaturthi', 'company'),
  (make_date(extract(year from now())::int, 10, 2), 'Gandhi Jayanti', 'company'),
  (make_date(extract(year from now())::int, 10, 21), 'Diwali', 'company'),
  (make_date(extract(year from now())::int, 11, 5), 'Guru Nanak Jayanti', 'company'),
  (make_date(extract(year from now())::int, 12, 25), 'Christmas', 'company')
ON CONFLICT (holiday_date) DO NOTHING;

-- ── 3. ALLOCATIONS (up to 10 employee × project pairings) ──
WITH emp AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 10),
     proj AS (SELECT id, start_date, end_date, row_number() OVER (ORDER BY created_at) rn FROM projects LIMIT 10),
     requester AS (SELECT id FROM profiles WHERE role IN ('admin','manager','pm') ORDER BY created_at LIMIT 1)
INSERT INTO allocations (employee_id, project_id, allocation_percent, allocation_hours_per_week, role_on_project, start_date, end_date, status, requested_by, approved_by, approved_at)
SELECT
  emp.id, proj.id,
  (20 + (emp.rn * 15) % 60)::numeric,
  round(((20 + (emp.rn * 15) % 60) / 100.0 * 40)::numeric, 1),
  (ARRAY['Developer','QA Engineer','Team Lead','Designer','Analyst'])[1 + (emp.rn % 5)],
  COALESCE(proj.start_date, CURRENT_DATE - 30),
  proj.end_date,
  'approved',
  (SELECT id FROM requester), (SELECT id FROM requester), now()
FROM emp JOIN proj ON proj.rn = ((emp.rn - 1) % GREATEST((SELECT count(*) FROM proj),1)) + 1
WHERE EXISTS (SELECT 1 FROM proj)
  AND NOT EXISTS (SELECT 1 FROM allocations a2 WHERE a2.employee_id = emp.id AND a2.project_id = proj.id);

-- ── 4. ROLE RATES (10 common designations) ──
INSERT INTO role_rates (designation, hourly_rate, effective_from, notes)
SELECT d, r, CURRENT_DATE - 180, 'Seed demo rate'
FROM (VALUES
  ('Software Engineer', 650), ('Senior Software Engineer', 950), ('Project Manager', 1100),
  ('QA Engineer', 550), ('DevOps Engineer', 850), ('UI/UX Designer', 700),
  ('Business Analyst', 750), ('Technical Lead', 1200), ('Intern', 250), ('Consultant', 1500)
) AS v(d, r)
WHERE NOT EXISTS (SELECT 1 FROM role_rates rr WHERE rr.designation = v.d);

-- ── 5. BUDGET REVISIONS (one per existing budget, up to 10) ──
WITH b AS (SELECT id, allocated, row_number() OVER (ORDER BY created_at) rn FROM budgets LIMIT 10),
     requester AS (SELECT id FROM profiles WHERE role IN ('admin','finance','ceo') ORDER BY created_at LIMIT 1),
     reviewer AS (SELECT id FROM profiles WHERE role IN ('admin','finance','ceo') ORDER BY created_at DESC LIMIT 1)
INSERT INTO budget_revisions (budget_id, revision_number, previous_allocated, requested_allocated, delta, reason, status, requested_by, reviewed_by, reviewed_at)
SELECT
  b.id, 1, b.allocated, round(b.allocated * 1.1, 2), round(b.allocated * 0.1, 2),
  'Seed demo: scope increase requested for additional deliverables',
  CASE WHEN b.rn % 3 = 0 THEN 'rejected' WHEN b.rn % 3 = 1 THEN 'approved' ELSE 'pending_review' END,
  (SELECT id FROM requester),
  CASE WHEN b.rn % 3 = 0 THEN (SELECT id FROM reviewer) WHEN b.rn % 3 = 1 THEN (SELECT id FROM reviewer) ELSE NULL END,
  CASE WHEN b.rn % 3 IN (0,1) THEN now() ELSE NULL END
FROM b
WHERE EXISTS (SELECT 1 FROM b)
  AND NOT EXISTS (SELECT 1 FROM budget_revisions br2 WHERE br2.budget_id = b.id AND br2.reason LIKE 'Seed demo:%');

-- Actually apply the 'approved' ones to budgets.allocated, matching what the app does on approval
UPDATE budgets SET allocated = br.requested_allocated
FROM budget_revisions br
WHERE budgets.id = br.budget_id AND br.status = 'approved' AND br.reason LIKE 'Seed demo:%';

-- ── 6. MILESTONE BILLING (invoice_amount on up to 10 milestones) ──
-- Ordered by due_date (not created_at) — project_milestones is loaded that way
-- everywhere else in the app (see ProjectsPage.jsx), safer bet on its real schema.
WITH m AS (SELECT id, COALESCE(budget,50000) budget, row_number() OVER (ORDER BY due_date NULLS LAST) rn FROM project_milestones LIMIT 10)
UPDATE project_milestones pm
SET invoice_amount = round(m.budget * 0.5, 2)
FROM m WHERE pm.id = m.id AND (pm.invoice_amount IS NULL OR pm.invoice_amount = 0);

-- ── 7. VENDOR INVOICES — 3-way match demo (up to 10, against existing POs) ──
-- purchase_orders has no direct project_id column — it links to the project via
-- pr_id -> purchase_requisitions.project_id (confirmed from PurchaseOrdersPage.jsx's
-- own query, which joins pr:purchase_requisitions(...), not a direct project_id).
WITH po AS (
  SELECT po.id, po.vendor_id, pr.project_id, po.total_amount, (row_number() OVER (ORDER BY po.created_at))::int rn
  FROM purchase_orders po LEFT JOIN purchase_requisitions pr ON pr.id = po.pr_id
  LIMIT 10
),
     creator AS (SELECT id FROM profiles WHERE role IN ('admin','finance') ORDER BY created_at LIMIT 1)
INSERT INTO invoices (invoice_number, vendor_id, invoice_date, due_date, subtotal, gst_amount, total_amount, status, project_id, po_id, created_by)
SELECT
  'SEED-INV-' || lpad(po.rn::text, 4, '0'),
  po.vendor_id, CURRENT_DATE - (po.rn * 3), CURRENT_DATE - (po.rn * 3) + 30,
  round(po.total_amount * (CASE WHEN po.rn % 4 = 0 THEN 1.08 ELSE 1.0 END) / 1.18, 2),
  round(po.total_amount * (CASE WHEN po.rn % 4 = 0 THEN 1.08 ELSE 1.0 END) * 0.18 / 1.18, 2),
  round(po.total_amount * (CASE WHEN po.rn % 4 = 0 THEN 1.08 ELSE 1.0 END), 2),
  (CASE WHEN po.rn % 5 = 0 THEN 'paid' ELSE 'verified' END)::invoice_status,
  po.project_id, po.id, (SELECT id FROM creator)
FROM po
WHERE EXISTS (SELECT 1 FROM po) AND NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'SEED-INV-' || lpad(po.rn::text, 4, '0'));

-- Run the 3-way match verdict directly (mirrors src/lib/threeWayMatch.js's logic):
-- matched if within ±5% of the PO amount, else flagged as a variance.
UPDATE invoices i SET
  match_status = CASE WHEN abs((i.total_amount - po.total_amount) / NULLIF(po.total_amount,0) * 100) <= 5 THEN 'matched' ELSE 'variance' END,
  variance_percent = round((i.total_amount - po.total_amount) / NULLIF(po.total_amount,0) * 100, 2)
FROM purchase_orders po
WHERE i.po_id = po.id AND i.invoice_number LIKE 'SEED-INV-%';

-- ── 8. CUSTOMER INVOICES (up to 10 — half against billed milestones, half project-level) ──
WITH billed_ms AS (
  SELECT pm.id AS milestone_id, pm.project_id, pm.invoice_amount, (row_number() OVER (ORDER BY pm.due_date NULLS LAST))::int rn
  FROM project_milestones pm WHERE pm.invoice_amount > 0 LIMIT 5
),
proj AS (SELECT id, customer_id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 5)
INSERT INTO customer_invoices (invoice_number, project_id, milestone_id, customer_id, invoice_date, due_date, subtotal, gst_amount, total_amount, status)
SELECT
  'SEED-CINV-' || lpad(billed_ms.rn::text, 4, '0'), billed_ms.project_id, billed_ms.milestone_id, NULL,
  CURRENT_DATE - (billed_ms.rn * 10), CURRENT_DATE - (billed_ms.rn * 10) + 30,
  round(billed_ms.invoice_amount / 1.18, 2), round(billed_ms.invoice_amount * 0.18 / 1.18, 2), billed_ms.invoice_amount,
  (ARRAY['sent','paid','partially_paid','sent','sent'])[billed_ms.rn]
FROM billed_ms
WHERE NOT EXISTS (SELECT 1 FROM customer_invoices WHERE invoice_number = 'SEED-CINV-' || lpad(billed_ms.rn::text, 4, '0'))
UNION ALL
SELECT
  'SEED-CINV-' || lpad((proj.rn + 5)::text, 4, '0'), proj.id, NULL, proj.customer_id,
  CURRENT_DATE - (proj.rn * 15) - 60, CURRENT_DATE - (proj.rn * 15) - 30,
  round(200000 / 1.18, 2), round(200000 * 0.18 / 1.18, 2), 200000,
  (ARRAY['paid','sent','sent','partially_paid','sent'])[proj.rn]
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM customer_invoices WHERE invoice_number = 'SEED-CINV-' || lpad((proj.rn + 5)::text, 4, '0'));

-- Mark the billed milestones as invoiced, matching what the app does on invoice creation
UPDATE project_milestones pm SET billing_status = 'invoiced', invoiced_at = now()
FROM customer_invoices ci WHERE ci.milestone_id = pm.id AND ci.invoice_number LIKE 'SEED-CINV-%';

-- ── 9. PAYMENTS (against the seeded invoices marked paid/partially_paid) ──
-- payments has no natural unique key to conflict on, so each block guards with
-- NOT EXISTS against the specific invoice already having a seed payment,
-- keeping this section safe to re-run.
INSERT INTO payments (invoice_type, invoice_id, amount, payment_date, payment_method, reference_number)
SELECT 'vendor', i.id, i.total_amount, i.due_date - 5, 'bank_transfer', 'SEED-TXN-' || row_number() OVER (ORDER BY i.created_at)
FROM invoices i WHERE i.invoice_number LIKE 'SEED-INV-%' AND i.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_type = 'vendor' AND p.invoice_id = i.id);

INSERT INTO payments (invoice_type, invoice_id, amount, payment_date, payment_method, reference_number)
SELECT 'customer', ci.id, ci.total_amount, ci.due_date - 5, 'bank_transfer', 'SEED-RCPT-' || row_number() OVER (ORDER BY ci.created_at)
FROM customer_invoices ci WHERE ci.invoice_number LIKE 'SEED-CINV-%' AND ci.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_type = 'customer' AND p.invoice_id = ci.id);

INSERT INTO payments (invoice_type, invoice_id, amount, payment_date, payment_method, reference_number)
SELECT 'customer', ci.id, round(ci.total_amount * 0.5, 2), ci.due_date - 10, 'upi', 'SEED-RCPT-P' || row_number() OVER (ORDER BY ci.created_at)
FROM customer_invoices ci WHERE ci.invoice_number LIKE 'SEED-CINV-%' AND ci.status = 'partially_paid'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_type = 'customer' AND p.invoice_id = ci.id);

NOTIFY pgrst, 'reload schema';
