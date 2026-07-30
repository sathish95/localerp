-- ============================================================
-- SEED_demo_data_part2.sql — Sample data across the REST of the app:
-- Procurement master data, PR→PO→GRN chain, Expenses, Travel, Assets,
-- Project hardware/software/support costs, Resource Alloc, Tasks/
-- Sprints/Stories.
--
-- Run AFTER SEED_demo_data.sql (and all STEP migrations). Every block
-- is guarded to skip already-seeded rows (matched via a 'SEED-' prefix
-- or SEED-authored marker), so this is safe to re-run.
--
-- NOTE on status columns: project_tasks.status, expense_requests.status
-- and travel_requests.status were flagged this session as POSSIBLY being
-- real Postgres enums, not plain text (mirroring the invoices.status
-- surprise we already hit). To stay safe regardless of which it is, this
-- script never computes those columns via CASE (a CASE over string
-- literals resolves to a concrete `text` type, which fails against an
-- enum without an explicit cast) — each status value is inserted as a
-- single bare literal per statement, which Postgres auto-adapts to
-- whatever the real column type is, enum or text.
-- ============================================================

-- ── 1. CUSTOMERS (10) ──
INSERT INTO customers (code, name, industry, contact_name, email, phone, city, gst_number, status)
SELECT 'SEED-CUST-' || i, 'Seed Customer ' || i, (ARRAY['IoT','Manufacturing','Retail','Healthcare','Logistics'])[1+(i%5)],
  'Contact Person ' || i, 'contact' || i || '@seedcustomer.example', '+9198765432' || lpad(i::text,2,'0'),
  (ARRAY['Bengaluru','Mumbai','Pune','Chennai','Delhi'])[1+(i%5)], NULL, 'active'
FROM generate_series(1,10) i
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE code = 'SEED-CUST-' || i);

-- ── 2. VENDORS (10) ──
INSERT INTO vendors (code, name, email, phone, category, city, gst_number, credit_days, status)
SELECT 'SEED-VEND-' || i, 'Seed Vendor ' || i, 'sales' || i || '@seedvendor.example', '+9199887766' || lpad(i::text,2,'0'),
  (ARRAY['Electronics','Hardware','Software','Logistics','Packaging'])[1+(i%5)],
  (ARRAY['Bengaluru','Mumbai','Pune','Chennai','Delhi'])[1+(i%5)], NULL, 30, 'active'
FROM generate_series(1,10) i
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE code = 'SEED-VEND-' || i);

-- ── 3. PRODUCTS (10) ──
INSERT INTO products (part_number, name, device_type, warranty_months, reorder_level, reorder_qty, standard_cost, is_serialized, status)
SELECT 'SEED-PN-' || i, 'Seed Device Model ' || i, (ARRAY['Sensor','Gateway','Controller','Tracker','Camera'])[1+(i%5)],
  12, 5, 20, 1500 + (i*250), true, 'active'
FROM generate_series(1,10) i
WHERE NOT EXISTS (SELECT 1 FROM products WHERE part_number = 'SEED-PN-' || i);

-- ── 4. DEVICE INSTANCES (10, linked to seeded products + existing customers/projects) ──
WITH prod AS (SELECT id, (row_number() OVER (ORDER BY part_number))::int rn FROM products WHERE part_number LIKE 'SEED-PN-%'),
     proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     cust AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM customers LIMIT 10)
INSERT INTO device_instances (device_code, part_number, serial_number, project_id, customer_id, installed_date, warranty_start, warranty_end, status)
SELECT 'SEED-DEV-' || prod.rn,
  (SELECT part_number FROM products WHERE id = prod.id),
  'SN-SEED-' || lpad(prod.rn::text,6,'0'),
  proj.id, cust.id,
  CURRENT_DATE - (prod.rn * 20), CURRENT_DATE - (prod.rn * 20), CURRENT_DATE - (prod.rn * 20) + 365,
  (ARRAY['deployed','deployed','deployed','in_storage','faulty'])[1 + (prod.rn % 5)]
FROM prod
LEFT JOIN proj ON proj.rn = ((prod.rn - 1) % GREATEST((SELECT count(*) FROM proj),1)) + 1
LEFT JOIN cust ON cust.rn = ((prod.rn - 1) % GREATEST((SELECT count(*) FROM cust),1)) + 1
WHERE NOT EXISTS (SELECT 1 FROM device_instances WHERE device_code = 'SEED-DEV-' || prod.rn);

