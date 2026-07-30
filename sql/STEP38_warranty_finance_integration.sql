-- ============================================================
-- STEP38: Warranty Management — Budget & Finance / Spend Analyzer
-- integration. Run AFTER STEP37 (warranty core tables), STEP33
-- (actual_cost_snapshots) and STEP36 (spend_findings).
-- ============================================================

-- Warranty cost becomes its own line on the existing actual-cost
-- snapshot, alongside people_cost/hardware_cost — src/lib/actualCost.js's
-- recomputeForProject() is extended to sum it into total_actual_cost so
-- it automatically flows into profit_margins without any change to
-- src/lib/profitMargin.js (which reads total_actual_cost verbatim).
ALTER TABLE actual_cost_snapshots ADD COLUMN IF NOT EXISTS warranty_cost NUMERIC(14,2) DEFAULT 0;

-- Optional convenience pointer to the latest device_warranties row for a
-- device, kept in sync by src/lib/warranty.js. Purely additive — does not
-- touch the existing warranty_start/warranty_end columns DevicesPage.jsx
-- already reads for its near-expiry badge.
ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS current_device_warranty_id UUID;

-- Widen spend_findings.finding_type to allow a new 'RecurringWarrantyOverrun'
-- finding (product types/projects where actual warranty claims consistently
-- exceed the planned reserve in warranty_budgets). Constraint name matches
-- Postgres's default auto-generated name for the CHECK declared inline in
-- STEP36's CREATE TABLE — verify against the live DB if this errors.
ALTER TABLE spend_findings DROP CONSTRAINT IF EXISTS spend_findings_finding_type_check;
ALTER TABLE spend_findings ADD CONSTRAINT spend_findings_finding_type_check CHECK (
  finding_type IN (
    'RecurringOverrun','ContingencyPattern','UnderutilizedBudget',
    'VendorConsolidation','AllocationInefficiency','ChangeCostCreep',
    'RecurringWarrantyOverrun'
  )
);

NOTIFY pgrst, 'reload schema';
