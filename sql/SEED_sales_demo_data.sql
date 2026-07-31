-- ============================================================
-- SEED_sales_demo_data.sql — Sample data for the Sales & Pre-Sales CRM
-- module (STEP68-74).
--
-- Run this AFTER STEP68-74. NOT part of the STEP-numbered sequence —
-- optional demo data, safe to skip or re-run (every block is guarded
-- against duplicates via ON CONFLICT / NOT EXISTS). Follows the same
-- convention as SEED_demo_data.sql: uses YOUR existing profiles/products
-- via subqueries, no hardcoded UUIDs — if a prerequisite table is empty
-- (e.g. no products yet), that section just inserts fewer rows or none.
--
-- Caveat: sales_leads.status = 'Unassigned — Needs Coverage' rows seeded
-- here are for LIST/UI testing only — the actual coverage-gap
-- NOTIFICATION (src/lib/salesLeads.js's alertCoverageGap()) is JS-driven
-- and only fires when a Lead is created through the app, not via raw
-- SQL insert. To test that specific alert, create a new Lead in the UI
-- for a domain+region with no matching Sales Role Definition (e.g. pick
-- a region no role definition below covers).
--
-- sales_regions (North/South/East/West) and every admin-config lookup
-- list (sales_pipeline_stages, sales_lead_sources, sales_activity_types,
-- sales_task_types, sales_activity_outcomes, sales_stale_threshold_config)
-- are already seeded by STEP68/STEP69 — nothing to add here.
-- ============================================================

-- ── 1. SALES ROLE DEFINITIONS — a representative slice of the
-- Direction × Domain × Region matrix, not the full cross-product ──
INSERT INTO sales_role_definitions (direction, domain, region_id, role_title)
SELECT direction, domain, region_id, role_title FROM (
  SELECT 'Outbound'::text direction, 'B2B'::text domain, (SELECT id FROM sales_regions WHERE region_name='North') region_id, 'Outbound B2B — North' role_title
  UNION ALL SELECT 'Inbound', 'B2B', (SELECT id FROM sales_regions WHERE region_name='North'), 'Inbound B2B — North'
  UNION ALL SELECT 'Outbound', 'B2B', (SELECT id FROM sales_regions WHERE region_name='South'), 'Outbound B2B — South'
  UNION ALL SELECT 'Outbound', 'B2C', (SELECT id FROM sales_regions WHERE region_name='West'), 'Outbound B2C — West'
  UNION ALL SELECT 'Inbound', 'D2C', NULL, 'Inbound D2C — Online (All Regions)'
  UNION ALL SELECT 'Outbound', 'Government', (SELECT id FROM sales_regions WHERE region_name='East'), 'Outbound Government — East'
  UNION ALL SELECT 'Outbound', 'Non-Government', (SELECT id FROM sales_regions WHERE region_name='South'), 'Outbound Non-Government — South'
) v
WHERE NOT EXISTS (
  SELECT 1 FROM sales_role_definitions rd
  WHERE rd.direction = v.direction AND rd.domain = v.domain AND rd.role_title = v.role_title
);

-- ── 2. SALES REP ASSIGNMENTS — round-robins up to 6 existing profiles
-- across the role definitions above, regardless of their current
-- profiles.role (a SalesRepAssignment is independent of the auth role —
-- auto-assignment logic only reads this table). Promote a specific test
-- user's profiles.role to 'sales_rep'/'sales_head'/etc. separately via
-- Settings -> Roles & Modules if you want to test role-gated page access
-- as that persona; admin/ceo already see every Sales page. ──
WITH emp AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 6),
     rd  AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM sales_role_definitions)
INSERT INTO sales_rep_assignments (profile_id, sales_role_definition_id, active_from)
SELECT emp.id, rd.id, CURRENT_DATE - 90
FROM emp JOIN rd ON rd.rn = ((emp.rn - 1) % GREATEST((SELECT count(*) FROM rd),1)) + 1
WHERE EXISTS (SELECT 1 FROM rd)
  AND NOT EXISTS (SELECT 1 FROM sales_rep_assignments a WHERE a.profile_id = emp.id AND a.sales_role_definition_id = rd.id);

