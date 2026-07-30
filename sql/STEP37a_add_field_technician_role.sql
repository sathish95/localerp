-- ============================================================
-- STEP37a: Add the 'field_technician' role to the user_role enum
-- MUST be run as its OWN separate query execution, BEFORE STEP37.
-- Postgres will not let a newly-added enum value be referenced
-- (e.g. in an RLS policy's `role IN (...)`) within the same
-- transaction/script that added it — hence this standalone file.
-- (Same constraint STEP25a hit when adding procurement_lead/pm/cto.)
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'field_technician';
