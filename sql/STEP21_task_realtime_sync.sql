-- ============================================================
-- STEP21: Task real-time sync + checkin_tasks status constraint
-- Run in Supabase SQL editor after STEP20_delayed_status.sql
-- ============================================================

-- ── 1. checkin_tasks.status_update constraint ────────────────
-- The checkout flow writes the chosen status into
-- checkin_tasks.status_update. Extend its CHECK constraint to
-- include 'delayed' so checkout doesn't fail.
ALTER TABLE checkin_tasks DROP CONSTRAINT IF EXISTS checkin_tasks_status_update_check;
ALTER TABLE checkin_tasks
  ADD CONSTRAINT checkin_tasks_status_update_check
  CHECK (status_update IS NULL OR status_update IN (
    'backlog','todo','in_progress','delayed','qa','ready_for_demo','closed'
  ));

-- ── 2. Enable Realtime on project_tasks ──────────────────────
-- Required so the Kanban board auto-refreshes whenever
-- check-in/out (or any external update) changes a task status.
--
-- Step A: set REPLICA IDENTITY so Supabase sends old+new rows
ALTER TABLE project_tasks REPLICA IDENTITY FULL;

-- Step B: add the table to the supabase_realtime publication
--         (safe to run even if already added — IF NOT EXISTS guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'project_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE project_tasks;
  END IF;
END$$;

-- ── 3. (Optional) Enable Realtime on checkin_tasks too ───────
-- Uncomment if you want the check-in widget to react to
-- external updates (e.g. a manager reopening a task).
-- ALTER TABLE checkin_tasks REPLICA IDENTITY FULL;
-- ALTER PUBLICATION supabase_realtime ADD TABLE checkin_tasks;

-- ── Notes ────────────────────────────────────────────────────
-- After running this SQL, go to:
--   Supabase Dashboard → Database → Replication
-- and confirm project_tasks appears under supabase_realtime.
-- If it doesn't appear, toggle it on in the UI — the SQL above
-- handles it, but the dashboard toggle is the canonical way.