-- ── 3. LEADS — spread across domains/regions/statuses, assigned via the
-- rep assignments above where one exists; a couple intentionally
-- unassigned to populate the "Needs Coverage" view. ──
WITH rep AS (SELECT profile_id, row_number() OVER (ORDER BY created_at) rn FROM sales_rep_assignments),
     n   AS (SELECT id FROM sales_regions WHERE region_name='North'),
     s   AS (SELECT id FROM sales_regions WHERE region_name='South'),
     e   AS (SELECT id FROM sales_regions WHERE region_name='East'),
     w   AS (SELECT id FROM sales_regions WHERE region_name='West'),
     prod AS (SELECT part_number FROM products ORDER BY created_at LIMIT 1)
INSERT INTO sales_leads (lead_number, source, domain, region_id, contact_name, company_name, product_interest_id, status, assigned_rep_id, coverage_alert_sent_at, created_at)
SELECT * FROM (VALUES
  ('LEAD-SEED-01','Website','B2B',(SELECT id FROM n),'Ananya Rao','Verde Logistics',(SELECT part_number FROM prod),'New',(SELECT profile_id FROM rep WHERE rn=1),NULL,now() - interval '9 days'),
  ('LEAD-SEED-02','Referral','B2B',(SELECT id FROM n),'Karan Mehta','Orbit Cold Chain',(SELECT part_number FROM prod),'Contacted',(SELECT profile_id FROM rep WHERE rn=2),NULL,now() - interval '7 days'),
  ('LEAD-SEED-03','Cold Outreach','B2B',(SELECT id FROM s),'Divya Nair','Sundar Textiles',NULL,'Qualified',(SELECT profile_id FROM rep WHERE rn=3),NULL,now() - interval '15 days'),
  ('LEAD-SEED-04','Campaign','B2C',(SELECT id FROM w),'Rohit Verma',NULL,NULL,'New',(SELECT profile_id FROM rep WHERE rn=4),NULL,now() - interval '3 days'),
  ('LEAD-SEED-05','Website','D2C',NULL,'Priya Iyer',NULL,NULL,'Contacted',(SELECT profile_id FROM rep WHERE rn=1),NULL,now() - interval '2 days'),
  ('LEAD-SEED-06','Inbound Call','D2C',NULL,'Farhan Sheikh',NULL,NULL,'Disqualified',(SELECT profile_id FROM rep WHERE rn=2),NULL,now() - interval '20 days'),
  ('LEAD-SEED-07','Tender Portal','Government',(SELECT id FROM e),'Suresh Kulkarni','Directorate of Water Supply',NULL,'Qualified',(SELECT profile_id FROM rep WHERE rn=5),NULL,now() - interval '25 days'),
  ('LEAD-SEED-08','Referral','Non-Government',(SELECT id FROM s),'Meera Pillai','Bharat Foundation Trust',NULL,'New',(SELECT profile_id FROM rep WHERE rn=6),NULL,now() - interval '5 days'),
  ('LEAD-SEED-09','Cold Outreach','B2B',(SELECT id FROM s),'Vikram Shah','Nimbus Agro Exports',NULL,'Unassigned — Needs Coverage',NULL,now() - interval '1 day',now() - interval '1 day'),
  ('LEAD-SEED-10','Website','B2C',(SELECT id FROM e),'Ishaan Kapoor',NULL,NULL,'Unassigned — Needs Coverage',NULL,now() - interval '4 hours',now() - interval '4 hours')
) AS v(lead_number, source, domain, region_id, contact_name, company_name, product_interest_id, status, assigned_rep_id, coverage_alert_sent_at, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sales_leads l WHERE l.lead_number = v.lead_number);

