-- ============================================================
-- STEP59: Reset catalog data — Products, Devices, Components, and every
-- table that references them by part_number/device_id, so a fresh start
-- doesn't leave orphaned rows pointing at deleted catalog entries.
--
-- Scope (confirmed with the user before writing this):
--   DELETED — products, device_instances, component_vendors,
--     product_bom_versions + product_bom_version_components,
--     grn_items, purchase_order_items, purchase_requisition_items,
--     inventory_transactions, deployment_history,
--     device_warranties, warranty_claims, warranty_cost_entries
--     (the last three would otherwise point at deleted devices/products —
--     not explicitly listed in the original ask, but they soft-reference
--     device_instances.id / products.part_number and would be orphaned
--     data left behind otherwise, per this file's own stated purpose).
--   KEPT AS-IS — vendors, customers, budgets, profiles, projects,
--     purchase_requisitions/purchase_orders/grn (header rows only — they
--     lose their line items above but the header record itself stays),
--     warranty_policies/warranty_settings/warranty_budgets (company-wide
--     config, not per-item data), and everything else.
--
-- All real (enforced) FKs in this schema point at profiles/vendors, never
-- at products/device_instances/warranty_claims — confirmed via grep across
-- every sql/ file before writing this — so there is no FK ordering
-- requirement here; the DELETE order below is purely for readability
-- (children before parents).
--
-- Recompute rollups afterward: company_spend_rollup / vendor_spend_summary /
-- actual_cost_snapshots / profit_margins are caches, not raw data — they
-- aren't touched here, but will show stale numbers until you click
-- "Recompute All" on Spend Analyzer (or open each project's Finance tab)
-- after this runs.
--
-- THIS IS IRREVERSIBLE. Run only when you're sure. Wrapped in a single
-- transaction — if anything errors, nothing is deleted.
-- ============================================================

BEGIN;

DELETE FROM warranty_cost_entries;
DELETE FROM warranty_claims;
DELETE FROM device_warranties;
DELETE FROM deployment_history;

DELETE FROM grn_items;
DELETE FROM inventory_transactions;
DELETE FROM purchase_order_items;
DELETE FROM purchase_requisition_items;

DELETE FROM product_bom_version_components;
DELETE FROM product_bom_versions;
DELETE FROM component_vendors;

DELETE FROM device_instances;
DELETE FROM products;

COMMIT;

NOTIFY pgrst, 'reload schema';
