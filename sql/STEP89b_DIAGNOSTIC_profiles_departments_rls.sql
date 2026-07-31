-- ============================================================
-- STEP89b (DIAGNOSTIC — READ ONLY): current RLS policies on `profiles`
-- and `departments`.
--
-- Both tables predate this repo's tracked migrations (no CREATE TABLE
-- for either exists anywhere in sql/) and STEP42's own header comment
-- explicitly confirms dozens of RLS policies exist that aren't tracked
-- here either ("some tables predate the tracked migrations" — STEP42
-- discovered its dependent policies live via pg_depend rather than
-- assuming a hardcoded list, for exactly this reason).
--
-- Before writing any migration that adds organization_id + rewrites RLS
-- on profiles/departments, their CURRENT policies must be known exactly
-- — guessing risks silently leaving a real policy in place alongside a
-- new conflicting one, or dropping something load-bearing by the wrong
-- name. Run this and share the output before that follow-up migration
-- is written.
--
-- Read-only — only queries pg_policies / information_schema.
-- ============================================================

SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('profiles', 'departments')
ORDER BY tablename, policyname;

-- Companion: confirm departments' actual columns (its CREATE TABLE is
-- untracked, so this repo only knows the columns inferred from joins —
-- id, name, code).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'departments'
ORDER BY ordinal_position;
