-- ============================================================
-- STEP209: Drop the stale project_tasks_task_type_check CHECK
-- constraint — same class of bug as STEP206's status check. It was
-- auto-named/created against project_tasks' original fixed task_type
-- list and never updated as new types (e.g. 'iot_hardware', and now
-- 'general' — the universal/miscellaneous check-in task type) were
-- added at the application layer (TASK_TYPES in TasksPage.jsx). Since
-- TASK_TYPES is already the single source of truth for valid values
-- (enforced by the Type dropdown, not the DB), the DB-side allowlist
-- only ever gets stale and blocks new types with a 23514 error instead
-- of adding any real safety.
-- ============================================================

ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_task_type_check;

NOTIFY pgrst, 'reload schema';
