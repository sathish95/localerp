-- ============================================================
-- STEP89a (DIAGNOSTIC — READ ONLY, not a migration): identifies whatever
-- Postgres trigger currently creates the `profiles` row after a new user
-- signs up.
--
-- That trigger is NOT present anywhere in this repo's tracked sql/
-- folder — it predates STEP20 and was set up directly in the Supabase
-- SQL Editor/dashboard, so its exact current name and behavior are
-- unknown. Evidence it exists: src/context/AuthContext.jsx's 7x-retry
-- (700ms backoff) loop waiting for the profile row to appear post-
-- signup, and a comment in src/pages/UsersPage.jsx referencing an
-- untracked "supabase-fix-signup.sql".
--
-- Run this BEFORE any future migration that touches signup (e.g. wiring
-- organization_id into new-user creation). Do not guess the trigger's
-- name and CREATE OR REPLACE it blind — that risks either creating a
-- second, conflicting trigger, or silently no-op'ing over the real one
-- if the name happens to collide. Paste the output back so the actual
-- fix can be written against its real current definition.
--
-- This query only SELECTs from Postgres system catalogs — it cannot
-- modify anything.
-- ============================================================

SELECT
  t.tgname                  AS trigger_name,
  p.proname                 AS function_name,
  n.nspname                 AS function_schema,
  t.tgenabled                AS enabled_flag,   -- 'O' = enabled (origin), 'D' = disabled
  pg_get_functiondef(p.oid) AS function_source
FROM pg_trigger t
JOIN pg_class c      ON c.oid = t.tgrelid
JOIN pg_namespace cn ON cn.oid = c.relnamespace
JOIN pg_proc p       ON p.oid = t.tgfoid
JOIN pg_namespace n  ON n.oid = p.pronamespace
WHERE cn.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;

-- Companion check: any RPC/function whose name suggests it's involved in
-- profile creation, in case the trigger delegates to a separate function
-- not caught by name alone above.
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND (routine_name ILIKE '%new_user%' OR routine_name ILIKE '%handle_signup%' OR routine_name ILIKE '%create_profile%');