-- ── 4. OPPORTUNITIES — a few Open (various stages), one Won, one Lost.
-- pipeline_stage picks a real seeded stage for that domain so the stage
-- dropdown in Opportunity detail matches immediately. ──
WITH rep AS (SELECT profile_id, row_number() OVER (ORDER BY created_at) rn FROM sales_rep_assignments),
     n AS (SELECT id FROM sales_regions WHERE region_name='North'),
     s AS (SELECT id FROM sales_regions WHERE region_name='South'),
     w AS (SELECT id FROM sales_regions WHERE region_name='West'),
     st_b2b_early  AS (SELECT stage_name, default_probability_percent FROM sales_pipeline_stages WHERE domain='B2B' ORDER BY sort_order LIMIT 1),
     st_b2b_mid    AS (SELECT stage_name, default_probability_percent FROM sales_pipeline_stages WHERE domain='B2B' ORDER BY sort_order OFFSET 2 LIMIT 1),
     st_b2b_late   AS (SELECT stage_name, default_probability_percent FROM sales_pipeline_stages WHERE domain='B2B' ORDER BY sort_order DESC LIMIT 1),
     st_b2c_mid    AS (SELECT stage_name, default_probability_percent FROM sales_pipeline_stages WHERE domain='B2C' ORDER BY sort_order OFFSET 1 LIMIT 1),
     lead3 AS (SELECT id FROM sales_leads WHERE lead_number='LEAD-SEED-03')
INSERT INTO sales_opportunities (opportunity_number, lead_id, domain, region_id, assigned_rep_id, pipeline_stage, expected_close_date, expected_value, probability_percent, status, source_type, created_at)
SELECT * FROM (VALUES
  ('OPP-SEED-01', (SELECT id FROM lead3), 'B2B', (SELECT id FROM s), (SELECT profile_id FROM rep WHERE rn=3), (SELECT stage_name FROM st_b2b_mid), (CURRENT_DATE + 30), 850000::numeric, (SELECT default_probability_percent FROM st_b2b_mid), 'Open', 'Direct', now() - interval '10 days'),
  ('OPP-SEED-02', NULL, 'B2B', (SELECT id FROM n), (SELECT profile_id FROM rep WHERE rn=1), (SELECT stage_name FROM st_b2b_early), (CURRENT_DATE + 60), 420000::numeric, (SELECT default_probability_percent FROM st_b2b_early), 'Open', 'Direct', now() - interval '4 days'),
  ('OPP-SEED-03', NULL, 'B2C', (SELECT id FROM w), (SELECT profile_id FROM rep WHERE rn=4), (SELECT stage_name FROM st_b2c_mid), (CURRENT_DATE + 14), 95000::numeric, (SELECT default_probability_percent FROM st_b2c_mid), 'Open', 'Direct', now() - interval '2 days'),
  ('OPP-SEED-04', NULL, 'B2B', (SELECT id FROM n), (SELECT profile_id FROM rep WHERE rn=2), (SELECT stage_name FROM st_b2b_late), (CURRENT_DATE - 5), 610000::numeric, 100, 'Won', 'Direct', now() - interval '45 days'),
  ('OPP-SEED-05', NULL, 'B2B', (SELECT id FROM s), (SELECT profile_id FROM rep WHERE rn=3), (SELECT stage_name FROM st_b2b_mid), (CURRENT_DATE - 10), 300000::numeric, 0, 'Lost', 'Direct', now() - interval '30 days')
) AS v(opportunity_number, lead_id, domain, region_id, assigned_rep_id, pipeline_stage, expected_close_date, expected_value, probability_percent, status, source_type, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sales_opportunities o WHERE o.opportunity_number = v.opportunity_number);

INSERT INTO sales_stage_audit_log (opportunity_id, from_stage, to_stage, changed_at)
SELECT o.id, NULL, o.pipeline_stage, o.created_at FROM sales_opportunities o
WHERE o.opportunity_number LIKE 'OPP-SEED-%'
  AND NOT EXISTS (SELECT 1 FROM sales_stage_audit_log l WHERE l.opportunity_id = o.id);

-- ── 5. ACTIVITIES — a few calls/meetings against Leads and Opportunities ──
WITH performer AS (SELECT id FROM profiles WHERE is_active IS NOT FALSE ORDER BY created_at LIMIT 1)
INSERT INTO sales_activities (related_to_type, related_to_id, activity_type, direction, performed_by, activity_date, duration_minutes, notes, outcome, next_follow_up_date)
SELECT 'Lead', l.id, 'Call', 'Outbound', (SELECT id FROM performer), l.created_at + interval '1 day', 18, 'Discussed requirements, sent brochure.', 'Interested', (CURRENT_DATE + 5)
FROM sales_leads l WHERE l.lead_number = 'LEAD-SEED-02'
  AND NOT EXISTS (SELECT 1 FROM sales_activities a WHERE a.related_to_type='Lead' AND a.related_to_id=l.id);

