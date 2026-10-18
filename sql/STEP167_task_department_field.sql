-- STEP167: Department field on tasks
--
-- Tasks previously had no department concept at all (only assigned_to, a
-- single user). This adds an optional department tag per task so tasks can
-- be organized/filtered by which department owns the work — independent of
-- project_departments (STEP166), which tracks project-level sign-off, not
-- per-task ownership.

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS department_id UUID; -- soft ref -> departments(id)

NOTIFY pgrst, 'reload schema';
