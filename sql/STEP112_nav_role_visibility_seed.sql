-- ============================================================
-- STEP112: Seed module_role_visibility from Layout.jsx's ALL_NAV
-- hardcoded `roles: [...]` arrays, then Layout.jsx stops checking those
-- arrays entirely (removed in the same change as this migration).
--
-- Why: ALL_NAV items with a `roles` filter were gated in TWO places —
-- the hardcoded array (checked first, in code) AND module_role_visibility
-- (checked second, editable in Settings -> Roles & Modules). Because the
-- hardcoded check ran first, admins could toggle a role's visibility for
-- e.g. "Products" or "Fund Flow" in Settings and see NO effect, since the
-- array excluded that role before the DB check ever ran. This migration
-- converts every one of those hardcoded arrays into equivalent
-- module_role_visibility rows (visible=false for every role the array
-- excluded), so removing the array from Layout.jsx doesn't change
-- anything a user actually sees today — it just makes the setting that
-- was already implicitly controlling visibility become the ONE setting
-- that does, and makes it admin-editable for the first time.
--
-- admin/ceo are never seeded (module_role_visibility is never consulted
-- for them — isTabVisible() hardcodes an unconditional bypass).
--
-- Run AFTER STEP42 (roles table), STEP43 (modules/module_role_visibility
-- tables + organization_id retrofit in STEP89). Safe to re-run.
-- ============================================================

-- Step 1: make sure every module in src/config/modules.js's MODULES list
-- has a row for every existing organization, so the visibility seed below
-- always has something to join against — don't depend on an admin/ceo
-- having already loaded the app once to trigger syncModulesFromConfig().
INSERT INTO modules (organization_id, key, label)
SELECT o.id, v.key, v.label
FROM organizations o
CROSS JOIN (VALUES
  ('dashboard','Dashboard'), ('knowledge-base','Knowledge Base'),
  ('expenses','Expenses'), ('travel','Travel Requests'), ('approvals','Approvals'),
  ('projects','Projects'), ('tasks','Task Management'), ('neo-task-ai','Neo Task AI'), ('budget','Budget'), ('assets','Assets'),
  ('skill-matrix','Skill Matrix'), ('allocations','Allocations'), ('capacity','Capacity'),
  ('products','Product'), ('bom','BOM'), ('inventory','Component'), ('devices','Devices'),
  ('procurement','Purchase Request'), ('warranty','Warranty'), ('pos','PO'), ('invoices','Invoice'), ('grn','GRN'),
  ('customers','Customers'), ('vendors','Vendors'), ('fundflow','Fund Flow'),
  ('proposals','Proposals'),
  ('sales-leads','Leads'), ('sales-landing-links','Landing Links'), ('sales-meeting-pages','Meeting Booking Pages'),
  ('sales-opportunities','Opportunities'), ('sales-tasks','Sales Tasks'), ('sales-product-launches','Product Launches'),
  ('sales-tenders','Tenders'), ('sales-pilot-projects','Pilot Projects'), ('sales-bootstrap-programs','Bootstrap Program'),
  ('sales-timeline','Sales Timeline'), ('sales-dashboard','Sales Dashboard'),
  ('marketing-campaigns','Campaigns'), ('marketing-landing-pages','Landing Pages'),
  ('marketing-content-assets','Content Assets'), ('marketing-calendar','Marketing Calendar'),
  ('performance-cycles','Review Cycles'), ('my-performance','My Performance'), ('team-reviews','Team Reviews'),
  ('calibration','Calibration'), ('performance-dashboard','Performance Dashboard'),
  ('role-rates','Role Rates'), ('customer-invoices','Customer Invoices'), ('delivery-notes','Delivery Notes'),
  ('payments','Payments'), ('aging-report','Aging Report'), ('profit-margins','Profit Margins'), ('spend-analyzer','Spend Analyzer'),
  ('leave','Leave Management'), ('resources','Resource Tracking'), ('timesheet','Timesheet'),
  ('timesheet-approvals','Timesheet Approvals'), ('chat','Chat'), ('data-assistant','Data Assistant'),
  ('users','Users'), ('reports','Reports'), ('settings','Settings'), ('content','Landing Content'),
  ('app-monitor','App Monitor'), ('llm-monitor','LLM Usage Monitor')
) AS v(key, label)
ON CONFLICT (organization_id, key) DO NOTHING;

