-- ============================================================
-- STEP218: a Miscellaneous line can now be priced as a % of the combined
-- internal cost of the resource-plan-priced categories (Application
-- Development, Firmware Development, Hardware Design & Production, ERP
-- Integration) instead of always being a flat manually-entered amount —
-- e.g. "Contingency = 10% of total engineering cost".
--
-- percent_of_base is the % entered; base_cost_snapshot is what that %
-- was actually calculated against, at the moment it was last saved — kept
-- for audit/transparency (the base can change as resource plans change,
-- so this is a snapshot, not a live formula, matching every other
-- computed field in this schema: never trust a stale number silently,
-- always show what it was computed from). `cost` itself stays the single
-- source of truth every other total already reads (sectionInternalCost,
-- computeValueSummary) — nothing downstream needs to change.
-- ============================================================

ALTER TABLE proposal_misc_lines ADD COLUMN IF NOT EXISTS percent_of_base NUMERIC(6,3);
ALTER TABLE proposal_misc_lines ADD COLUMN IF NOT EXISTS base_cost_snapshot NUMERIC(14,2);

NOTIFY pgrst, 'reload schema';
