-- ============================================================
-- STEP221: fix "column reference \"id\" is ambiguous" (42702) from
-- get_peer_feedback().
--
-- Root cause: is_hr_admin_ceo() and is_manager_of() (STEP66) are LANGUAGE
-- sql STABLE functions that reference a bare, unqualified `id` column
-- (`WHERE id = auth.uid()` / `WHERE id = p_employee_id`). Postgres inlines
-- simple SQL-language functions like these directly into the caller's
-- query plan. get_peer_feedback() declares RETURNS TABLE(id UUID, ...),
-- which makes `id` a PL/pgSQL variable in scope for its entire body —
-- so once is_hr_admin_ceo()/is_manager_of() get inlined into
-- get_peer_feedback()'s query, their bare `id` reference collides with
-- that PL/pgSQL variable and Postgres can no longer tell whether `id`
-- means profiles.id or the function's own OUT parameter.
--
-- Fix: qualify `id` to `profiles.id` in both helpers. Same behavior,
-- callable safely from any function that happens to have an `id` output
-- column or variable in scope (not just get_peer_feedback — any future
-- RETURNS TABLE(id ...) function calling these would hit the same bug).
-- ============================================================

CREATE OR REPLACE FUNCTION is_hr_admin_ceo() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('hr','admin','ceo'));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_manager_of(p_employee_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = p_employee_id AND profiles.reporting_manager_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
