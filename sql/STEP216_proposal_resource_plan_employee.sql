-- ============================================================
-- STEP216: Resource Plan can now price against a specific real employee,
-- not just a generic designation string.
--
-- Additive and backward-compatible: existing resource plans (employee_id
-- NULL) keep working exactly as before — priced purely off role_rates by
-- designation, headcount can be > 1. When a specific employee is picked
-- instead, estimated_count is always 1 (one named person, not an
-- abstract headcount slot) and the rate resolves via the SAME shared
-- fallback chain actualCost.js's resolveHourlyRate() already uses
-- everywhere else in this app (role_rates by designation first, falling
-- back to that employee's own resource_rates row) — see proposals.js's
-- resolveResourceRate(), which now imports and calls that exact function
-- rather than duplicating its logic.
-- ============================================================

ALTER TABLE proposal_resource_plans ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES profiles(id);
CREATE INDEX IF NOT EXISTS proposal_resource_plans_employee_idx ON proposal_resource_plans(employee_id);

NOTIFY pgrst, 'reload schema';
