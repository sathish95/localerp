-- ============================================================
-- STEP20: Add 'delayed' as a valid task status
-- Run this in the Supabase SQL editor BEFORE using the new
-- check-out "Delayed" default, or status updates will fail.
-- ============================================================

-- ── CASE A: status is a TEXT column with a CHECK constraint ──
-- (This is the most common setup. The constraint name is usually
--  project_tasks_status_check — adjust if yours differs.)
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_status_check;
ALTER TABLE project_tasks
  ADD CONSTRAINT project_tasks_status_check
  CHECK (status IN (
    'backlog','todo','in_progress','delayed','qa','ready_for_demo','closed'
  ));

-- ── CASE B: status is a Postgres ENUM type ──────────────────
-- If STEP A errors with "column status is of type <something>_enum",
-- then status is an enum. Comment out CASE A above and run instead:
--
--   ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'delayed' AFTER 'in_progress';
--
-- (Replace 'task_status' with your actual enum type name. Note:
--  ADD VALUE cannot run inside a transaction block — run it on its own.)

-- ── Optional: checkin_tasks.status_update ───────────────────
-- The check-out flow writes the chosen status into
-- checkin_tasks.status_update. If that column has its own CHECK
-- constraint, extend it the same way:
--
--   ALTER TABLE checkin_tasks DROP CONSTRAINT IF EXISTS checkin_tasks_status_update_check;
--   ALTER TABLE checkin_tasks
--     ADD CONSTRAINT checkin_tasks_status_update_check
--     CHECK (status_update IS NULL OR status_update IN (
--       'backlog','todo','in_progress','delayed','qa','ready_for_demo','closed'
--     ));
