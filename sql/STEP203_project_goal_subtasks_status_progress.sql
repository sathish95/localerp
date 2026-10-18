-- ============================================================
-- STEP203: three small additive features for Task Management.
--
-- 1. projects.goal — free-text "what this project is trying to
--    achieve", separate from the existing `description` (scope/notes)
--    field. Surfaced on the project detail header and as a summary
--    block on that project's Task Management report.
--
-- 2. project_tasks.parent_task_id — soft self-reference (same pattern
--    as wiki_pages.parent_page_id, STEP168) so a task can be split into
--    child tasks. Deliberately NOT a hard FK per this repo's convention
--    for referencing project_tasks (its base CREATE TABLE predates the
--    STEP-numbered migration system and isn't tracked here — see
--    docs/industry-adaptive/EXISTING_SYSTEM_ANALYSIS.md). Child tasks
--    are simple/independent (no rollup into the parent's own hours or
--    status) — this column only powers a "Subtasks" list in the UI.
--
-- 3. department_status_steps.progress_pct — optional per-status weight
--    (0-100) admins can set per department flow step (Settings → Task
--    Status Flows), e.g. Todo=0, In Progress=30, QA=60,
--    Ready to Deploy=80, Done=100. Task Management's Reports tab uses
--    this (falling back to the task's own manually-entered
--    project_tasks.progress_pct when set, else this step weight, else
--    0/100 by is_closed) to show a weighted completion % per project
--    instead of a flat done/total ratio. Backfilled below with an even
--    spread across each flow's existing step order so existing flows
--    get a sensible default immediately; admins can refine per-step.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS goal TEXT;

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID; -- soft ref -> project_tasks(id)
CREATE INDEX IF NOT EXISTS project_tasks_parent_idx ON project_tasks(parent_task_id);

ALTER TABLE department_status_steps ADD COLUMN IF NOT EXISTS progress_pct INT;

UPDATE department_status_steps s
SET progress_pct = CASE
  WHEN s.is_closed THEN 100
  ELSE LEAST(90, ROUND(100.0 * s.sort_order / GREATEST(mx.max_order + 1, 1)))
END
FROM (SELECT flow_id, MAX(sort_order) AS max_order FROM department_status_steps GROUP BY flow_id) mx
WHERE s.flow_id = mx.flow_id AND s.progress_pct IS NULL;

NOTIFY pgrst, 'reload schema';
