-- ============================================================
-- STEP92 (DIAGNOSTIC — READ ONLY): full-schema ground truth for the
-- remaining multi-tenant RLS retrofit (Phase 2, Batches 2-10).
--
-- Discovered while working through Batch 1: a large share of this app's
-- tables predate tracked migrations entirely (no CREATE TABLE anywhere
-- in sql/STEP*.sql) — confirmed for vendors, purchase_requisitions,
-- purchase_orders, grns, projects, project_tasks, expenses,
-- travel_requests, assets, profiles, departments, and there are likely
-- more. Their CURRENT RLS policies are unknown from this repo alone.
-- Writing new policies against a guessed/assumed current state risks
-- either leaving a real policy in place alongside a new conflicting one
-- (silent cross-org data leak) or dropping something load-bearing.
--
-- This single query replaces the narrower STEP89b (profiles/departments
-- only) — run this instead, it supersedes it. Output is long; that's
-- expected. Read-only — only queries pg_policies / information_schema /
-- pg_constraint.
-- ============================================================

-- 1. Every RLS policy currently in the public schema, table by table.
SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2. Every table in the public schema and whether RLS is even enabled
-- on it (a table with 0 rows in query #1 above but rowsecurity=false
-- here means "no RLS at all, fully open" rather than "policies unknown"
-- — an important distinction for prioritizing which tables are most
-- urgent).
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 3. Existing constraint names per table (so future ALTER/DROP
-- CONSTRAINT statements target real names instead of guessed ones —
-- the exact mistake that broke the first run of STEP90).
SELECT conrelid::regclass AS table_name, conname AS constraint_name, contype AS constraint_type
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY table_name, constraint_name;
