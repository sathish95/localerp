-- ============================================================
-- STEP219: Software/SaaS/Third-Party lines can now carry a license
-- quantity — e.g. 50 user licenses x Rs 400/month, not just a single
-- unit_cost figure. computed_cost = unit_cost x qty x time-factor
-- (One-time: x1; Monthly: x duration_months; Annual: x ceil(months/12)),
-- same time-factor rule as before, just with qty folded in.
-- ============================================================

ALTER TABLE proposal_software_lines ADD COLUMN IF NOT EXISTS qty NUMERIC(12,2) NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
