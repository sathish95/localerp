-- ============================================================
-- STEP206: Drop the legacy project_tasks_status_check constraint.
--
-- STEP20_delayed_status.sql locked project_tasks.status to exactly
-- 'backlog','todo','in_progress','delayed','qa','ready_for_demo','closed'.
-- STEP198_department_status_flows.sql later let each department define
-- its OWN arbitrary set of status steps (Settings → Task Status Flows),
-- but never relaxed this constraint — so every task move to a custom
-- department status has been silently rejected by Postgres ever since
-- (error 23514), which every write path in TasksPage.jsx swallowed
-- without checking until just now. This is the real cause behind:
--   - "status not changing" / stuck on a legacy value after a
--     department renamed or added custom steps
--   - Kanban board / List view status looking wrong or reverting after
--     a refresh (the write never actually happened)
--
-- Status validity is now governed by department_status_steps (STEP198),
-- not a fixed DB enum — a hard CHECK listing a closed set of literals is
-- fundamentally incompatible with "admins can add custom steps per
-- department," so this is dropped with no replacement constraint.
-- ============================================================

ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_status_check;

NOTIFY pgrst, 'reload schema';
