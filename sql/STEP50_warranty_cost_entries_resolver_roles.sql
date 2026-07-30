-- ============================================================
-- STEP50: warranty_cost_entries INSERT was restricted to admin/ceo/finance,
-- but WarrantyPage.jsx's canResolve gate (who's allowed to resolve a claim)
-- also includes manager/department_head/procurement_lead. Those three roles
-- could open the Resolve modal and submit, but the underlying cost-entry
-- insert (Replace/Repair/Remote Fix all book one) silently failed RLS —
-- the whole resolve action errored out and the claim never reached
-- Resolved. This broadens INSERT only, to match who can actually resolve a
-- claim in the UI. SELECT/UPDATE on warranty_cost_entries and all of
-- warranty_budgets stay admin/ceo/finance-only — cost *visibility* is
-- unchanged, this only fixes who can *record* a cost while resolving a
-- claim they're already permitted to resolve.
-- Run in Supabase SQL Editor after STEP37_warranty_core.sql.
-- ============================================================

DROP POLICY IF EXISTS warranty_cost_entries_insert ON warranty_cost_entries;
CREATE POLICY warranty_cost_entries_insert ON warranty_cost_entries FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','manager','department_head','procurement_lead'))
);

NOTIFY pgrst, 'reload schema';
