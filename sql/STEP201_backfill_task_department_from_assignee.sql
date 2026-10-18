-- ============================================================
-- STEP201: Backfill — sync every EXISTING task's department to match
-- its assignee's own department. Last message's app change (TaskForm's
-- "Assigned To" auto-filling Department) only applies going forward,
-- from inside the Edit Task form — this is the one-time catch-up for
-- tasks that were assigned before that existed, so the Kanban board's
-- per-department flow (STEP198/199) actually lines up for them too.
--
-- Only touches tasks that HAVE an assignee — an unassigned task has no
-- resource to auto-fetch a department from, so it's left alone.
-- Overwrites department_id even if already set to something else,
-- matching the live app's behavior (assigning a resource always mirrors
-- THEIR department) — if a task was deliberately cross-assigned to a
-- different department on purpose, this will undo that; check the
-- PREVIEW below before running the UPDATE.
-- ============================================================

-- ── STEP 1: PREVIEW — read this before running anything else ──
SELECT
  t.task_id, t.task_name, a.full_name AS assignee, dOld.name AS current_department, dNew.name AS will_become
FROM project_tasks t
JOIN profiles a ON a.id = t.assigned_to
LEFT JOIN departments dOld ON dOld.id = t.department_id
LEFT JOIN departments dNew ON dNew.id = a.department_id
WHERE t.assigned_to IS NOT NULL
  AND t.department_id IS DISTINCT FROM a.department_id
ORDER BY dNew.name NULLS LAST, t.task_name;

-- ── STEP 2: UPDATE — only after reviewing the preview above ──
-- Logs each change into task_change_log (STEP197) too, so this bulk
-- backfill shows up in each affected task's own History, same as if it
-- had been changed by hand.
DO $$
DECLARE
  v_count INT;
BEGIN
  -- organization_id captured explicitly here (not left to
  -- task_change_log's DEFAULT current_org_id()) — that default reads
  -- auth.uid(), which is NULL with no authenticated session, i.e.
  -- exactly the SQL Editor — same gotcha STEP195/STEP196 hit.
  CREATE TEMP TABLE _dept_backfill ON COMMIT DROP AS
  SELECT t.id AS task_id, t.organization_id AS org_id, t.department_id AS old_dept, a.department_id AS new_dept
  FROM project_tasks t
  JOIN profiles a ON a.id = t.assigned_to
  WHERE t.assigned_to IS NOT NULL
    AND t.department_id IS DISTINCT FROM a.department_id;

  -- project_tasks has an existing trigger (track_task_dates) that logs
  -- to task_status_log on every UPDATE — that table has the SAME
  -- organization_id/current_org_id() default bug as STEP195/196 hit
  -- (NULL with no authenticated session, i.e. the SQL Editor), so it
  -- would fail this whole UPDATE as a side effect. Disabled only for
  -- this statement, then restored immediately after — not a schema
  -- change, just scoped to this one transaction.
  ALTER TABLE project_tasks DISABLE TRIGGER USER;
  UPDATE project_tasks t SET department_id = b.new_dept
  FROM _dept_backfill b WHERE b.task_id = t.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ALTER TABLE project_tasks ENABLE TRIGGER USER;

  INSERT INTO task_change_log (organization_id, task_id, changed_by, field_name, old_value, new_value)
  SELECT org_id, task_id, NULL, 'department_id', old_dept::text, new_dept::text FROM _dept_backfill;

  RAISE NOTICE '% task(s) had their department synced to their assignee''s department', v_count;
END $$;