WITH performer AS (SELECT id FROM profiles WHERE is_active IS NOT FALSE ORDER BY created_at LIMIT 1)
INSERT INTO sales_activities (related_to_type, related_to_id, activity_type, direction, performed_by, activity_date, duration_minutes, notes, outcome)
SELECT 'Opportunity', o.id, 'Demo', 'Outbound', (SELECT id FROM performer), o.created_at + interval '2 days', 45, 'Product demo well received, awaiting technical sign-off.', 'Follow-up Scheduled'
FROM sales_opportunities o WHERE o.opportunity_number = 'OPP-SEED-01'
  AND NOT EXISTS (SELECT 1 FROM sales_activities a WHERE a.related_to_type='Opportunity' AND a.related_to_id=o.id);

-- ── 6. TASKS — a couple open, one overdue, one high priority ──
WITH assignee AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 4)
INSERT INTO sales_tasks (related_to_type, related_to_id, task_type, assigned_to, due_date, priority, status)
SELECT 'Lead', l.id, 'Follow-up Call', (SELECT id FROM assignee WHERE rn=1), CURRENT_DATE - 2, 'High', 'Open'
FROM sales_leads l WHERE l.lead_number='LEAD-SEED-01'
  AND NOT EXISTS (SELECT 1 FROM sales_tasks t WHERE t.related_to_type='Lead' AND t.related_to_id=l.id AND t.task_type='Follow-up Call');

WITH assignee AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 4)
INSERT INTO sales_tasks (related_to_type, related_to_id, task_type, assigned_to, due_date, priority, status)
SELECT 'Opportunity', o.id, 'Send Proposal', (SELECT id FROM assignee WHERE rn=2), CURRENT_DATE + 3, 'Medium', 'Open'
FROM sales_opportunities o WHERE o.opportunity_number='OPP-SEED-01'
  AND NOT EXISTS (SELECT 1 FROM sales_tasks t WHERE t.related_to_type='Opportunity' AND t.related_to_id=o.id AND t.task_type='Send Proposal');

WITH assignee AS (SELECT id, row_number() OVER (ORDER BY created_at) rn FROM profiles WHERE is_active IS NOT FALSE LIMIT 4)
INSERT INTO sales_tasks (related_to_type, related_to_id, task_type, assigned_to, due_date, priority, status)
SELECT 'Lead', l.id, 'Document Collection', (SELECT id FROM assignee WHERE rn=3), CURRENT_DATE + 1, 'Low', 'In Progress'
FROM sales_leads l WHERE l.lead_number='LEAD-SEED-07'
  AND NOT EXISTS (SELECT 1 FROM sales_tasks t WHERE t.related_to_type='Lead' AND t.related_to_id=l.id AND t.task_type='Document Collection');

-- ── 7. PRODUCT LAUNCHES + interest signals ──
INSERT INTO product_launches (product_name, description, target_launch_date, development_stage)
SELECT * FROM (VALUES
  ('EdgeSense Mini','Compact IoT sensor node for cold-chain monitoring', CURRENT_DATE + 60, 'Pilot-Ready'),
  ('NeoGateway X2','Next-gen LTE/5G gateway with on-device inference', CURRENT_DATE + 150, 'Development'),
  ('AgroTrack Lite','Low-cost soil moisture + weather tracker for smallholder farms', CURRENT_DATE + 240, 'Concept')
) AS v(product_name, description, target_launch_date, development_stage)
WHERE NOT EXISTS (SELECT 1 FROM product_launches p WHERE p.product_name = v.product_name);

