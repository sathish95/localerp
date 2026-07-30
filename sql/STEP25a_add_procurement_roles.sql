-- ============================================================
-- STEP25a: Add the 3 new Procurement roles to the user_role enum
-- MUST be run as its OWN separate query execution, BEFORE STEP25.
-- Postgres will not let a newly-added enum value be referenced
-- (e.g. in an RLS policy's `role IN (...)`) within the same
-- transaction/script that added it — hence this standalone file.
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'procurement_lead';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pm';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cto';