-- ── 5. PURCHASE REQUISITIONS (10, status fixed to 'approved' — no CASE) + line items ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     vend AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM vendors LIMIT 10),
     requester AS (SELECT id FROM profiles WHERE role IN ('admin','manager','pm','procurement_lead') ORDER BY created_at LIMIT 1)
INSERT INTO purchase_requisitions (pr_number, title, category, justification, priority, required_by, project_id, vendor_id, request_type, chain_type, estimated_amount, estimated_total, requested_by, status)
SELECT 'SEED-PR-' || lpad(proj.rn::text,4,'0'), 'Seed Requisition ' || proj.rn, 'IT Equipment',
  'Seed demo requisition for hardware procurement', 'medium', CURRENT_DATE + 14,
  proj.id, vend.id, 'on_demand', 'short', 45000 + (proj.rn * 5000), 45000 + (proj.rn * 5000),
  (SELECT id FROM requester), 'approved'
FROM proj LEFT JOIN vend ON vend.rn = ((proj.rn - 1) % GREATEST((SELECT count(*) FROM vend),1)) + 1
WHERE NOT EXISTS (SELECT 1 FROM purchase_requisitions WHERE pr_number = 'SEED-PR-' || lpad(proj.rn::text,4,'0'));

INSERT INTO purchase_requisition_items (pr_id, part_number, description, quantity, unit_cost, line_total, sort_order)
SELECT pr.id, 'SEED-PN-01', 'Seed line item', 5, 1750, 8750, 1
FROM purchase_requisitions pr
WHERE pr.pr_number LIKE 'SEED-PR-%'
  AND NOT EXISTS (SELECT 1 FROM purchase_requisition_items i WHERE i.pr_id = pr.id);

-- ── 6. PURCHASE ORDERS (10, chained from the seed PRs above, status fixed to 'sent') ──
INSERT INTO purchase_orders (po_number, vendor_id, pr_id, order_date, delivery_date, subtotal, gst_amount, total_amount, status, terms)
SELECT 'SEED-PO-' || right(pr.pr_number, 4), pr.vendor_id, pr.id,
  CURRENT_DATE - 20, CURRENT_DATE + 10,
  pr.estimated_total, round(pr.estimated_total * 0.18, 2), round(pr.estimated_total * 1.18, 2),
  'sent', 'Net 30'
FROM purchase_requisitions pr
WHERE pr.pr_number LIKE 'SEED-PR-%'
  AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.po_number = 'SEED-PO-' || right(pr.pr_number, 4));

-- ── 7. GRN (10, chained from the seed POs, status fixed to 'received', received_amount populated for 3-way match) ──
-- `items` is passed as a bare '[]' literal, not cast to jsonb: GRNPage.jsx does
-- `typeof selected.items === 'string' ? JSON.parse(...) : selected.items`, which
-- only makes sense if the column is plain TEXT (a real json/jsonb column would
-- already come back from Supabase as a parsed object/array, never a string) —
-- an uncast literal adapts correctly whether the real type is text or json/jsonb.
INSERT INTO grn (grn_number, po_id, received_date, status, remarks, items, received_amount)
SELECT 'SEED-GRN-' || right(po.po_number, 4), po.id, CURRENT_DATE - 5, 'received', 'Seed demo goods receipt',
  '[]', round(po.total_amount * (CASE WHEN right(po.po_number,1)::int % 3 = 0 THEN 0.94 ELSE 1.0 END), 2)
FROM purchase_orders po
WHERE po.po_number LIKE 'SEED-PO-%'
  AND NOT EXISTS (SELECT 1 FROM grn g WHERE g.grn_number = 'SEED-GRN-' || right(po.po_number, 4));

-- ── 8. EXPENSE REQUESTS (10 — split across two statements, each a single fixed status literal) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 6),
     requester AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO expense_requests (expense_number, title, category, description, expense_date, amount, gst_amount, total_amount, project_id, requested_by, status)
SELECT 'SEED-EXP-' || lpad(proj.rn::text,4,'0'), 'Seed Expense ' || proj.rn,
  (ARRAY['Travel','Food & Beverage','Office Supplies','Software','Training','Miscellaneous'])[1+(proj.rn%6)],
  'Seed demo expense', CURRENT_DATE - (proj.rn * 4), 2500 + (proj.rn * 300), 0, 2500 + (proj.rn * 300),
  proj.id, (SELECT id FROM requester), 'submitted'
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM expense_requests WHERE expense_number = 'SEED-EXP-' || lpad(proj.rn::text,4,'0'));

WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 4),
     requester AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO expense_requests (expense_number, title, category, description, expense_date, amount, gst_amount, total_amount, project_id, requested_by, status)
SELECT 'SEED-EXP-' || lpad((proj.rn+6)::text,4,'0'), 'Seed Expense ' || (proj.rn+6),
  (ARRAY['Travel','Accommodation','Utilities','Medical'])[1+(proj.rn%4)],
  'Seed demo expense (approved)', CURRENT_DATE - (proj.rn * 6), 4200 + (proj.rn * 400), 0, 4200 + (proj.rn * 400),
  proj.id, (SELECT id FROM requester), 'approved'
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM expense_requests WHERE expense_number = 'SEED-EXP-' || lpad((proj.rn+6)::text,4,'0'));

-- ── 9. TRAVEL REQUESTS (10 — split across two statements, each a single fixed status literal) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 6),
     requester AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO travel_requests (request_number, from_location, to_location, travel_date, return_date, purpose, travel_mode, estimated_cost, project_id, requested_by, status)
SELECT 'SEED-TRV-' || lpad(proj.rn::text,4,'0'), 'Bengaluru', (ARRAY['Mumbai','Pune','Chennai','Delhi','Hyderabad','Kolkata'])[1+(proj.rn%6)],
  CURRENT_DATE + (proj.rn * 5), CURRENT_DATE + (proj.rn * 5) + 3, 'Seed demo client site visit',
  (ARRAY['Flight','Train','Cab'])[1+(proj.rn%3)], 8000 + (proj.rn * 1200), proj.id, (SELECT id FROM requester), 'submitted'
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM travel_requests WHERE request_number = 'SEED-TRV-' || lpad(proj.rn::text,4,'0'));

WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 4),
     requester AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO travel_requests (request_number, from_location, to_location, travel_date, return_date, purpose, travel_mode, estimated_cost, project_id, requested_by, status)
SELECT 'SEED-TRV-' || lpad((proj.rn+6)::text,4,'0'), 'Bengaluru', (ARRAY['Mumbai','Chennai','Delhi','Pune'])[1+(proj.rn%4)],
  CURRENT_DATE - (proj.rn * 8), CURRENT_DATE - (proj.rn * 8) + 3, 'Seed demo approved travel',
  'Flight', 11000 + (proj.rn * 900), proj.id, (SELECT id FROM requester), 'approved'
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM travel_requests WHERE request_number = 'SEED-TRV-' || lpad((proj.rn+6)::text,4,'0'));

-- ── 10. ASSETS (10) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     emp AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 10)
INSERT INTO assets (asset_code, name, category, make, model, serial_number, purchase_date, purchase_value, assigned_to, status, project_id)
SELECT 'SEED-AST-' || lpad(proj.rn::text,4,'0'), 'Seed Asset ' || proj.rn,
  (ARRAY['Laptop','Desktop','Mobile','Tablet','Server'])[1+(proj.rn%5)],
  (ARRAY['Dell','HP','Lenovo','Apple','Asus'])[1+(proj.rn%5)], 'Model-' || proj.rn,
  'SEED-SN-' || lpad(proj.rn::text,6,'0'), CURRENT_DATE - (proj.rn * 60), 45000 + (proj.rn * 3000),
  emp.id, 'assigned', proj.id
FROM proj LEFT JOIN emp ON emp.rn = proj.rn
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE asset_code = 'SEED-AST-' || lpad(proj.rn::text,4,'0'));

-- ── 11. PROJECT HARDWARE / SOFTWARE / SUPPORT COSTS (10 each) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_hardware_costs (project_id, name, category, qty, unit_price, total_price, cost_company, cost_client, proposal_cost, vendor, notes, created_by)
SELECT proj.id, 'Seed Hardware Item ' || proj.rn, 'component', 5, 3000,
  5*3000, 5*3000, round(5*3000*1.3,2), round(5*3000*1.5,2), 'Seed Vendor ' || proj.rn, 'Seed demo hardware cost', (SELECT id FROM creator)
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM project_hardware_costs WHERE project_id = proj.id AND name = 'Seed Hardware Item ' || proj.rn);

WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_software_costs (project_id, name, category, qty, unit_price, cost_company, cost_client, proposal_cost, billing_cycle, notes, created_by)
SELECT proj.id, 'Seed Software License ' || proj.rn, 'saas', 1, 8000,
  8000, round(8000*1.3,2), round(8000*1.5,2), 'monthly', 'Seed demo software cost', (SELECT id FROM creator)
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM project_software_costs WHERE project_id = proj.id AND name = 'Seed Software License ' || proj.rn);

WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_support_costs (project_id, name, category, cost_company, cost_client, proposal_cost, date, notes, created_by)
SELECT proj.id, 'Seed Support Item ' || proj.rn, 'maintenance', 4000, round(4000*1.3,2), round(4000*1.5,2),
  CURRENT_DATE - (proj.rn*10), 'Seed demo support cost', (SELECT id FROM creator)
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM project_support_costs WHERE project_id = proj.id AND name = 'Seed Support Item ' || proj.rn);

-- ── 12. PROJECT RESOURCE ALLOC (10 — legacy month-bucketed allocation, distinct from the new `allocations` table) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     emp AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 10),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_resource_alloc (project_id, employee_id, allocated_hours, idle_hours, month, year, notes, created_by)
SELECT proj.id, emp.id, 80, 10, extract(month from now())::int, extract(year from now())::int, 'Seed demo allocation', (SELECT id FROM creator)
FROM proj LEFT JOIN emp ON emp.rn = proj.rn
WHERE NOT EXISTS (SELECT 1 FROM project_resource_alloc WHERE project_id = proj.id AND employee_id = emp.id AND month = extract(month from now())::int AND year = extract(year from now())::int);

-- ── 13. SPRINTS (10) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO sprints (name, goal, start_date, end_date, status, project_id, created_by)
SELECT 'Seed Sprint ' || proj.rn, 'Seed demo sprint goal', CURRENT_DATE - 14, CURRENT_DATE + 14, 'active', proj.id, (SELECT id FROM creator)
FROM proj
WHERE NOT EXISTS (SELECT 1 FROM sprints WHERE project_id = proj.id AND name = 'Seed Sprint ' || proj.rn);

-- ── 14. USER STORIES (10) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 10),
     sp AS (SELECT id, project_id FROM sprints WHERE name LIKE 'Seed Sprint %'),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO user_stories (title, story_type, description, priority, story_points, project_id, sprint_id, created_by)
SELECT 'Seed Story ' || proj.rn, 'story', 'Seed demo user story', 'medium', 3 + (proj.rn % 5), proj.id, sp.id, (SELECT id FROM creator)
FROM proj LEFT JOIN sp ON sp.project_id = proj.id
WHERE NOT EXISTS (SELECT 1 FROM user_stories WHERE project_id = proj.id AND title = 'Seed Story ' || proj.rn);

-- ── 15. TASKS (10 — split across two statements, each a single fixed status literal) ──
WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 6),
     emp AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 6),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_tasks (task_name, task_type, module_name, priority, assigned_to, planned_start_date, planned_end_date, estimated_hours, project_id, status, created_by)
SELECT 'Seed Task ' || proj.rn, 'task', 'Seed Module', 'medium', emp.id, CURRENT_DATE, CURRENT_DATE + 7, 8, proj.id, 'backlog', (SELECT id FROM creator)
FROM proj LEFT JOIN emp ON emp.rn = proj.rn
WHERE NOT EXISTS (SELECT 1 FROM project_tasks WHERE project_id = proj.id AND task_name = 'Seed Task ' || proj.rn);

WITH proj AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM projects LIMIT 4),
     emp AS (SELECT id, (row_number() OVER (ORDER BY created_at))::int rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 4),
     creator AS (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
INSERT INTO project_tasks (task_name, task_type, module_name, priority, assigned_to, planned_start_date, planned_end_date, estimated_hours, actual_hours, project_id, status, created_by)
SELECT 'Seed Task ' || (proj.rn+6), 'task', 'Seed Module', 'high', emp.id, CURRENT_DATE - 14, CURRENT_DATE - 2, 12, 13, proj.id, 'closed', (SELECT id FROM creator)
FROM proj LEFT JOIN emp ON emp.rn = proj.rn
WHERE NOT EXISTS (SELECT 1 FROM project_tasks WHERE project_id = proj.id AND task_name = 'Seed Task ' || (proj.rn+6));

NOTIFY pgrst, 'reload schema';