INSERT INTO product_launch_interest (lead_id, opportunity_id, product_launch_id, notes)
SELECT l.id, NULL, pl.id, 'Asked about cold-chain sensor availability for Q3 rollout.'
FROM sales_leads l, product_launches pl
WHERE l.lead_number = 'LEAD-SEED-02' AND pl.product_name = 'EdgeSense Mini'
  AND NOT EXISTS (SELECT 1 FROM product_launch_interest i WHERE i.lead_id = l.id AND i.product_launch_id = pl.id);

INSERT INTO product_launch_interest (lead_id, opportunity_id, product_launch_id, notes)
SELECT NULL, o.id, pl.id, 'Customer wants gateway roadmap before committing to volume.'
FROM sales_opportunities o, product_launches pl
WHERE o.opportunity_number = 'OPP-SEED-01' AND pl.product_name = 'NeoGateway X2'
  AND NOT EXISTS (SELECT 1 FROM product_launch_interest i WHERE i.opportunity_id = o.id AND i.product_launch_id = pl.id);

-- ── 8. TENDERS ──
INSERT INTO sales_tenders (tender_number, issuing_body, submission_deadline, bid_amount, status)
SELECT * FROM (VALUES
  ('GEM/2026/TND/00417','Directorate of Water Supply', CURRENT_DATE + 21, 1250000::numeric, 'Under Evaluation'),
  ('GEM/2026/TND/00512','State Smart City Mission', CURRENT_DATE + 45, 2400000::numeric, 'Documents Prepared')
) AS v(tender_number, issuing_body, submission_deadline, bid_amount, status)
WHERE NOT EXISTS (SELECT 1 FROM sales_tenders t WHERE t.tender_number = v.tender_number);

-- ── 9. PILOT PROJECTS ──
WITH prod AS (SELECT part_number FROM products ORDER BY created_at LIMIT 1)
INSERT INTO sales_pilot_projects (prospect_name, product_piloted, pilot_cost, pilot_duration, start_date, end_date, conversion_outcome, conversion_reason)
SELECT * FROM (VALUES
  ('Greenfield Community Hospital', (SELECT part_number FROM prod), 15000::numeric, '6 weeks', CURRENT_DATE - 70, CURRENT_DATE - 28, 'Converted', NULL),
  ('Nilgiri Tea Estates', (SELECT part_number FROM prod), 8000::numeric, '4 weeks', CURRENT_DATE - 40, CURRENT_DATE - 12, 'Not Converted', 'Sensor accuracy dropped in high-humidity conditions — routed to engineering.')
) AS v(prospect_name, product_piloted, pilot_cost, pilot_duration, start_date, end_date, conversion_outcome, conversion_reason)
WHERE NOT EXISTS (SELECT 1 FROM sales_pilot_projects pp WHERE pp.prospect_name = v.prospect_name);

-- ── 10. BOOTSTRAP / STARTUP PROGRAM + its marketing budget line ──
INSERT INTO sales_marketing_budget_lines (period_label, planned_amount, notes)
SELECT 'FY2026', 500000::numeric, 'Seed demo: annual Bootstrap/Startup Program allocation'
WHERE NOT EXISTS (SELECT 1 FROM sales_marketing_budget_lines b WHERE b.period_label = 'FY2026');

WITH prod AS (SELECT part_number FROM products ORDER BY created_at LIMIT 1),
     bl AS (SELECT id FROM sales_marketing_budget_lines WHERE period_label='FY2026' LIMIT 1)
INSERT INTO sales_bootstrap_programs (program_name, target_segment, participant_company_name, product_provided, cost_absorbed, marketing_budget_line_id, program_duration, status)
SELECT * FROM (VALUES
  ('IoT Founders Cohort 3','Startups','Lumen Robotics', (SELECT part_number FROM prod), 45000::numeric, (SELECT id FROM bl), '3 months', 'Active'),
  ('Incubator Partnership Pilot','Incubators','T-Hub Deep Tech', (SELECT part_number FROM prod), 60000::numeric, (SELECT id FROM bl), '6 months', 'Completed')
) AS v(program_name, target_segment, participant_company_name, product_provided, cost_absorbed, marketing_budget_line_id, program_duration, status)
WHERE NOT EXISTS (SELECT 1 FROM sales_bootstrap_programs b WHERE b.program_name = v.program_name);

NOTIFY pgrst, 'reload schema';