-- Step 2: for every module that had a hardcoded `roles` allow-list in
-- Layout.jsx, mark every OTHER real role (system + custom, minus
-- admin/ceo who bypass this table) as not visible — mirrors exactly what
-- the hardcoded array used to do, now as editable data.
INSERT INTO module_role_visibility (organization_id, module_key, role, visible)
SELECT m.organization_id, v.module_key, r.role_key, false
FROM modules m
JOIN (VALUES
  ('approvals',                ARRAY['manager','department_head','hr']),
  ('proposals',                ARRAY['finance','cto','sales_lead']),
  ('sales-leads',               ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops']),
  ('sales-landing-links',       ARRAY['sales_head','regional_sales_head','sales_ops','cmo','campaign_manager']),
  ('sales-meeting-pages',       ARRAY['sales_head','regional_sales_head','sales_ops','cmo','campaign_manager']),
  ('sales-opportunities',       ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops']),
  ('sales-tasks',               ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops']),
  ('sales-product-launches',    ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops','finance','cto']),
  ('sales-tenders',             ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops','finance']),
  ('sales-pilot-projects',      ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops','finance']),
  ('sales-bootstrap-programs',  ARRAY['sales_head','regional_sales_head','sales_rep','sales_ops','finance']),
  ('sales-timeline',            ARRAY['finance','cmo','cto','sales_head','regional_sales_head']),
  ('sales-dashboard',           ARRAY['finance','cmo','cto','sales_head','regional_sales_head']),
  ('marketing-campaigns',       ARRAY['cmo','campaign_manager','sales_rep','regional_sales_head','sales_head','finance','cto']),
  ('marketing-landing-pages',   ARRAY['cmo','campaign_manager','sales_rep','regional_sales_head','sales_head','finance','cto']),
  ('marketing-content-assets',  ARRAY['cmo','campaign_manager','sales_rep','regional_sales_head','sales_head','finance','cto']),
  ('marketing-calendar',        ARRAY['cmo','campaign_manager','sales_rep','regional_sales_head','sales_head','finance','cto']),
  ('performance-cycles',        ARRAY['hr']),
  ('team-reviews',              ARRAY['hr','manager','department_head']),
  ('calibration',               ARRAY['hr']),
  ('performance-dashboard',     ARRAY['hr','manager','department_head','cto']),
  ('products',                  ARRAY['manager','department_head','finance','procurement_lead','pm']),
  ('bom',                       ARRAY['manager','department_head','finance','procurement_lead','pm']),
  ('inventory',                 ARRAY['manager','department_head','finance','procurement_lead','pm']),
  ('devices',                   ARRAY['manager','department_head','procurement_lead','pm']),
  ('procurement',               ARRAY['manager','department_head','hr','finance','procurement_lead','pm','cto']),
  ('warranty',                  ARRAY['manager','department_head','finance','procurement_lead','pm','cto','field_technician']),
  ('pos',                       ARRAY['manager','finance']),
  ('invoices',                  ARRAY['manager','finance']),
  ('grn',                       ARRAY['manager','finance']),
  ('customers',                 ARRAY['manager','department_head','finance','procurement_lead','pm']),
  ('vendors',                   ARRAY['manager','finance','department_head','procurement_lead']),
  ('fundflow',                  ARRAY['finance']),
  ('role-rates',                ARRAY['finance','hr']),
  ('customer-invoices',         ARRAY['finance']),
  ('delivery-notes',            ARRAY['manager','department_head','finance']),
  ('payments',                  ARRAY['finance']),
  ('aging-report',              ARRAY['finance']),
  ('profit-margins',            ARRAY['finance']),
  ('spend-analyzer',            ARRAY['finance','manager','department_head']),
  ('users',                     ARRAY['manager','finance']),
  ('settings',                  ARRAY[]::text[]),
  ('content',                   ARRAY[]::text[]),
  ('app-monitor',               ARRAY[]::text[]),
  ('llm-monitor',               ARRAY[]::text[])
) AS v(module_key, allowed_roles) ON m.key = v.module_key
CROSS JOIN roles r
WHERE r.role_key NOT IN ('admin','ceo')
  AND NOT (r.role_key = ANY(v.allowed_roles))
ON CONFLICT (organization_id, module_key, role) DO NOTHING;

NOTIFY pgrst, 'reload schema';
